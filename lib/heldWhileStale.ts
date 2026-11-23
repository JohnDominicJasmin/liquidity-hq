/* THE HOLD BEHIND useHeldWhileStale (#2783), as plain functions so it can be tested without a renderer. A value worked out from a coin's price is held while that price is stale: the last value seen while it was live, for the same coin, or `none` if there never was one. */
export interface Held<T> { coin: string; v: T }

/** The held value after seeing `live` (the value worked out from the current price): unchanged while stale, replaced by `live` while live, restarted on a coin change. Returns the same object when nothing changed. */
export function nextHeld<T>(held: Held<T> | null, coin: string, stale: boolean, live: T): Held<T> | null {
  if (stale) return held;
  return held !== null && held.coin === coin && held.v === live ? held : { coin, v: live };
}

/** What to show: `live` while the price is live; while stale, the held value for this coin, or `none`. */
export function shownWhileStale<T>(held: Held<T> | null, coin: string, stale: boolean, live: T, none: T): T {
  if (!stale) return live;
  return held !== null && held.coin === coin ? held.v : none;
}
