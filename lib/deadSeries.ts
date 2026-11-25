/* A SERIES THAT DID NOT MOVE HAS NO READING (#1651).
 *
 * An average of a stuck price is that price, a ribbon of it is "no clear setup", an oscillator of it sits mid-range: all of them look
 * like a balanced market. The honest answer is a third state, "not enough movement to judge". Same idea as the RSI, which already reads
 * nothing when none of its last 14 closes moved (lib/rsi.ts).
 *
 * Deliberately narrow, so a quiet but trading market is never caught: either every one of the last 20 closes is the same price, or more
 * than half of the last 20 candles traded nothing at all. Measured 2026-10-30 on the thinnest listed coin over 300 hourly candles: one
 * flat hour. */

export const DEAD_WINDOW = 20;

export function notEnoughMovement(candles: ReadonlyArray<{ close: number; volume?: number }>): boolean {
  if (candles.length < DEAD_WINDOW) return false;   // too short to say anything: each indicator's own warm-up rule covers that
  const tail = candles.slice(-DEAD_WINDOW);
  if (tail.every(c => c.close === tail[0].close)) return true;
  return tail.filter(c => c.volume === 0).length > DEAD_WINDOW / 2;
}
