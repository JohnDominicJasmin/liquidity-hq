/* WHEN THE ARENA PINGS (owner-requested, 2026-11-14). PURE: bars and signals in, a decision out. No audio, no React, no network, so the rules can be tested
 * directly and the page cannot drift from them.
 *
 * TWO TRIGGERS, three tones:
 *   1. SIGNAL  - the strategy panel's signal for the selected coin and timeframe becomes a NEW buy or sell. "New" is the identity of the signal
 *      (direction + the candle it formed on), never a refresh of the same one: the first reading after a coin or timeframe is chosen is only remembered,
 *      and a later reading with a different identity is the ping.
 *   2. MOVE    - once per candle, when the candle still forming BOTH moved and traded unusually: its BODY (|close - open|) is at least 2x the average body of
 *      the last 20 closed candles AND its volume so far is at least 2x the average volume of the same 20. Body, not range: a long wick is a rejection, not a
 *      move, and the owner's words were "big move in the candle". Volume so far is deliberately compared with a FULL closed candle's average, so it only
 *      fires once the unusual volume has really arrived; that is the conservative reading of "always check the volume". */

export interface Bar { timestamp: number; open: number; high: number; low: number; close: number; volume: number }

export const MOVE_LOOKBACK = 20;
export const MOVE_BODY_RATIO = 2;
export const MOVE_VOLUME_RATIO = 2;

export type PingKind = 'buy' | 'sell' | 'move';

/** The identity of a signal, or null when there is no usable signal (still loading, errored, or none). */
export function signalIdentity(sig: { loading?: boolean; error?: unknown; signalTimestamp?: number | null; signalDir?: 'long' | 'short' | null } | null | undefined): string | null {
  if (!sig || sig.loading || sig.error) return null;
  if (sig.signalTimestamp == null || sig.signalDir == null) return null;
  return `${sig.signalDir}:${sig.signalTimestamp}`;
}

/** The ping a change of signal identity earns: only a CHANGE to a real signal, after a baseline has been taken. */
export function pingForSignalChange(prev: string | null | undefined, next: string | null): PingKind | null {
  if (prev === undefined) return null;        // no baseline yet: remember it, do not ping
  if (next == null || next === prev) return null;
  return next.startsWith('long:') ? 'buy' : 'sell';
}

export interface MoveReading { hit: boolean; bodyRatio: number; volumeRatio: number; candleStart: number }

/** Reads the forming candle against the last MOVE_LOOKBACK closed ones. `bars` is oldest first and ends with the forming candle. Null when there is not
 *  enough history, the last bar is not actually forming (a stalled feed), or the averages are zero (nothing to compare with). */
export function readMove(bars: readonly Bar[], tfMs: number, nowMs: number): MoveReading | null {
  if (bars.length < MOVE_LOOKBACK + 1 || !(tfMs > 0)) return null;
  const forming = bars[bars.length - 1];
  if (!(forming.timestamp <= nowMs && nowMs < forming.timestamp + tfMs)) return null;
  const closed = bars.slice(-(MOVE_LOOKBACK + 1), -1);
  if (closed.some(b => ![b.open, b.close, b.volume].every(Number.isFinite))) return null;
  const avgBody = closed.reduce((s, b) => s + Math.abs(b.close - b.open), 0) / closed.length;
  const avgVol = closed.reduce((s, b) => s + b.volume, 0) / closed.length;
  if (!(avgBody > 0) || !(avgVol > 0) || ![forming.open, forming.close, forming.volume].every(Number.isFinite)) return null;
  const bodyRatio = Math.abs(forming.close - forming.open) / avgBody;
  const volumeRatio = forming.volume / avgVol;
  return { hit: bodyRatio >= MOVE_BODY_RATIO && volumeRatio >= MOVE_VOLUME_RATIO, bodyRatio, volumeRatio, candleStart: forming.timestamp };
}
