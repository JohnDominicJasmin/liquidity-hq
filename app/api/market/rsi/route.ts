/* THIN HANDLER. The fetching, the caching and the merge live in `lib/marketRsi.ts` so the
 * server-side gather for #1631 item 5 can ask for the same numbers without an HTTP hop.
 * What stays here is what belongs to the REQUEST: the rate limit, who is asking, the status
 * codes and the cache headers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { readRequestToken } from '@/lib/entitlements';
import { mergeRsiGroups, rsiCachedAt, rsiGroups } from '@/lib/marketRsi';
import { bearerToken } from '@/lib/bearerToken';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!rateLimit(`market-rsi:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    /* #1263: 5m is a Pro timeframe and the fast group is 5m alone, so a caller who is not
       confirmed Pro gets the slow group only. Same rule as /api/grok's fast-timeframe gate
       (#1511): 'unknown' (the plan read failed) is SERVED, because a failed read is not evidence
       the user is free (#1119). */
    const token = bearerToken(req.headers);
    /* BOTH STARTED BEFORE EITHER IS AWAITED. The entitlement read decides only which groups get
       MERGED, never which get fetched, so making it block the fetches would add its latency to
       every response for nothing. The handler did this before the fetching moved to lib/ and it
       would have been easy to lose in the move. */
    const statusP = readRequestToken(token); // never rejects
    const groupsP = rsiGroups();
    const [{ status, tokenRejected }, groups] = await Promise.all([statusP, groupsP]);
    /* A token was sent and is no longer valid: 401, so the client refreshes its session and asks again (MarketProvider.fetchRSI). */
    if (tokenRejected) return NextResponse.json({ error: 'TOKEN_EXPIRED' }, { status: 401 });
    const res = mergeRsiGroups(groups, status !== 'not_entitled');

    if (!res.ok) return apiError('market-rsi', res.reason, 502, 'Upstream unavailable');

    /* #1235: which coins had at least one field served from Bybit rather than Binance this
       response - additive, omitted when empty so an all-Binance response's shape is unchanged. */
    return NextResponse.json({
      rsi: res.rsi,
      ...(res.viaFallback.length ? { viaFallback: res.viaFallback } : {}),
      /* Only when both groups failed and these are the last good tables; `ts` is then their real age. */
      ...(res.stale ? { stale: true } : {}),
      ts: rsiCachedAt() ?? Date.now(),
    }, {
      /* Private since #1263: the body depends on who is asking, so a shared cache must not store
         one caller's response for another. This was 'public, s-maxage=60', and s-maxage explicitly
         lets a shared cache store a response to an Authorization request - a Pro body could have
         been served to a free caller. The fan-out is still done once per TTL for everyone inside
         rsiSnapshot; only the merge is per caller. */
      headers: { 'Cache-Control': 'private, max-age=60', Vary: 'Authorization' },
    });
  } catch (err) {
    return apiError('market-rsi', err, 502, 'Request failed');
  }
}
