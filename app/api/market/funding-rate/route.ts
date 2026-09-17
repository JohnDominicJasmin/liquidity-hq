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
import { BINANCE_SYMS, BINANCE_SYM_TO_COIN, BYBIT_SYMS } from '@/lib/coins';

const SYMBOLS = Object.entries(BINANCE_SYMS)
  .filter(([coin]) => coin !== 'hype')
  .map(([, sym]) => sym);

const MAX_LIMIT = 100;

/* #1234 (#1077 split): Bybit's funding-history endpoint as the per-symbol
 * fallback, same shape of change as #1233's agg-trades. Confirmed live
 * (this project's own standard - measured, not assumed) rather than from
 * memory:
 *
 *   curl '.../v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=3'
 *   -> newest-first, {fundingRate, fundingRateTimestamp (ms, string)}
 *
 *   curl '.../fapi/v1/fundingRate?symbol=BTCUSDT&limit=3'
 *   -> oldest-first, {fundingRate, fundingTime (ms, number), markPrice, ...}
 *
 * Same oldest/newest asymmetry app/api/proxy/route.ts's own PASSTHROUGH
 * comment already names for Bybit generally. Doesn't matter here either way:
 * FundingTerminal.tsx's fetchAllBinanceFR sorts by ts itself (:45), so this
 * fallback returns Bybit's list in whatever order it came in.
 *
 * NO PRICE FACTOR NEEDED, unlike #1233's agg-trades: a funding rate is a
 * percentage of position value, not a token price - bybitPriceFactor's 1000x
 * meme-coin correction has nothing to apply to here. (Moot anyway: same as
 * agg-trades, no coin reachable via BINANCE_SYMS has a 1000x BYBIT_SYMS
 * entry.) Only `fundingRate` and `fundingTime` are populated - the two
 * fields the consumer reads (FundingTerminal.tsx:39) - rather than
 * fabricating Binance-only fields (markPrice, rateType) nothing here has a
 * source for.
 *
 * SETTLEMENT INTERVAL IS NOT ASSUMED, AND IT VARIES - checked live rather
 * than assumed a fixed 8h: DOGEUSDT/AVAXUSDT settle every 8h on both
 * exchanges, but TIAUSDT settles every 4h on BOTH. So a per-symbol interval
 * genuinely differs, and in principle Binance and Bybit could disagree on it
 * for the SAME symbol (exchanges set this independently), which would make a
 * Bybit-fallback series read as a different cadence than what a caller might
 * expect from Binance's usual 8h. This still can't produce a silently wrong
 * number here because `fundingTime`/`fundingRateTimestamp` are the REAL
 * per-point settlement time either exchange gave, carried through verbatim -
 * FundingTerminal.tsx's only consumer of this route sorts and plots by that
 * real timestamp (:45) and never assumes fixed spacing between points. Never
 * spliced either way: one symbol's array is entirely Binance or entirely
 * Bybit for a given request, chosen atomically the same way #1240's klines
 * failover chose one exchange per request, not per point. */
const BB_FUNDING_URL = 'https://api.bybit.com/v5/market/funding/history';

function bybitFundingToBinanceShape(
  body: unknown,
): Array<{ fundingRate: string; fundingTime: number }> | null {
  const list = (body as { result?: { list?: Array<{ fundingRate: string; fundingRateTimestamp: string }> } })
    ?.result?.list;
  if (!Array.isArray(list)) return null;
  return list.map(t => ({ fundingRate: t.fundingRate, fundingTime: Number(t.fundingRateTimestamp) }));
}

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
    const { data, ok, total, stopped, viaFallback } = await symbolFanout(
      SYMBOLS,
      `binance:funding-rate:${limit}`,
      900_000,
      (sym) => `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=${limit}`,
      /* Verbatim array; /funding maps and sorts it itself. */
      (body) => (Array.isArray(body) ? body : null),
      {
        buildUrl: (sym) => {
          const coin = BINANCE_SYM_TO_COIN[sym];
          const bbSymbol = coin ? BYBIT_SYMS[coin] : undefined;
          // #1234: fet has no Bybit linear perp (lib/coins.ts) - throwing
          // here is caught by symbolFanout's own fallback pool exactly like
          // any other per-symbol miss, so it stays absent from `data`.
          if (!bbSymbol) throw new Error(`no Bybit symbol for ${sym}`);
          return `${BB_FUNDING_URL}?category=linear&symbol=${bbSymbol}&limit=${limit}`;
        },
        pick: (body) => bybitFundingToBinanceShape(body),
      },
    );

    reportHealth(
      'binance:funding-rate', 'market', !stopped,
      viaFallback?.length
        ? `${ok}/${total}, ${viaFallback.length} via bybit-fallback${stopped ? ' (primary rate-limited)' : ''}`
        : (stopped ? `${ok}/${total} then rate-limited` : `${ok}/${total}`),
      ok,
    );
    /* `stopped` distinguishes a rate-limit abort from symbols failing one at a
       time (#665). `ok: 12, total: 49` reads identically for both, and they call
       for opposite responses - back off for the TTL, versus investigate a patchy
       upstream. Omitted when false so the healthy response is unchanged and
       `'stopped' in body` is a valid check, the same convention
       /api/market/snapshot uses for `partial`. Reported unhealthy too: a run cut
       short by a ban is not a success with fewer rows.
       `viaFallback`, #1234: which symbols came from Bybit rather than
       Binance - additive, so an all-Binance response's shape is unchanged. */
    return NextResponse.json({
      data, ok, total,
      ...(stopped ? { stopped: true } : {}),
      ...(viaFallback?.length ? { viaFallback } : {}),
      ts: Date.now(),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' },
    });
  } catch (e) {
    reportHealth('binance:funding-rate', 'market', false, String(e));
    return apiError('market-funding-rate', e, 502, 'Upstream unavailable');
  }
}
