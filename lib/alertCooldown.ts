/* Per-recipient-independent alert cooldown ledger for
 * app/api/telegram/alert/route.ts (#1227).
 *
 * Moved out of the route rather than exported from it: Next's App Router
 * route-segment validation only allows a fixed set of named exports from a
 * route file (GET, POST, dynamic, revalidate, ...) - anything else fails the
 * build with "... is not a valid Route export field". lib/apiHealth.ts's
 * shouldWrite/lastWrite is the same shape: a module-level Map plus exported
 * functions operating on it, moved here so QA can test the cooldown logic
 * directly rather than only through a live alert run.
 */

const lastSent = new Map<string, number>();

/** True if `key` fired within the last `ms` milliseconds. */
export function onCooldown(key: string, ms: number): boolean {
  const t = lastSent.get(key);
  return t !== undefined && Date.now() - t < ms;
}

/** Records `key` as having fired just now. */
export function markSent(key: string): void {
  lastSent.set(key, Date.now());
}

/** Clears the cooldown ledger. Exported for tests only (#1227) - a real
 *  caller has no reason to ever reset this; every key keeps its history for
 *  the life of the process by design. */
export function _resetAlertCooldownState(): void {
  lastSent.clear();
}
