/* THIN HANDLER. The fetching, the three caches and the merge live in `lib/marketSnapshotData.ts`
 * so the server-side gather for #1631 item 5 can ask for the same numbers without an HTTP hop.
 * What stays here belongs to the REQUEST: the rate limit, the status codes and the cache headers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { polledCacheControl } from '@/lib/cacheHeaders';
import { marketSnapshotData } from '@/lib/marketSnapshotData';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!rateLimit(`market-snapshot:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    const res = await marketSnapshotData();
    if (!res.ok) return apiError('market-snapshot', res.reason, 502, 'Upstream unavailable');
    const { ticker, klines, lsr, partial, viaFallback, fetchedAt, stale } = res.data;

    return NextResponse.json({
      ticker,
      klines,
      lsr,
      /* Both omitted entirely when everything is healthy, so the common response is unchanged and
         `'partial' in body` stays a valid check. */
      ...(partial.length ? { partial } : {}),
      ...(Object.keys(viaFallback).length ? { viaFallback } : {}),
      /* Present only when every section's refresh failed and this is the last good snapshot; `ts` is then its real age. */
      ...(stale ? { stale: true } : {}),
      /* The DATA's age, not the request's: this is served from three caches, so Date.now() made 3-minute-old numbers look fresh. */
      ts: fetchedAt ?? Date.now(),
    }, {
      /* Public and visitor-independent, and already only as fresh as the shortest TTL. Letting any
         shared cache in front of this serve it removes the origin hit for the common case. */
      headers: { 'Cache-Control': polledCacheControl(60) },
    });
  } catch (e) {
    return apiError('market-snapshot', e, 500, 'Request failed');
  }
}
