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
import { BINANCE_SYMS, BINANCE_SYM_TO_COIN, BYBIT_SYMS, bybitPriceFactor } from '@/lib/coins';

/* hype is excluded to match the caller: it is not a Binance listing, so a
   request for it is a guaranteed 400 from upstream and one wasted call per
   fan-out. */
const SYMBOLS = Object.entries(BINANCE_SYMS)
  .filter(([coin]) => coin !== 'hype')
  .map(([, sym]) => sym);

const LIMITS = new Set([100, 200, 500]);

/* #1233 (#1077 split): Bybit's recent-trade endpoint as the per-symbol
 * fallback when Binance's aggTrades fails for that symbol. Reshaped to the
 * exact `{ m, q, p, a }[]` shape components/MarketProvider.tsx's aggTrades
 * consumer already reads - see that shape's own comment on why it stays
 * verbatim rather than exposing Bybit's field names.
 *
 * FIELD MAPPING:
 * - `p` (price): Bybit's `price` * bybitPriceFactor(coin). Every symbol this
 *   route fans out over comes from BINANCE_SYMS, and no coin in BINANCE_SYMS
 *   has a 1000x-prefixed BYBIT_SYMS entry (pepe/bonk, the only 1000x pairs,
 *   are Bybit-only and excluded from BINANCE_SYMS - lib/coins.ts's own
 *   comment) - so this is always x1 for every symbol reachable here today.
 *   Applied anyway per lib/coins.ts's own rule ("any new code reading a
 *   price... from BYBIT_SYMS must apply this") rather than relying on that
 *   staying true.
 * - `q` (quantity): Bybit's `size`, unconverted. Both exchanges quote linear
 *   USDT-perp trade size in base-coin units for every symbol reachable here,
 *   so there is nothing to convert.
 * - `m` (was the buyer the maker, i.e. a sell-initiated trade): Binance's `m`
 *   and Bybit's `side` encode the SAME fact oppositely-named. Binance names
 *   the maker's role; Bybit's `side` names the TAKER's - `side: "Sell"` means
 *   the taker sold, which is exactly `m: true`'s condition.
 * - `a` (aggregate trade id): see synthesizeFallbackId below - NOT Bybit's
 *   execId, deliberately.
 */
const BB_TRADE_URL = 'https://api.bybit.com/v5/market/recent-trade';

/* The aggTrades consumer (MarketProvider.tsx) tracks a per-coin "last seen"
 * id as a plain number and only ever compares it with `>` - across BOTH
 * exchanges' trades once this fallback exists, id-space collision is a real
 * risk, not a theoretical one. Bybit's execId is its own id space with no
 * defined relationship to Binance's aggTradeId counter; treating it as
 * directly comparable could make a genuine Binance id look "already seen"
 * forever after Binance recovers (or worse, unpredictably), silently
 * breaking whale alerts for the rest of that browser tab's life - no failed
 * request, no status logging would ever surface it. A synthetic id
 * that is ALWAYS NEGATIVE sidesteps this by construction: `t.a > lastSeenId`
 * is false for every real id (which are always positive) whenever
 * `lastSeenId` is itself a positive Binance id or the initial 0, so a
 * fallback trade never registers as "new" against a genuine baseline -
 * whale alerts simply pause for that coin during the outage, rather than
 * firing on an id space nobody can vouch for lining up with what came
 * before or comes after. CVD is unaffected: it reads `m`/`q` only, never `a`. */
function synthesizeFallbackId(indexInBatch: number): number {
  return -(indexInBatch + 1);
}

function bybitTradesToAggShape(
  body: unknown, priceFactor: number,
): Array<{ m: boolean; q: string; p: string; a: number }> | null {
  const list = (body as { result?: { list?: Array<{ price: string; size: string; side: string }> } })
    ?.result?.list;
  if (!Array.isArray(list)) return null;
  return list.map((t, i) => ({
    m: t.side === 'Sell',
    q: t.size,
    p: String(Number(t.price) * priceFactor),
    a: synthesizeFallbackId(i),
  }));
}

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
    const { data, ok, total, stopped, viaFallback } = await symbolFanout(
      SYMBOLS,
      `binance:agg-trades:${limit}`,
      60_000,
      (sym) => `https://api.binance.com/api/v3/aggTrades?symbol=${sym}&limit=${limit}`,
      /* Verbatim. The caller walks every trade computing CVD and whale events
         against its own last-seen id, so reshaping here would break both. */
      (body) => (Array.isArray(body) ? body : null),
      {
        buildUrl: (sym) => {
          const coin = BINANCE_SYM_TO_COIN[sym];
          const bbSymbol = coin ? BYBIT_SYMS[coin] : undefined;
          // #1233: fet has no Bybit linear perp (lib/coins.ts). Throwing here
          // - rather than building a URL that would 404/400 - is caught by
          // symbolFanout's own pool exactly like any other per-symbol miss,
          // so it stays absent from `data`, same as today.
          if (!bbSymbol) throw new Error(`no Bybit symbol for ${sym}`);
          return `${BB_TRADE_URL}?category=linear&symbol=${bbSymbol}&limit=${limit}`;
        },
        pick: (body, sym) => {
          const coin = BINANCE_SYM_TO_COIN[sym];
          return bybitTradesToAggShape(body, coin ? bybitPriceFactor(coin) : 1);
        },
      },
    );

    reportHealth(
      'binance:agg-trades', 'market', !stopped,
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
       `viaFallback`, #1233: which symbols came from Bybit rather than Binance -
       an honest per-symbol source signal, additive so an all-Binance response's
       shape is unchanged. */
    return NextResponse.json({
      data, ok, total,
      ...(stopped ? { stopped: true } : {}),
      ...(viaFallback?.length ? { viaFallback } : {}),
      ts: Date.now(),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (e) {
    reportHealth('binance:agg-trades', 'market', false, String(e));
    return apiError('market-agg-trades', e, 502, 'Upstream unavailable');
  }
}
