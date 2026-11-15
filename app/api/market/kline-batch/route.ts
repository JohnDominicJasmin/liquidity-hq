/* Bybit candles for every tracked symbol, in one request (#1651 D).
 *
 * MarketProvider.bootstrapOITrend used to fetch the last 13 five-minute candles ONE SYMBOL AT A TIME (49 requests to /api/market/klines)
 * on every page load, on every route, to seed the "OI % 1h" trend. Measured 2026-11-15 on a signed-in /arena load: 61 of the first
 * 97 /api requests, 49 of them that one shape. The open-interest half of the same bootstrap was already batched (#200,
 * ../open-interest/route.ts); this is the klines half, built the same way: the fan-out happens HERE, behind ONE cache entry per
 * (interval, limit), so the first visitor in a TTL window pays the upstream calls and everyone else pays none, and the browser makes 1
 * request instead of 49.
 *
 * Each distinct (interval, limit) is its own fan-out of ~50 upstream calls, so both are validated against a small set: this is an
 * egress control as much as input validation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { bybitFanout } from '@/lib/bybitFanout';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { apiError } from '@/lib/apiError';
import { polledCacheControl } from '@/lib/cacheHeaders';

/* Bybit's own interval names. 5 is what the OI bootstrap asks for; the others are the ones the app uses elsewhere, kept to a closed set. */
const INTERVALS = new Set(['1', '5', '15', '30', '60', '240']);
const MAX_LIMIT = 50;
/* One fan-out serves this long. The bootstrap is a once-per-mount seed, and the per-symbol route it replaces cached five-minute candles for 30 s. */
const TTL_MS = 60_000;

export async function GET(req: NextRequest) {
  if (!rateLimit(`kline-batch:${getClientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  const q = req.nextUrl.searchParams;
  const interval = q.get('interval') ?? '5';
  const limit = Number(q.get('limit') ?? '13');
  if (!INTERVALS.has(interval)) {
    return NextResponse.json({ error: `interval '${interval}' is not one this app uses` }, { status: 400 });
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return NextResponse.json({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` }, { status: 400 });
  }

  try {
    const { data, ok, total, stopped } = await bybitFanout(
      `bybit:kline-batch:${interval}:${limit}`,
      TTL_MS,
      (sym) => `https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${interval}&limit=${limit}`,
      /* The upstream `list` verbatim, newest-first as Bybit sends it: the same shape `klData.result.list` had, so the caller's arithmetic is unchanged. */
      (body) => (body as { result?: { list?: unknown[] } })?.result?.list ?? null,
    );
    /* `stopped` is reported separately for the same reason as the sibling routes: `ok: 12, total: 49` reads the same for a rate-limit abort and for 37 symbols failing alone. */
    return NextResponse.json({ data, ok, total, ...(stopped ? { stopped: true } : {}), ts: Date.now() }, {
      headers: { 'Cache-Control': polledCacheControl(TTL_MS / 1000) },
    });
  } catch (e) {
    return apiError('market-kline-batch', e, 502, 'Upstream unavailable');
  }
}
