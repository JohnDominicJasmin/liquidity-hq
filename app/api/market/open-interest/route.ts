/* Bybit open interest for every tracked symbol, in one request (#200).
 *
 * Replaces a client-side loop of ~50 per-symbol fetches - 392 requests per
 * visitor. Two callers want different windows (1h/limit=3 and 5min/limit=13),
 * so both are parameters and each combination is its own cache entry.
 */
import { NextRequest, NextResponse } from 'next/server';
import { bybitFanout } from '@/lib/bybitFanout';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { apiError } from '@/lib/apiError';
import { reportHealth } from '@/lib/apiHealth';

const INTERVALS = new Set(['5min', '15min', '30min', '1h', '4h', '1d']);
/* Capped, and small. Each distinct limit is another fan-out of 50 upstream
   calls, so this is an egress control as much as a validation one. */
const MAX_LIMIT = 50;

export async function GET(req: NextRequest) {
  if (!rateLimit(`open-interest:${getClientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const q = req.nextUrl.searchParams;
  const intervalTime = q.get('intervalTime') ?? '1h';
  const limit = Number(q.get('limit') ?? '3');

  if (!INTERVALS.has(intervalTime)) {
    return NextResponse.json({ error: `intervalTime '${intervalTime}' is not one this app uses` }, { status: 400 });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return NextResponse.json({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` }, { status: 400 });
  }

  try {
    const { data, ok, total } = await bybitFanout(
      `bybit:open-interest:${intervalTime}:${limit}`,
      120_000,
      (sym) => `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${sym}&intervalTime=${intervalTime}&limit=${limit}`,
      /* The upstream `list` verbatim, newest-first as Bybit sends it. Both
         callers do their own arithmetic over it - one reads [0], the other
         compares [0] against the last element - so reshaping here would break
         one of them and is not this route's business. */
      (body) => (body as { result?: { list?: unknown[] } })?.result?.list ?? null,
    );

    reportHealth('bybit:open-interest', 'market', true, `${ok}/${total}`, ok);
    return NextResponse.json({ data, ok, total, ts: Date.now() }, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
    });
  } catch (e) {
    reportHealth('bybit:open-interest', 'market', false, String(e));
    return apiError('market-open-interest', e, 502, 'Upstream unavailable');
  }
}
