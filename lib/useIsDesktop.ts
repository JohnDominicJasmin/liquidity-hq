'use client';
import { useSyncExternalStore } from 'react';

/* Same technique landing.md and arena.md both require independently:
 * "Select with useSyncExternalStore over matchMedia... and render one tree."
 * A plain useState+useEffect resize hook defaults to desktop on first render
 * even on a mobile device, so the wrong tree mounts briefly -
 * useSyncExternalStore reads the real value synchronously on the client
 * instead of after a post-mount effect. Breakpoint 768px per both specs. */
function subscribeViewport(cb: () => void) {
  const mql = window.matchMedia('(min-width: 768px)');
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}
function getViewportSnapshot() { return window.matchMedia('(min-width: 768px)').matches; }
function getServerViewportSnapshot() { return true; }

export function useIsDesktop() {
  return useSyncExternalStore(subscribeViewport, getViewportSnapshot, getServerViewportSnapshot);
}
