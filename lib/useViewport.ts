'use client';
import { useSyncExternalStore } from 'react';

/* Which layout is on screen, as state rather than as CSS (#413).
 *
 * The redesign gives several screens two DIFFERENT layouts, not one responsive
 * one (README:191). Rendering both and hiding one with display:none looks
 * equivalent and is not: a hidden subtree still MOUNTS. On Arena that meant two
 * KLineProChart instances live at once - two candle subscriptions, two
 * indicator passes, and the owner seeing two charts on the page the moment the
 * hidden one was given real content to render.
 *
 * So the component picks a tree instead of drawing both.
 *
 * useSyncExternalStore rather than useState + an effect: the value is read from
 * an external source (matchMedia), which is exactly what this hook is for, and
 * it avoids the react-hooks/set-state-in-effect warning the codebase already
 * carries 130 of.
 *
 * SERVER SNAPSHOT IS DESKTOP. There is no viewport during prerender, so one has
 * to be assumed; desktop is the safer guess because the mobile tree omits
 * panels (the rail, SET ALERT) and a first paint that drops UI then adds it is
 * worse than one that shows it and reflows.
 */

const MOBILE_QUERY = '(max-width: 899px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

/** True when the mobile layout should render. Breakpoint matches globals.css. */
export function useIsMobileLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
