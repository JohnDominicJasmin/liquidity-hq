'use client';
import { useSyncExternalStore } from 'react';

/* Which layout is on screen, as state rather than as CSS (#413).
 *
 * The redesign gives several screens two DIFFERENT layouts, not one responsive
 * one. Rendering both and hiding one with display:none looks equivalent and is
 * not: a hidden subtree still MOUNTS.
 *
 * That is not theoretical here. The landing spec calls it out directly - both
 * trees mounted would mean two ticker subscriptions against
 * wss://stream.binance.com, and acceptance criterion 31 counts WebSocket
 * constructions before page load to prove there is exactly one. Criterion 30
 * asserts the inactive tree is ABSENT from the DOM, tested by node count
 * rather than computed display, for the same reason.
 *
 * So the component picks a tree instead of drawing both.
 *
 * useSyncExternalStore rather than useState + an effect: the value is read from
 * an external source (matchMedia), which is what this hook is for, and it
 * avoids the react-hooks/set-state-in-effect warning the codebase already
 * carries 131 of.
 *
 * SERVER SNAPSHOT IS DESKTOP. There is no viewport during prerender, so one has
 * to be assumed; desktop is the safer guess because the mobile trees omit
 * panels, and a first paint that drops UI then adds it is worse than one that
 * shows it and reflows.
 */

/** App screens switch at 900. */
const APP_MOBILE_QUERY = '(max-width: 899px)';

/* Landing switches at 768, per its own spec: "Breakpoint: 768px. Below it,
   mobile layout; at and above it, desktop."
   Two numbers because they are two designs, not one scale. Passing the query in
   keeps that visible rather than hiding it behind a single constant that
   quietly serves both and drifts. */
export const LANDING_MOBILE_QUERY = '(max-width: 767px)';

function subscribeTo(query: string) {
  return (onChange: () => void): (() => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  };
}

function snapshotOf(query: string) {
  return (): boolean => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  };
}

/** True when the mobile layout should render, for the given media query. */
export function useMobileLayout(query: string = APP_MOBILE_QUERY): boolean {
  return useSyncExternalStore(subscribeTo(query), snapshotOf(query), () => false);
}

/** App screens: mobile below 900. Breakpoint matches globals.css. */
export function useIsMobileLayout(): boolean {
  return useMobileLayout(APP_MOBILE_QUERY);
}
