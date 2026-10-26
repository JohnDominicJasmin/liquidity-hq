import { NextResponse } from 'next/server';
import { judgeTs, notableOf, MAX_AGE_SEC, MAX_FUTURE_SEC, type TsVerdict } from '@/lib/newsTs';
import { checkCronAuth } from '@/lib/cronAuth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { apiError } from '@/lib/apiError';
import { classifyNews, GEO_KEYWORDS } from '@/lib/classify';
import { fetchAllFeeds, fetchFinnhubCategory } from '@/lib/newsFeeds';
import { recordApiHealth } from '@/lib/apiHealth';
import { dedupKey, identitiesOf } from '@/lib/newsDedup';
import { T } from '@/lib/tables';

// Scheduled owner of the news pipeline. Every open tab used to run this work
// itself on four timers (see components/NewsProvider.tsx before this change),
// so upstream load scaled with concurrent viewers. Finnhub and the RSS feeds
// have no push mechanism, so the polling still has to happen - it just happens
// once here now, and clients receive the result over Supabase Realtime.
//
/* judgeTs, MAX_FUTURE_SEC, MAX_AGE_SEC and TsVerdict moved to lib/newsTs.ts - pure, importable by a
   test without this file's framework imports, and the only way notableOf could be exported at all. */

type Row = {
  dedup_key: string;
  headline: string;
  source: string;
  published_at: string;
  severity: string | null;
  cat: string;
  link: string | null;
  image: string | null;
};

// Key generation lives in lib/newsDedup.ts.

function matchesGeo(text: string): boolean {
  const t = text.toLowerCase();
  return GEO_KEYWORDS.some(g => g.kw.some(k => t.includes(k)));
}

export async function POST(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff = nowSec - MAX_AGE_SEC;

    /* Rejections are counted per verdict AND per feed. The +24h stamp could not be attributed to
       one of the three feeds after the fact, so the next occurrence names its own source rather
       than needing archaeology. */
    const rejected: Record<string, number> = {};
    const note = (v: TsVerdict, source: string) => { rejected[`${v}:${source}`] = (rejected[`${v}:${source}`] ?? 0) + 1; };
    const [feeds, fhCrypto, fhGeneral] = await Promise.all([
      fetchAllFeeds(),
      fetchFinnhubCategory('crypto'),
      fetchFinnhubCategory('general'),
    ]);
    const rss = feeds.items;

    // Health is recorded per source, every run. This job already touches every
    // dependency once a minute, so it is the cheapest possible place to notice
    // one going quiet - no separate prober re-hammering the same endpoints.
    //
    // An empty Finnhub array is a failure, not an empty news day: it is what
    // both a missing FINNHUB_KEY and an upstream outage look like, and either
    // is worth surfacing.
    await recordApiHealth([
      ...feeds.outcomes.map(o => ({
        source: `rss:${o.source}`,
        category: 'news' as const,
        ok: o.ok,
        detail: o.detail,
        items: o.items,
      })),
      {
        source: 'finnhub:crypto',
        category: 'news' as const,
        ok: fhCrypto.length > 0,
        detail: fhCrypto.length > 0 ? `${fhCrypto.length} articles` : 'no articles (key missing or upstream down)',
        items: fhCrypto.length,
      },
      {
        source: 'finnhub:general',
        category: 'news' as const,
        ok: fhGeneral.length > 0,
        detail: fhGeneral.length > 0 ? `${fhGeneral.length} articles` : 'no articles (key missing or upstream down)',
        items: fhGeneral.length,
      },
    ]);

    // Dedup on BOTH identities, not just the stored key. The same article can
    // arrive from RSS with a link (keyed by URL) and from Finnhub without one
    // (keyed by headline) in this very run - CoinDesk did exactly that, and
    // keying on the URL alone put both rows in the table because their keys
    // genuinely differ. `seen` therefore tracks every identity a row has, so
    // whichever form lands first wins and the other is dropped.
    const byKey = new Map<string, Row>();
    const seen = new Set<string>();
    const add = (r: Row) => {
      const ids = identitiesOf(r.headline, r.link);
      if (ids.some(id => seen.has(id))) return;
      ids.forEach(id => seen.add(id));
      byKey.set(r.dedup_key, r);
    };

    for (const item of rss) {
      const v = judgeTs(item.pubDate, nowSec);
      if (v !== 'ok') { note(v, `rss:${item.source}`); continue; }
      // Crypto-category items are newsworthy even when no keyword fires, which
      // is why they fall back to 'purple' rather than being dropped.
      const severity = classifyNews(item.title) ?? (item.cat === 'crypto' ? 'purple' : null);
      if (!severity && !matchesGeo(item.title)) continue;
      add({
        dedup_key: dedupKey(item.title, item.link),
        headline: item.title,
        source: item.source,
        published_at: new Date(item.pubDate * 1000).toISOString(),
        severity,
        cat: item.cat,
        link: item.link ?? null,
        image: item.image ?? null,
      });
    }

    for (const a of fhCrypto.slice(0, 40)) {
      const headline = a.headline ?? '';
      if (!headline) continue;
      const ts = a.datetime ?? nowSec;
      const v = judgeTs(ts, nowSec);
      if (v !== 'ok') { note(v, `finnhub:crypto:${a.source ?? 'unknown'}`); continue; }
      add({
        dedup_key: dedupKey(headline),
        headline,
        source: a.source ?? 'Finnhub',
        published_at: new Date(ts * 1000).toISOString(),
        severity: classifyNews(headline) ?? 'purple',
        cat: 'crypto',
        link: null,
        image: a.image ?? null,
      });
    }

    // General business news is only relevant when it trips a severity keyword
    // or a geo keyword. severity stays null for geo-only hits - the client
    // falls back to 'amber' for those, which is what the old geo-events path
    // did, and dropping them here would empty the War & Geo list.
    for (const a of fhGeneral.slice(0, 30)) {
      const headline = a.headline ?? '';
      if (!headline) continue;
      const ts = a.datetime ?? nowSec;
      const v = judgeTs(ts, nowSec);
      if (v !== 'ok') { note(v, `finnhub:general:${a.source ?? 'unknown'}`); continue; }
      const severity = classifyNews(headline);
      if (!severity && !matchesGeo(`${headline} ${a.summary ?? ''}`)) continue;
      add({
        dedup_key: dedupKey(headline),
        headline,
        source: a.source ?? 'Finnhub',
        published_at: new Date(ts * 1000).toISOString(),
        severity,
        cat: 'general',
        link: null,
        image: a.image ?? null,
      });
    }

    const batch = [...byKey.values()];
    const sb = getSupabaseAdmin();

    // The primary key stops an exact repeat, but it cannot stop the SAME story
    // arriving under its other identity on a LATER run - RSS files it with a
    // link on one run, Finnhub files it linkless on the next, two different
    // keys, two rows. So check what is already stored in the live window and
    // drop anything we already hold under either identity.
    //
    // This is a read-then-write, which the primary key was chosen to avoid.
    // The race it reopens is narrow and benign: two runs overlapping inside
    // this window can still insert the same story twice, exactly as before.
    // The key still guards the exact-key case, so nothing regresses; this only
    // catches what the key structurally cannot see.
    const { data: current } = await sb
      .from(T.news)
      .select('headline, link')
      .gte('published_at', new Date(cutoff * 1000).toISOString());

    const held = new Set<string>();
    for (const r of current ?? []) {
      for (const id of identitiesOf(r.headline ?? '', r.link)) held.add(id);
    }

    const rows = batch.filter(r => !identitiesOf(r.headline, r.link).some(id => held.has(id)));

    // ignoreDuplicates makes the primary key itself the dedup, so two runs
    // overlapping in time can't produce a duplicate push or resurrect an item
    // a client has already seen.
    let inserted = 0;
    if (rows.length) {
      const { data, error } = await sb
        .from(T.news)
        .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true })
        .select('dedup_key');
      if (error) return apiError('news/ingest', error, 500, 'News insert failed');
      inserted = data?.length ?? 0;
    }

    // Rows older than the client's display window are unreachable - prune so
    // the table stays a rolling buffer rather than growing forever.
    await sb
      .from(T.news)
      .delete()
      .lt('published_at', new Date((cutoff - MAX_AGE_SEC) * 1000).toISOString());

    /* ALREADY-STORED FUTURE ROWS ARE COUNTED AND REPORTED, NEVER DELETED, AND THAT IS DELIBERATE.

       There is a sticky variant of this bug: the prune above is `.lt('published_at', ...)`, so a row
       stamped far enough ahead is never below that bound and can never be swept. The +24h case
       self-cleared when the clock caught up; a feed glitch stamping a year ahead would sit at the top
       of the feed permanently. Mechanism, not a sighting - it has not been observed.

       The obvious fix is to delete anything beyond the tolerance. It is the wrong one. The prune
       already deletes on the basis of OUR clock, which is safe only because deleting STALE content
       when our clock is wrong is mild. Deleting FUTURE-stamped content on a wrong clock means a
       server running slow erases current news - a guard whose failure mode is destroying live data
       is worse than the bug it fixes. So this reports and a human decides. */
    const { count: futureHeld } = await sb
      .from(T.news)
      .select('dedup_key', { count: 'exact', head: true })
      .gt('published_at', new Date((nowSec + MAX_FUTURE_SEC) * 1000).toISOString());

    const rejectedTotal = Object.values(rejected).reduce((a, b) => a + b, 0);
    /* #1737 (QA): the warn fires on the UNEXPECTED verdicts only. `too_old` is the normal state of a
       feed - measured on the real ones, 123 of 147 items - so counting it here made this line print on
       every single run, and the `too_new` it exists to surface would arrive looking like the three
       hundred that did not matter. A log line that always fires is not a signal. too_old stays in the
       RETURNED counts, where a caller can read it deliberately. */
    const notable = notableOf(rejected);
    if (notable.length > 0 || (futureHeld ?? 0) > 0) {
      console.warn(`[news/ingest] notable=${JSON.stringify(Object.fromEntries(notable))} rejected_total=${rejectedTotal} future_rows_held=${futureHeld ?? 0}`);
    }

    return NextResponse.json({ ok: true, scanned: rows.length, inserted, rejected, futureHeld: futureHeld ?? 0 });
  } catch (e) {
    return apiError('news/ingest', e, 500, 'News ingest failed');
  }
}
