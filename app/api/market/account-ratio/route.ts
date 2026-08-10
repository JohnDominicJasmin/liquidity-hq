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

  try {
    const { data, ok, total } = await bybitFanout(
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

    reportHealth('bybit:account-ratio', 'market', true, `${ok}/${total}`, ok);
    /* `ok`/`total` are in the body on purpose: a caller and a probe can both see
       a partial fan-out. An empty one cannot reach here - bybitFanout throws. */
    return NextResponse.json({ data, ok, total, ts: Date.now() }, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
    });
  } catch (e) {
    reportHealth('bybit:account-ratio', 'market', false, String(e));
    return apiError('market-account-ratio', e, 502, 'Upstream unavailable');
  }
}
