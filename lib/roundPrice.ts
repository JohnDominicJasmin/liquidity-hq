/* A "round number" price for the Behavioral Bias anchoring count (#1631, audit 2026-11-16). PURE.
 *
 * The old test was `sl % 100 === 0`: it counted a stop of 0 (an unset stop) and any multiple of 100, and it could never match a coin
 * priced under 100, so most of the coin list had no anchoring count at all. Round is now relative to the price's own size: a price with
 * TWO OR FEWER significant digits (64,000, 3,500, 150, 2.5, 0.12). Zero, negatives and non-numbers are never round. */
export function isRoundPrice(x: number): boolean {
  if (!Number.isFinite(x) || x <= 0) return false;
  const twoDigits = Number(x.toPrecision(2));
  /* A relative tolerance, so a binary rounding error (0.1 + 0.2) does not make a round number look precise. */
  return Math.abs(twoDigits - x) <= x * 1e-9;
}

/** A trade's stop loss read as a number: the column arrives as a number or a numeric string. null when it is missing or not a number. */
export function stopLossNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
