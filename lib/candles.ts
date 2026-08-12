/* Candle boundaries - closed vs forming, and when the next close lands (#316).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Arena signals were computed over the STILL-FORMING candle. Nothing dropped
 * it: the exchange returns the in-progress bar as the last element and
 * useEMAStrategy used the array as-is. So an EMA cross could appear mid-candle,
 * be shown as a signal, and then un-appear when price moved back before the
 * close. The value displayed was never a value any candle closed at.
 *
 * That is repainting, and it is worse than a delay: a delayed signal was at
 * least true at some point. Owner's decision on #316 was closed candles only.
 *
 * ── EPOCH ALIGNMENT ─────────────────────────────────────────────────────────
 *
 * Every interval we support (1m..1d) divides evenly into a day, and the Unix
 * epoch begins at 00:00 UTC, so candle boundaries land on exact multiples of
 * the interval. That makes `floor(t / intervalMs)` the candle index, which is
 * what the functions below rely on rather than reading timestamps back out of
 * the payload.
 *
 * This would NOT hold for a weekly or monthly interval (a week is not a
 * divisor of the epoch offset, and months vary in length). If either is ever
 * added, these need boundaries derived from the exchange's own candle times.
 */

export const TF_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 3_600_000,
  '2h': 2 * 3_600_000,
  '4h': 4 * 3_600_000,
  '1d': 24 * 3_600_000,
};

/**
 * Grace period after a boundary before we ask for the closed candle.
 *
 * The exchange does not publish a closed candle at boundary+0ms, and our clock
 * is not theirs. Requesting too eagerly gets the previous candle back and the
 * signal stays a full period behind - the exact bug being fixed, arrived at
 * from the other direction.
 */
export const CLOSE_SKEW_MS = 3_000;

/** Milliseconds until the current candle of this interval closes. */
export function msUntilNextClose(intervalMs: number, nowMs: number): number {
  if (!(intervalMs > 0)) return 0;
  const elapsed = ((nowMs % intervalMs) + intervalMs) % intervalMs;
  return intervalMs - elapsed;
}

/**
 * Drop any trailing candle that has not closed yet.
 *
 * Compares each candle's own close time (`time + intervalMs`) against now,
 * rather than blindly removing the last element. Blind removal is wrong twice
 * over: it discards a genuinely closed candle when the payload happens not to
 * include a forming one, and it leaves a forming candle in place if an upstream
 * ever returns more than one trailing partial.
 *
 * Loops from the end because only trailing candles can be unclosed - a gap in
 * the middle is missing data, not a forming bar, and is not this function's
 * problem to solve.
 */
export function dropForming<T extends { time: number }>(
  candles: readonly T[], intervalMs: number, nowMs: number,
): T[] {
  let end = candles.length;
  while (end > 0 && candles[end - 1].time + intervalMs > nowMs) end--;
  return candles.slice(0, end);
}

/**
 * Is a cache entry fetched at `fetchedAt` still describing the current state?
 *
 * True only while no candle has closed since the fetch. This replaces the fixed
 * 5-minute TTL, which was unrelated to the data: on 1m it served a candle five
 * periods old, and on 1d it refetched 96 times to observe one change.
 */
export function sameCandle(fetchedAt: number, intervalMs: number, nowMs: number): boolean {
  if (!(intervalMs > 0)) return false;
  return Math.floor(fetchedAt / intervalMs) === Math.floor(nowMs / intervalMs);
}

/**
 * Exchange interval string to milliseconds, across both dialects (#325).
 *
 * Bybit takes minutes as bare integers plus D/W/M; Binance takes suffixed
 * strings. The klines route deliberately does not translate between them - each
 * caller knows which dialect it wants - so this reads both rather than forcing
 * one.
 *
 * Returns null for anything it does not recognise, including W and M. A week is
 * not a divisor of the epoch offset and months vary in length, so the boundary
 * arithmetic in this file does not hold for them; callers must fall back to a
 * plain TTL rather than compute a wrong boundary.
 */
export function intervalToMs(interval: string): number | null {
  const suffixed = /^(\d+)(m|h|d)$/.exec(interval);
  if (suffixed) {
    const n = Number(suffixed[1]);
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[suffixed[2] as 'm' | 'h' | 'd'];
    return n > 0 ? n * unit : null;
  }
  if (/^\d+$/.test(interval)) {               // bybit minutes
    const n = Number(interval);
    return n > 0 ? n * 60_000 : null;
  }
  if (interval === 'D') return 86_400_000;    // bybit daily
  return null;                                 // W, M, anything unexpected
}
