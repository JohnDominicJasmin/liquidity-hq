/* #413 - the two breakpoints, and why there are two.
 *
 * Landing switches at 768 and the app screens at 900. Those are two designs,
 * not one scale, and the risk is someone "tidying" them into one constant.
 * These tests pin both numbers and say which spec each comes from.
 *
 * The hook itself needs a DOM, so what is asserted here is the QUERY - the
 * part that is pure, and the part that would silently change behaviour if it
 * drifted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANDING_MOBILE_QUERY, mediaStoreFor } from '../lib/useViewport.ts';

test('landing switches at 768, per its own spec', () => {
  // Landing spec: "Breakpoint: 768px. Below it, mobile layout; at and above
  // it, desktop." So the max-width query must stop at 767 - a query of
  // (max-width: 768px) would put 768 itself on the mobile layout, one pixel
  // wrong in the direction nobody would notice.
  assert.equal(LANDING_MOBILE_QUERY, '(max-width: 767px)');
});

test('the landing query is exclusive of the breakpoint itself', () => {
  const px = Number(LANDING_MOBILE_QUERY.match(/(\d+)px/)![1]);
  assert.equal(px, 767, 'at exactly 768 the desktop layout must render');
});

/* ── identity stability, which is what QA caught on #443 ────────────────── */

test('the subscribe/getSnapshot pair is STABLE across calls for one query', () => {
  // useSyncExternalStore compares `subscribe` by IDENTITY. Building the closure
  // inside the hook returns a new function every render, so React tears the
  // listener down and re-adds it on each one. Invisible to a value assertion -
  // which is why this test compares references, not results.
  const a = mediaStoreFor(LANDING_MOBILE_QUERY);
  const b = mediaStoreFor(LANDING_MOBILE_QUERY);
  assert.equal(a.subscribe, b.subscribe, 'subscribe identity changed - React will resubscribe every render');
  assert.equal(a.getSnapshot, b.getSnapshot, 'getSnapshot identity changed');
});

test('different queries get different stores - the parameter still works', () => {
  // The cache must not collapse two breakpoints into one, which would silently
  // give landing the app's 900 breakpoint.
  const landing = mediaStoreFor(LANDING_MOBILE_QUERY);
  const app     = mediaStoreFor('(max-width: 899px)');
  assert.notEqual(landing.subscribe, app.subscribe);
});
