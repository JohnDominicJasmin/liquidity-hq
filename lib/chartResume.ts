/* What the chart does when the tab comes back (visible again, restored from the back/forward cache, or unfrozen).
 *
 * The owner left the Arena open for 1-2 hours and came back to an empty chart until a refresh. While a tab is hidden the browser
 * throttles its timers to about once a minute, may freeze it entirely, and a laptop sleep kills its sockets without a close event;
 * on return the network can take a few seconds to come back. So on every resume the chart checks itself instead of waiting for a
 * timer: Pure, so it can be tested without a chart, a socket or a clock. */

/** How many candles the gap backfill can refill after a reconnect (it asks the exchange for this many of the latest). A gap wider
 *  than this cannot be patched by the stream and the whole history is reloaded instead. */
export const RESUME_BACKFILL_CANDLES = 450;

/** A socket that has said nothing for this long is not trusted on resume, even if its readyState still says OPEN. */
export const RESUME_QUIET_MS = 30_000;

export type ResumeAction =
  | { do: 'none' }
  | { do: 'reconnect'; reason: string }   // drop the socket and open a new one now; its open backfills the gap
  | { do: 'reload'; reason: string };     // load the history again (the chart keeps the candles it has if that load fails)

export function resumeAction(i: {
  /** Timestamp (open time, ms) of the newest candle on the chart, or null when the chart holds none. */
  lastBarTs: number | null;
  /** Length of one candle of the selected timeframe, ms. */
  periodMs: number | null;
  now: number;
  /** Whether the live socket exists and is OPEN. */
  socketOpen: boolean;
  /** When the live socket last delivered anything (candle or pong), ms; null when there is no socket. */
  lastMsgAt: number | null;
}): ResumeAction {
  if (i.lastBarTs == null || !Number.isFinite(i.lastBarTs)) return { do: 'reload', reason: 'no candles on the chart' };
  if (i.periodMs == null || !(i.periodMs > 0) || !Number.isFinite(i.now)) {
    return i.socketOpen ? { do: 'none' } : { do: 'reconnect', reason: 'socket not open' };
  }
  const behind = Math.floor((i.now - i.lastBarTs) / i.periodMs);
  if (behind > RESUME_BACKFILL_CANDLES) return { do: 'reload', reason: `newest candle is ${behind} candles old` };
  if (!i.socketOpen) return { do: 'reconnect', reason: 'socket not open' };
  if (i.lastMsgAt == null || i.now - i.lastMsgAt > RESUME_QUIET_MS) return { do: 'reconnect', reason: `socket quiet for ${i.lastMsgAt == null ? '?' : Math.round((i.now - i.lastMsgAt) / 1000)} s` };
  if (behind >= 2) return { do: 'reconnect', reason: `newest candle is ${behind} candles old` };
  return { do: 'none' };
}
