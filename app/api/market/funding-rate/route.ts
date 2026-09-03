/* Binance funding-rate history for every tracked symbol, in one request (#200).
 *
 * 45 calls, one per symbol, all with limit=42, and only on /funding. QA measured
 * it as the identical shape to account-ratio and revised their own advice to
 * collect it alongside aggTrades rather than leaving it in the tail.
 *
 * TTL is 15 minutes, not the 60s the trade routes use: funding settles on a
 * fixed EIGHT HOUR schedule, so a 42-point history is unchanged between
 * settlements. A shorter TTL would re-fetch 45 symbols to receive the same
 * numbers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { symbolFanout } from '@/lib/bybitFanout';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { apiError } from '@/lib/apiError';
import { reportHealth } from '@/lib/apiHealth';
import { BINANCE_SYMS } from '@/lib/coins';

const SYMBOLS = Object.entries(BINANCE_SYMS)
  .filter(([coin]) => coin !== 'hype')
  .map(([, sym]) => sym);

const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  if (!rateLimit(`funding-rate:${getClientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '42');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return NextResponse.json(
      { error: `limit must be an integer between 1 and ${MAX_LIMIT}` }, { status: 400 },
    );
  }

  try {
    const { data, ok, total, stopped } = await symbolFanout(
      SYMBOLS,
      `binance:funding-rate:${limit}`,
      900_000,
      (sym) => `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=${limit}`,
      /* Verbatim array; /funding maps and sorts it itself. */
      (body) => (Array.isArray(body) ? body : null),
    );

    reportHealth('binance:funding-rate', 'market', !stopped, stopped ? `${ok}/${total} then rate-limited` : `${ok}/${total}`, ok);
    /* `stopped` distinguishes a rate-limit abort from symbols failing one at a
       time (#665). `ok: 12, total: 49` reads identically for both, and they call
       for opposite responses - back off for the TTL, versus investigate a patchy
       upstream. Omitted when false so the healthy response is unchanged and
       `'stopped' in body` is a valid check, the same convention
       /api/market/snapshot uses for `partial`. Reported unhealthy too: a run cut
       short by a ban is not a success with fewer rows. */
    return NextResponse.json({ data, ok, total, ...(stopped ? { stopped: true } : {}), ts: Date.now() }, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' },
    });
  } catch (e) {
    reportHealth('binance:funding-rate', 'market', false, String(e));
    return apiError('market-funding-rate', e, 502, 'Upstream unavailable');
  }
}
