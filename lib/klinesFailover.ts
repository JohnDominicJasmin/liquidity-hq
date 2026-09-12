/* Pure server-side failover decision for #1077 (Binance -> Bybit egress).
 *
 * Distinct from lib/exchangeFailover.ts (#1059/#1228's client-side WebSocket
 * reconnect state machine, hysteresis + retry counting) - this is a one-shot
 * per-request decision with no connection state: given how the upstream
 * fetch went, should this request retry against Bybit for the same data.
 *
 * Extracted so QA can test it without a live upstream (#1223's convention).
 */

/** True when a Binance response failed in a way worth retrying against
 *  Bybit - any non-2xx status, or no status at all (a thrown/network-level
 *  failure - refused connection, timeout, DNS). Not narrowed to 418/429
 *  (Binance's own ban codes): the point is never showing nothing when an
 *  equivalent source exists, whatever the failure reason. */
export function shouldFailToBybit(status: number | undefined): boolean {
  return status === undefined || status < 200 || status >= 300;
}

/**
 * PM/DevOps on #1077: "never splice exchanges inside one candle series."
 *
 * A single fixed-limit request (get the most recent N candles) is atomic -
 * one upstream fetch either succeeds whole or fails whole, so a failover for
 * it can only ever return an entirely-Bybit or entirely-Binance series,
 * never a mix. A RANGE request (start/end, used by lib/backtestEngine.ts's
 * paginated backfill walk) is different: it is one of many sequential calls
 * assembled into one continuous series by the CALLER. This route has no
 * memory of which exchange answered the earlier pages of the same walk, so
 * failing over independently per page could hand back a series that is
 * Binance for pages 1-3 and Bybit for page 4 - exactly the seam PM flagged,
 * invisible to the indicator math computed over the assembled result.
 *
 * Conservative and correct rather than clever: range requests never fail
 * over. A mid-backfill Binance failure surfaces as the same 502 it always
 * has, rather than silently changing which exchange the rest of the walk
 * might be quietly mixed with.
 */
export function canFailoverForRequest(isRange: boolean): boolean {
  return !isRange;
}

/* Binance interval string -> Bybit's equivalent. Bybit's linear-kline
 * intervals are minutes-as-integers plus D/W/M (app/api/market/klines's own
 * INTERVALS table); Binance's 8h and 3d have no Bybit equivalent at all, so
 * those two intervals can never fail over regardless of symbol - returns
 * null rather than guessing a nearest interval, which would silently change
 * what timeframe a chart or signal is reading. */
const BN_TO_BYBIT_INTERVAL: Record<string, string> = {
  '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
  '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
  '1d': 'D', '1w': 'W', '1M': 'M',
};

export function bybitIntervalFor(binanceInterval: string): string | null {
  return BN_TO_BYBIT_INTERVAL[binanceInterval] ?? null;
}
