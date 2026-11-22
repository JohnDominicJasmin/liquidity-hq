/* SERVER-SIDE TRIMS FOR LARGE UPSTREAM PAYLOADS (#1651, medium).
 *
 * Three browser reads pulled a whole third-party list to read two to twelve fields of it, on every visitor's every poll: Bybit's linear tickers (every contract, ~30 fields each), Deribit's BTC option book (every
 * strike, ~15 fields each) and DefiLlama's full stablecoin list (hundreds of coins, only USDT and USDC read). These keep only what the one caller reads, in the SAME shape, so the caller's code is unchanged.
 * Used inside the proxy route BEFORE the response is cached, so the cache holds the small body.
 *
 * A trim that finds a body it does not recognise returns it UNTOUCHED: a changed upstream shape must still reach the caller as it is, not be silently emptied. */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const pick = (o: unknown, keys: readonly string[]): Obj => {
  const out: Obj = {};
  if (!isObj(o)) return out;
  for (const k of keys) if (k in o) out[k] = o[k];
  return out;
};

/** The fields components/MarketProvider.tsx reads from a Bybit linear ticker. */
export const BYBIT_TICKER_FIELDS = [
  'symbol', 'lastPrice', 'indexPrice', 'markPrice', 'openInterest', 'openInterestValue', 'fundingRate', 'nextFundingTime',
  'highPrice24h', 'lowPrice24h', 'price24hPcnt', 'turnover24h',
] as const;

export function trimBybitTickers(body: unknown): unknown {
  const list = isObj(body) && isObj(body.result) ? body.result.list : undefined;
  if (!isObj(body) || !isObj(body.result) || !Array.isArray(list)) return body;
  return { ...body, result: { ...body.result, list: list.map(t => pick(t, BYBIT_TICKER_FIELDS)) } };
}

/** The fields fetchDeribitOptions reads from a book summary row. */
export const DERIBIT_BOOK_FIELDS = ['instrument_name', 'open_interest', 'mark_iv', 'underlying_price'] as const;

export function trimDeribitBook(body: unknown): unknown {
  if (!isObj(body) || !Array.isArray(body.result)) return body;
  return { ...body, result: body.result.map(r => pick(r, DERIBIT_BOOK_FIELDS)) };
}

/** fetchStablecoinFlows sums USDT and USDC only; it reads symbol and the three circulating readings of each. */
export const LLAMA_STABLE_SYMBOLS = ['USDT', 'USDC'] as const;

export function trimLlamaStables(body: unknown): unknown {
  if (!isObj(body) || !Array.isArray(body.peggedAssets)) return body;
  const keep = body.peggedAssets
    .filter(a => isObj(a) && (LLAMA_STABLE_SYMBOLS as readonly string[]).includes(String(a.symbol)))
    .map(a => pick(a, ['symbol', 'circulating', 'circulatingPrevWeek', 'circulatingPrevMonth']));
  return { ...body, peggedAssets: keep };
}

/** ONLY THE SYMBOLS ASKED FOR (#1651, QA on prod 2026-11-23): Binance's futures ticker/24hr takes ONE `symbol`, not a `symbols` list, so a request naming 16 symbols was answered with the whole futures market (817 items, 302 KB; 65 KB on the wire) and the route cached and served all of it per symbols key. This keeps the items whose `symbol` is in the request's `symbols` (a JSON array or a comma list), each item untouched, in upstream order, same array shape.
 *  A body that is not an array, or a `symbols` value this cannot read, comes back UNTOUCHED: an unexpected shape must reach the caller, not be emptied. */
export function trimToRequestedSymbols(body: unknown, params: URLSearchParams): unknown {
  const raw = params.get('symbols');
  if (!Array.isArray(body) || raw == null || raw.trim() === '') return body;
  let list: unknown;
  if (raw.trim().startsWith('[')) {
    try { list = JSON.parse(raw); } catch { return body; }
  } else {
    list = raw.split(',');
  }
  if (!Array.isArray(list) || list.length === 0 || !list.every(x => typeof x === 'string')) return body;
  const wanted = new Set((list as string[]).map(x => x.trim().toUpperCase()));
  return body.filter(item => isObj(item) && typeof item.symbol === 'string' && wanted.has(item.symbol.toUpperCase()));
}
