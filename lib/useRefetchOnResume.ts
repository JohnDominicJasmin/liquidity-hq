'use client';
/* Re-read a poller's data when the tab comes back (owner sweep 2026-11-18). A hidden tab's timers run about once a minute or not at
 * all, so a widget that polls every few minutes could show data from before the user left until its next tick. On visible / pageshow
 * (back-forward cache) / resume (unfrozen), after the page was away for at least `minAwayMs`, `refetch` runs once. Short tab switches
 * do not trigger it. */
import { useEffect, useRef } from 'react';
import { onPageResume } from './socketResume.ts';

export const REFETCH_MIN_AWAY_MS = 30_000;

export function useRefetchOnResume(refetch: () => unknown, minAwayMs: number = REFETCH_MIN_AWAY_MS): void {
  const fnRef = useRef(refetch);
  useEffect(() => { fnRef.current = refetch; }, [refetch]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    const onHide = () => { if (document.visibilityState === 'hidden' && hiddenAt === null) hiddenAt = Date.now(); };
    const onFreeze = () => { if (hiddenAt === null) hiddenAt = Date.now(); };
    document.addEventListener('visibilitychange', onHide);
    document.addEventListener('freeze', onFreeze);
    window.addEventListener('pagehide', onFreeze);  // left for the back/forward cache
    const off = onPageResume(() => {
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= minAwayMs) { try { void fnRef.current(); } catch { /* the poller's own error handling applies */ } }
    });
    return () => { document.removeEventListener('visibilitychange', onHide); document.removeEventListener('freeze', onFreeze); window.removeEventListener('pagehide', onFreeze); off(); };
  }, [minAwayMs]);
}
