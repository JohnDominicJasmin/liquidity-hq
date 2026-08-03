import { NextResponse } from 'next/server';
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
// Scheduled from cron-job.org, not in this repo - see docs/INFRASTRUCTURE.md §2.

// Anything older than this can't be "breaking" and is already past the client's
// own 6h display cutoff, so ingesting it would only produce dead rows.
const MAX_AGE_SEC = 6 * 3600;

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
    const cutoff = Math.floor(Date.now() / 1000) - MAX_AGE_SEC;
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
      if (item.pubDate < cutoff) continue;
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
      const ts = a.datetime ?? Math.floor(Date.now() / 1000);
      if (ts < cutoff) continue;
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
      const ts = a.datetime ?? Math.floor(Date.now() / 1000);
      if (ts < cutoff) continue;
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

    return NextResponse.json({ ok: true, scanned: rows.length, inserted });
  } catch (e) {
    return apiError('news/ingest', e, 500, 'News ingest failed');
  }
}
