/* Live feeds after the tab comes back (owner, 2026-11-18: after 1-2 h idle the page needed a refresh). While hidden the browser
 * throttles timers and a sleep can kill a socket without a close event, so a feed's own reconnect timer may not have run. On resume a
 * feed whose socket is not OPEN, or has said nothing for RESUME_QUIET_MS, is replaced at once. Same rule as the chart
 * (lib/chartResume.ts). */
import { RESUME_QUIET_MS } from './chartResume.ts';

export function socketNeedsReconnect(readyState: number | null | undefined, lastMsgAt: number | null, now: number, quietMs: number = RESUME_QUIET_MS): boolean {
  if (readyState !== 1 /* OPEN */) return true;
  if (lastMsgAt == null || !Number.isFinite(lastMsgAt)) return true;
  return now - lastMsgAt > quietMs;
}

/** Close a socket WITHOUT its handlers: its onclose would otherwise schedule a second reconnect on top of the one the caller makes. */
export function dropSocket(ws: WebSocket | null | undefined): void {
  if (!ws) return;
  ws.onopen = null; ws.onclose = null; ws.onerror = null; ws.onmessage = null;
  try { ws.close(); } catch { /* already gone */ }
}

/** Calls `fn` when the page becomes visible again, is restored from the back/forward cache, or is unfrozen. Returns the unsubscribe. */
export function onPageResume(fn: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const vis = () => { if (document.visibilityState === 'visible') fn(); };
  const show = (e: PageTransitionEvent) => { if (e.persisted) fn(); };
  document.addEventListener('visibilitychange', vis);
  document.addEventListener('resume', vis);
  window.addEventListener('pageshow', show);
  return () => {
    document.removeEventListener('visibilitychange', vis);
    document.removeEventListener('resume', vis);
    window.removeEventListener('pageshow', show);
  };
}
