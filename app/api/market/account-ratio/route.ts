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
import { feedFor } from '@/lib/marketFeeds';
import { resolveFeedSnapshot } from '@/lib/marketSnapshot';

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
  /* A MISSING OR TOO-OLD ROW SERVES LIVE, which is a deliberate transition state
     rather than the finished behaviour: the panel consuming this has no label for
     "not available yet" - MarketProvider drops a non-ok answer silently, which
     would blank the ratios with no explanation - and adding one needs label keys
     in five locales plus the owner's copy approval. Until that exists, a silent
     blank is worse than one live call.
     REMOVE THIS FALLBACK once the cron entry exists AND the UI can say it. */
  const feed = feedFor('account-ratio', { period });
  if (feed) {
    const snap = await resolveFeedSnapshot(feed, 'account-ratio');
    if (snap) {
      return NextResponse.json({
        ...snap.body,
        /* BOTH CLOCKS, so nobody has to guess which one a number came from:
           `ts`/`rowAgeMs` is when we wrote it, `dataAgeMs`/`dataAges` is how old
           the market data in it actually is. The second is the one that decides
           `stale`. */
        ts: Date.now() - snap.rowAgeMs,
        rowAgeMs: snap.rowAgeMs,
        dataAgeMs: snap.dataAgeMs,
        overdueMs: snap.overdueMs,
        dataAges: snap.dataAges,
        droppedSymbols: snap.droppedSymbols,
        stale: snap.stale,
        from: 'snapshot',
      }, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } });
    }
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
          /* ADDED, never a reshape (#1404, QA's review). Bybit stamps each item
             with the time the ratio was measured, and this parser used to drop
             it - so nothing downstream could tell a fresh figure from a stale
             one. Every existing consumer reads longRatio/shortRatio by name
             (BriefingTerminal, GrokChat, MarketProvider), so an extra field is
             invisible to them; changing the shape would have fixed the snapshot
             job by breaking the route nobody was watching. */
          ts: Number(item.timestamp) || null,
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
