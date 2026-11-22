/* WHEN A PRICE THE ROUTE ANSWERED WAS LAST GOOD (#2783). The proxy serves its last good body, flagged `x-data-stale: 1` with `x-data-age-ms`, when Binance refuses. This turns those two headers into the moment of that body, or null when the answer was live.
 * A stale answer whose age is missing or unreadable is taken as the route's bound (60 minutes), never as fresh. `Number(null)` is 0, so an absent header has to be read as absent BEFORE it becomes a number (QA, #2783: a flagged answer with no age header said "just now"). */
export const STALE_BOUND_MS = 60 * 60_000;

export function staleAtFromHeaders(flag: string | null, ageRaw: string | null, now: number): number | null {
  if (flag !== '1') return null;
  const age = ageRaw == null || ageRaw.trim() === '' ? NaN : Number(ageRaw);
  return now - (Number.isFinite(age) && age >= 0 ? age : STALE_BOUND_MS);
}
