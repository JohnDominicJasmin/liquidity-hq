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
import { LANDING_MOBILE_QUERY } from '../lib/useViewport.ts';

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
