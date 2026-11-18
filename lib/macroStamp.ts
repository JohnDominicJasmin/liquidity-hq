/** A macro quote older than this is a closed-market value (or a stale one), not a live one: gold and oil futures trade about 23 hours a day, equities and the dollar index close for the night and the weekend. */
export const MACRO_STALE_AFTER_MS = 4 * 3600_000;

/** The weekday of a macro quote's own time when that quote is OLD enough to need a stamp ("Fri" for a Friday close seen on Sunday), or null when it is fresh, unknown or in the future. The caller formats the day for the viewer's language. */
export function macroStampDate(asOfMs: number | null | undefined, nowMs: number): Date | null {
  if (typeof asOfMs !== 'number' || !Number.isFinite(asOfMs) || asOfMs <= 0) return null;
  const age = nowMs - asOfMs;
  if (age <= MACRO_STALE_AFTER_MS) return null;
  return new Date(asOfMs);
}
