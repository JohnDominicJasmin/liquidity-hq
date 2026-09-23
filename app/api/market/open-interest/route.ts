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
import { feedKeyFor } from '@/lib/marketFeeds';
import { readSnapshot } from '@/lib/marketSnapshot';

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

  /* SNAPSHOT FIRST (#1404) - see the fuller note in ../account-ratio/route.ts.
     Registered combination -> serve the job's row with its age and make no
     exchange call. `intervalTime=1h&limit=3` is the only one the app asks for
     (components/MarketProvider.tsx:986); anything else falls through to live. */
  const snapKey = feedKeyFor('open-interest', { intervalTime, limit: String(limit) });
  if (snapKey) {
    const snap = await readSnapshot(snapKey);
    if (snap && !snap.tooOld) {
      const body = snap.payload as Record<string, unknown>;
      return NextResponse.json(
        { ...body, ts: Date.now() - snap.ageMs, ageMs: snap.ageMs, stale: snap.stale, from: 'snapshot' },
        { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' } },
      );
    }
    /* Transition state, removed once the cron entry exists and the UI can say
       "not available yet" - identical reasoning to account-ratio, including the
       hard age limit that degrades a stopped scheduler to today's behaviour. */
    if (snap?.tooOld) console.log(`[open-interest] snapshot ${Math.round(snap.ageMs / 60_000)}m old - past the limit, serving live`);
    else console.log('[open-interest] no snapshot row yet - serving live');
  }

  try {
    const { data, ok, total, stopped } = await bybitFanout(
      `bybit:open-interest:${intervalTime}:${limit}`,
      120_000,
      (sym) => `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${sym}&intervalTime=${intervalTime}&limit=${limit}`,
      /* The upstream `list` verbatim, newest-first as Bybit sends it. Both
         callers do their own arithmetic over it - one reads [0], the other
         compares [0] against the last element - so reshaping here would break
         one of them and is not this route's business. */
      (body) => (body as { result?: { list?: unknown[] } })?.result?.list ?? null,
    );

    reportHealth('bybit:open-interest', 'market', !stopped, stopped ? `${ok}/${total} then rate-limited` : `${ok}/${total}`, ok);
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
    reportHealth('bybit:open-interest', 'market', false, String(e));
    return apiError('market-open-interest', e, 502, 'Upstream unavailable');
  }
}
