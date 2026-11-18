/* How long a live socket waits before its next reconnect attempt. ONE rule for every browser feed (chart, liquidation feed, whale
 * trades, market prices, cascade detector).
 *
 * QA, 2026-11-18, a real 90-minute offline + hidden run on prod: the page opened ~1,554 sockets, one every ~3.5 s. Each loop kept
 * its short online delay while the browser had no network or nobody was looking. So:
 *   - online AND visible: the loop's own delay, unchanged (`normalMs`, or the chart's 1 s, 2 s, 4 s ... 30 s when none is given);
 *   - offline OR hidden:  min(30 s, 1 s x 2^attempt), never under 5 s.
 * The `online` event and the tab becoming visible reconnect at once and reset the attempt count (each feed wires that itself, with
 * onBackOnline below and onPageResume in lib/socketResume.ts). Pure, so the table can be tested without a socket or a clock. */

export const OFFLINE_BACKOFF_FLOOR_MS = 5_000;
export const OFFLINE_BACKOFF_CAP_MS = 30_000;

export type LinkState = { online: boolean; visible: boolean };

export function reconnectDelayMs(attempt: number, opts: LinkState & { normalMs?: number }): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  if (opts.online && opts.visible) {
    if (opts.normalMs != null && Number.isFinite(opts.normalMs) && opts.normalMs >= 0) return opts.normalMs;
    return Math.min(1000 * 2 ** Math.max(0, n - 1), OFFLINE_BACKOFF_CAP_MS);
  }
  return Math.min(OFFLINE_BACKOFF_CAP_MS, Math.max(OFFLINE_BACKOFF_FLOOR_MS, 1000 * 2 ** n));
}

/** The page's current network and visibility. Outside a browser both read true, so the normal delay applies. */
export function linkState(): LinkState {
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  return { online, visible };
}

/** Calls `fn` when the browser reports the network is back. Returns the unsubscribe. */
export function onBackOnline(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('online', fn);
  return () => window.removeEventListener('online', fn);
}
