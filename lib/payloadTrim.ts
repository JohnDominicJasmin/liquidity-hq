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
