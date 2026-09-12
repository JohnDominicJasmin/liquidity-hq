/* Pure failover-decision helpers for client-side Binance -> Bybit failover
 * (#1059). Extracted so QA can test the decision directly rather than only
 * through a live WebSocket - same shape as shouldWrite (lib/apiHealth.ts).
 * The two callers (components/WhaleTradesFeed.tsx,
 * components/MarketProvider.tsx's Liquidation Cascade Detector) each keep
 * their own WebSocket instances and call these from inside their own
 * connect/reconnect closures - the sockets stay untestable, but the
 * decisions they act on no longer have to be.
 */

export type ExchangeSource = 'binance' | 'bybit';

/** Whether to switch to Bybit after this many consecutive Binance failures.
 *  Already-on-Bybit is unaffected by more failures on a background retry
 *  attempt - only a still-on-Binance caller can trip the switch. */
export function nextSource(
  current: ExchangeSource,
  consecutiveFailures: number,
  maxRetries: number,
): ExchangeSource {
  return consecutiveFailures > maxRetries ? 'bybit' : current;
}

/** PR #1228 / QA's hysteresis ask: Binance must stay open at least
 *  `minStableMs` before a switch back to it commits. Without this, a
 *  Binance connection that opens then drops within a second or two makes
 *  the detector bounce sources on every blip instead of recognising
 *  Binance is still bad. */
export function stableEnoughToSwitchBack(
  connectedAtMs: number,
  nowMs: number,
  minStableMs: number,
): boolean {
  return nowMs - connectedAtMs >= minStableMs;
}

/** PR #1228 review (PM/DevOps): both connect functions were driven entirely
 *  by `onclose`, on the assumption that a failed connection always reaches
 *  it. Two real cases don't: a blackholed connection (packets dropped, no
 *  TCP RST) never fires `error` or `close` until the OS gives up, which can
 *  take tens of seconds or more - the feed sits dead with no failover the
 *  whole time; and `error` firing without a following `close` (confirmed
 *  live in one browser-automation environment while testing this exact PR -
 *  rare in ordinary Chrome, but the code must not depend on the pairing
 *  either way).
 *
 *  Call this once a connect attempt's own timer fires, to confirm the
 *  elapsed time genuinely warrants treating it as failed before doing so -
 *  same defensive re-check `stableEnoughToSwitchBack` above uses, since a
 *  scheduled timer firing is not itself a guarantee of elapsed time in
 *  every runtime. */
export function connectTimedOut(
  startedAtMs: number,
  nowMs: number,
  timeoutMs: number,
): boolean {
  return nowMs - startedAtMs >= timeoutMs;
}
