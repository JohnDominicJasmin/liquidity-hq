/* Dead-feed detection for the chart's live candle socket (#1572). Pure, so it can be tested without a socket or a clock.
 *
 * Measured on 2026-10-16 (localhost, headless Chromium, BTC 1m): when the exchange closed the chart's socket with a clean close
 * (code 1000) the chart never reconnected, and when the socket went silent without closing nothing noticed. In both cases the
 * candles stopped for good while the indicator and the price ticker, which are separate pipelines, kept moving. A feed that
 * delivers nothing at all is dead, whatever its readyState says. */

/** How long a socket may deliver NOTHING (no candle, no pong) before it is treated as dead and replaced. Bybit's kline topic
 *  pushes about once a second for BTC and the client pings every 20 s; Binance's kline stream pushes every 1-2 s. 60 s is
 *  generous enough that a quiet coin never trips it, and a false trip costs one reconnect plus a gap backfill. */
export const STREAM_STALL_MS = 60_000;

/** How often the watchdog looks. */
export const STREAM_WATCH_EVERY_MS = 10_000;

/** Bybit asks for a client ping about every 20 s to keep a public connection healthy. */
export const BYBIT_PING_EVERY_MS = 20_000;

export function isStreamStalled(lastMessageAt: number, now: number, stallMs: number = STREAM_STALL_MS): boolean {
  if (!Number.isFinite(lastMessageAt) || !Number.isFinite(now)) return false;
  return now - lastMessageAt > stallMs;
}
