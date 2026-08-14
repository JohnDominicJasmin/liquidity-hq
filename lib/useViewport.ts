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

/* ONE STABLE PAIR PER QUERY, CACHED AT MODULE LEVEL.
 *
 * useSyncExternalStore compares `subscribe` BY IDENTITY. Building the closure
 * inside the hook returns a new function every render, so React tears the
 * listener down and re-adds it on each one - and does the same for
 * getSnapshot. Not user-visible, and not free either: it is an
 * addEventListener/removeEventListener pair per render on a hook the landing
 * page calls on every section.
 *
 * Caching by the query string keeps the identity stable for the life of the
 * module while still allowing more than one breakpoint, which is the whole
 * reason the query is a parameter. The map is bounded by the number of
 * distinct queries in the codebase - two.
 *
 * Caught by QA on #443. The tests below could not have found it: identity
 * stability is invisible to a value assertion, which is why the fix ships with
 * a test that compares references rather than results. */
const CACHE = new Map<string, { subscribe: (cb: () => void) => () => void; getSnapshot: () => boolean }>();

function storeFor(query: string) {
  let entry = CACHE.get(query);
  if (!entry) {
    entry = {
      subscribe: (onChange: () => void) => {
        if (typeof window === 'undefined' || !window.matchMedia) return () => {};
        const mq = window.matchMedia(query);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
      },
      getSnapshot: () => {
        if (typeof window === 'undefined' || !window.matchMedia) return false;
        return window.matchMedia(query).matches;
      },
    };
    CACHE.set(query, entry);
  }
  return entry;
}

/** The cached store for a query. Exported so its identity can be tested. */
export function mediaStoreFor(query: string) { return storeFor(query); }

/** Server snapshot. Hoisted for the same identity reason as the pair above. */
const SERVER_SNAPSHOT = () => false;

/** True when the mobile layout should render, for the given media query. */
export function useMobileLayout(query: string = APP_MOBILE_QUERY): boolean {
  const { subscribe, getSnapshot } = storeFor(query);
  return useSyncExternalStore(subscribe, getSnapshot, SERVER_SNAPSHOT);
}

/** App screens: mobile below 900. Breakpoint matches globals.css. */
export function useIsMobileLayout(): boolean {
  return useMobileLayout(APP_MOBILE_QUERY);
}
