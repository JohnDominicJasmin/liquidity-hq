/* Bybit long/short account ratio for every tracked symbol, in one request (#200).
 *
 * Replaces a client-side loop of ~50 per-symbol fetches - 393 requests per
 * visitor in QA's measurement, the largest single line remaining after batch 1.
 * The browser now makes one call; the fan-out and its cache live in
 * lib/bybitFanout.ts, with the reasoning for doing it there rather than as a
 * per-symbol proxy.
 */
import { NextRequest, NextResponse } from 'next/server';
import { bybitFanout } from '@/lib/bybitFanout';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { apiError } from '@/lib/apiError';
import { reportHealth } from '@/lib/apiHealth';
import { feedKeyFor } from '@/lib/marketFeeds';
import { readSnapshot } from '@/lib/marketSnapshot';

/* Only the periods the app actually asks for. An allowlist rather than a
   pass-through, because each distinct value is a separate cache entry and a
   separate fan-out of 50 upstream calls - free-text here would be both a key
   leak and an egress amplifier. */
const PERIODS = new Set(['5min', '15min', '30min', '1h', '4h', '1d']);

export async function GET(req: NextRequest) {
  if (!rateLimit(`acct-ratio:${getClientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const period = req.nextUrl.searchParams.get('period') ?? '1h';
  if (!PERIODS.has(period)) {
    return NextResponse.json({ error: `period '${period}' is not one this app uses` }, { status: 400 });
  }

  /* SNAPSHOT FIRST (#1404). When the scheduled job has written this combination,
     serve its row and make no exchange call at all - with the row's AGE in the
     body, so a consumer can tell a five-minute-old number from an hour-old one
     rather than being handed both as "current".
     Only `period=1h` is registered, because it is the only one the app asks for
     (components/MarketProvider.tsx:368). An unregistered period falls through to
     the live path below - refusing it would break a caller to win a statistic. */
  const snapKey = feedKeyFor('account-ratio', { period });
  if (snapKey) {
    const snap = await readSnapshot(snapKey);
    if (snap && !snap.tooOld) {
      const body = snap.payload as Record<string, unknown>;
      return NextResponse.json(
        { ...body, ts: Date.now() - snap.ageMs, ageMs: snap.ageMs, stale: snap.stale, from: 'snapshot' },
        { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } },
      );
    }
    if (snap?.tooOld) {
      /* Past SNAPSHOT_TOO_OLD_MS the row is treated as absent rather than served
         with a `stale` flag no consumer can render yet - a stopped scheduler
         should degrade to today's behaviour, not to quietly old numbers. */
      console.log(`[account-ratio] snapshot ${Math.round(snap.ageMs / 60_000)}m old - past the limit, serving live`);
    }
    /* NO ROW YET - the job has never run, or the database is unreachable.
       This serves LIVE rather than an explicit "not available yet", and that is
       a deliberate transition state, not the finished behaviour: the panel that
       consumes this has no label for "not available yet" (MarketProvider drops a
       non-ok answer silently, which would blank the ratios with no explanation),
       and adding one needs label keys in five locales plus the owner's copy
       approval. Until that exists, a silent blank is worse than one live call.
       REMOVE THIS FALLBACK once the cron entry exists AND the UI can say it. */
    else console.log('[account-ratio] no snapshot row yet - serving live');
  }

  try {
    const { data, ok, total, stopped } = await bybitFanout(
      `bybit:account-ratio:${period}`,
      120_000,
      (sym) => `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${sym}&period=${period}&limit=1`,
      (body) => {
        const item = (body as { result?: { list?: Array<Record<string, string>> } })?.result?.list?.[0];
        if (!item) return null;
        return {
          longRatio:  parseFloat(item.buyRatio  || '0.5'),
          shortRatio: parseFloat(item.sellRatio || '0.5'),
        };
      },
    );

    reportHealth('bybit:account-ratio', 'market', !stopped, stopped ? `${ok}/${total} then rate-limited` : `${ok}/${total}`, ok);
    /* `ok`/`total` are in the body on purpose: a caller and a probe can both see
       a partial fan-out. An empty one cannot reach here - bybitFanout throws. */
    /* `stopped` distinguishes a rate-limit abort from symbols failing one at a
       time (#665). `ok: 12, total: 49` reads identically for both, and they call
       for opposite responses - back off for the TTL, versus investigate a patchy
       upstream. Omitted when false so the healthy response is unchanged and
       `'stopped' in body` is a valid check, the same convention
       /api/market/snapshot uses for `partial`. Reported unhealthy too: a run cut
       short by a ban is not a success with fewer rows. */
    return NextResponse.json({ data, ok, total, ...(stopped ? { stopped: true } : {}), ts: Date.now() }, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
    });
  } catch (e) {
    reportHealth('bybit:account-ratio', 'market', false, String(e));
    return apiError('market-account-ratio', e, 502, 'Upstream unavailable');
  }
}
