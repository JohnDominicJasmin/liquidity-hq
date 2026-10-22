/* #1651 Layer 1, "sanity checks at the edge": one place that decides whether a long/short pair from an exchange is usable.
 *
 * Every entry point used to do its own `parseFloat(item.buyRatio || '0.5')` or a bare `parseFloat`, which produced two different
 * untruths from the same missing field: a fabricated 50/50 that looks measured, or a NaN that passes a `!= null` check and reaches the
 * screen as "NaN%". Both are the failure class the tracker names - an unknown rendered as a value.
 *
 * The pair is accepted only if BOTH sides parse, both sit in [0, 1], and they sum to 1 within a cent. Bybit (buyRatio/sellRatio) and
 * Binance (longAccount/shortAccount) both report fractions of accounts on each side, so the two always sum to 1 when the row is whole;
 * a pair that does not is a row we do not understand, and guessing which half is right is how a wrong number ships.
 *
 * Returning null means UNKNOWN, and callers must render it as unknown rather than substituting anything. */

/** 1% of absolute, not of either side: the two are reported to 4 decimal places and rounding alone moves the sum by ~0.0002. */
const SUM_TOLERANCE = 0.01;

function one(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

/**
 * A validated long/short pair, or null when the exchange's row is missing, unparsable, out of range, or does not add up.
 * Never substitutes a default - that is the whole point of it.
 */
export function parseRatioPair(longSide: unknown, shortSide: unknown): { longRatio: number; shortRatio: number } | null {
  const longRatio = one(longSide);
  const shortRatio = one(shortSide);
  if (longRatio === null || shortRatio === null) return null;
  if (Math.abs(longRatio + shortRatio - 1) > SUM_TOLERANCE) return null;
  return { longRatio, shortRatio };
}
