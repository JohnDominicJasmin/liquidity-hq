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
 * strings. The klines route deliberately does not translate between them, so
 * this reads both. Returns null for W and M: a week is not a divisor of the
 * epoch offset and months vary in length, so the boundary arithmetic here does
 * not hold and a caller must fall back rather than compute a wrong boundary.
 */
export function intervalToMs(interval: string): number | null {
  const suffixed = /^(\d+)(m|h|d)$/.exec(interval);
  if (suffixed) {
    const n = Number(suffixed[1]);
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[suffixed[2] as 'm' | 'h' | 'd'];
    return n > 0 ? n * unit : null;
  }
  if (/^\d+$/.test(interval)) { const n = Number(interval); return n > 0 ? n * 60_000 : null; }
  if (interval === 'D') return 86_400_000;
  return null;
}

/**
 * Cache TTL for a closed-candle klines request (#325, second attempt).
 *
 * ── THE FLOOR IS THE WHOLE POINT ────────────────────────────────────────────
 *
 * The first attempt was `msUntilNextClose + CLOSE_SKEW_MS` with no floor. That
 * bottoms out at the skew - four seconds - just before any close, on every
 * interval, and #316 synchronises every client onto exactly that instant.
 * Binance answered with 418, their ban code, on both non-prod environments.
 *
 *     4h  mid-candle          7203 s
 *     4h  1s before close        4 s      <- the ban
 *
 * `fallbackTtlMs` is the caller's existing TTL - `ttlFor(interval)` in the
 * route. Taking the MAXIMUM means this can only ever make the cache live
 * LONGER than it did before the feature existed, so more upstream traffic than
 * the pre-#325 baseline is impossible by construction rather than by anyone
 * remembering to check.
 *
 * The cost is honest: an entry written in the last moments of a candle serves
 * the old candle for up to `fallbackTtlMs` past the close, which is exactly the
 * behaviour before #325. The feature degrades to the old behaviour in the
 * narrow window where being aggressive is dangerous, and keeps the benefit
 * across the rest of the candle, where an entry written mid-candle still
 * expires at the close.
 */
export function closedCandleTtl(intervalMs: number, fallbackTtlMs: number, nowMs: number): number {
  return Math.max(msUntilNextClose(intervalMs, nowMs) + CLOSE_SKEW_MS, fallbackTtlMs);
}

export interface Bar {
  timestamp: number; open: number; high: number; low: number; close: number; volume: number;
}

/**
 * The bars that closed while the stream was down (#313).
 *
 * #309 restores the socket; it does not recover the candles that closed while it
 * was gone. getBars only runs on mount and on a symbol/period change, so the
 * chart resumed live with a hole where the outage was — and **a hole in a candle
 * series is not visibly a hole.** It is a chart that looks fine and is wrong.
 *
 * ASCENDING ORDER IS LOAD-BEARING. klinecharts' update path upserts by
 * timestamp, so bars must arrive oldest-first; delivered newest-first, each
 * older bar overwrites the newer one and the chart ends up showing the START of
 * the gap as its latest candle.
 *
 * STRICTLY AFTER `since`, never inclusive. Re-delivering the bar the stream
 * already gave us would rewrite a candle the user watched form, with a version
 * fetched later — same timestamp, different close.
 */
export function barsAfter(rows: readonly Bar[], since: number): Bar[] {
  if (!since) return [];        // nothing streamed yet: getBars owns the series
  return rows.filter(b => b.timestamp > since).sort((a, b) => a.timestamp - b.timestamp);
}
