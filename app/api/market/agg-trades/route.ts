/* Binance aggregate trades for every tracked symbol, in one request (#200).
 *
 * Replaces a client sweep of ~45 per-symbol fetches - 360 requests per visitor,
 * the largest single line left after batch 2. Same shape as the Bybit pair:
 * Binance has no batch parameter, so the fan-out lives here behind one cache
 * entry rather than in every browser.
 *
 * PAYLOAD, measured rather than assumed: one symbol at limit=200 is ~24 KB, so
 * all 45 is ~1.04 MB raw and ~0.26 MB gzipped. That is the SAME total bytes the
 * client already transfers - it is the same data - so this trades 45 requests
 * for 1 without changing what crosses the wire.
 *
 * WHALE-ALERT LATENCY, the one behaviour change worth knowing: the caller emits
 * `whale-trade` events for trades newer than the last id it saw, so a shared
 * cache means every visitor in a TTL window sees the same trade set. `fetchCVD`
 * already runs on a FIVE MINUTE interval, so whale events are up to 5 minutes
 * behind today; a 60s TTL adds at most 20% to a latency that already exists. It
 * does not introduce a new class of delay.
 */
import { NextRequest, NextResponse } from 'next/server';
import { symbolFanout } from '@/lib/bybitFanout';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { apiError } from '@/lib/apiError';
import { reportHealth } from '@/lib/apiHealth';
import { BINANCE_SYMS } from '@/lib/coins';

/* hype is excluded to match the caller: it is not a Binance listing, so a
   request for it is a guaranteed 400 from upstream and one wasted call per
   fan-out. */
const SYMBOLS = Object.entries(BINANCE_SYMS)
  .filter(([coin]) => coin !== 'hype')
  .map(([, sym]) => sym);

const LIMITS = new Set([100, 200, 500]);

export async function GET(req: NextRequest) {
  if (!rateLimit(`agg-trades:${getClientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '200');
  if (!LIMITS.has(limit)) {
    return NextResponse.json(
      { error: `limit must be one of ${[...LIMITS].join(', ')}` }, { status: 400 },
    );
  }

  try {
    const { data, ok, total } = await symbolFanout(
      SYMBOLS,
      `binance:agg-trades:${limit}`,
      60_000,
      (sym) => `https://api.binance.com/api/v3/aggTrades?symbol=${sym}&limit=${limit}`,
      /* Verbatim. The caller walks every trade computing CVD and whale events
         against its own last-seen id, so reshaping here would break both. */
      (body) => (Array.isArray(body) ? body : null),
    );

    reportHealth('binance:agg-trades', 'market', true, `${ok}/${total}`, ok);
    return NextResponse.json({ data, ok, total, ts: Date.now() }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (e) {
    reportHealth('binance:agg-trades', 'market', false, String(e));
    return apiError('market-agg-trades', e, 502, 'Upstream unavailable');
  }
}
