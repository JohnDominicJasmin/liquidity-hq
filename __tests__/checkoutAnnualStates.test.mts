/* The three states /upgrade can be in (#372).
 *
 * The annual plan is code-complete and waiting on one value: the owner pasting
 * `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_ANNUAL`. So the work worth doing now is
 * pinning what happens in each state, so the issue closes on a paste rather
 * than on a fresh round of code.
 *
 *   1. both set        monthly and annual side by side
 *   2. monthly only    pixel-identical to today  <-- the state qa/staging is in
 *   3. neither         the coming-soon block
 *
 * STATE 2 IS THE NORMAL ONE DURING ROLLOUT, not an edge case. No non-prod
 * service will have the annual URL the moment it is created, so "annual missing
 * -> show monthly only" is what every environment does first. A rollout that
 * only works once both variables exist is a rollout that breaks on the way in.
 *
 * THE OTHER HALF: THE INLINING TRAP. #243 was `env.NEXT_PUBLIC_X` read off a
 * passed-in object, which Next does NOT inline into the client bundle - so the
 * predicate was permanently false in the browser and Pro was unbuyable through
 * the UI in every environment while /api/version cheerfully reported
 * `checkout: true` from the server. A test that only exercises the injectable
 * `env` parameter proves nothing about the bundle, so the source assertions at
 * the bottom guard the shape that made it work.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkoutBase, checkoutBaseAnnual, isCheckoutConfigured, isCheckoutConfiguredAnnual,
} from '../lib/checkout.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKOUT = readFileSync(path.join(ROOT, 'lib', 'checkout.ts'), 'utf8');
const UPGRADE = readFileSync(path.join(ROOT, 'app', 'upgrade', 'page.tsx'), 'utf8');

const MONTHLY = 'https://store.lemonsqueezy.com/checkout/buy/monthly-uuid';
const ANNUAL = 'https://store.lemonsqueezy.com/checkout/buy/annual-uuid';

const state = (monthly?: string, annual?: string) => ({
  NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL: monthly,
  NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_ANNUAL: annual,
});

test('state 1 - both set', () => {
  const env = state(MONTHLY, ANNUAL);
  assert.equal(isCheckoutConfigured(env), true);
  assert.equal(isCheckoutConfiguredAnnual(env), true);
  assert.equal(checkoutBase(env), MONTHLY);
  assert.equal(checkoutBaseAnnual(env), ANNUAL);
});

test('state 2 - monthly only, which is what every environment starts as', () => {
  const env = state(MONTHLY, undefined);
  assert.equal(isCheckoutConfigured(env), true);
  assert.equal(isCheckoutConfiguredAnnual(env), false,
    'annual reports configured with no URL - /upgrade would render a button that goes nowhere');
  assert.equal(checkoutBaseAnnual(env), null);
});

test('state 3 - neither', () => {
  const env = state(undefined, undefined);
  assert.equal(isCheckoutConfigured(env), false);
  assert.equal(isCheckoutConfiguredAnnual(env), false);
});

test("'#' is unset for annual too, not a URL", () => {
  /* The placeholder the variable carries before a store is live. Treating it as
     a URL sends a buyer to a page whose address is a fragment - and the monthly
     side already handles it, so the annual side agreeing is what stops the two
     halves disagreeing about whether Pro is buyable. */
  const env = state('#', '#');
  assert.equal(isCheckoutConfigured(env), false);
  assert.equal(isCheckoutConfiguredAnnual(env), false);
  assert.equal(checkoutBaseAnnual(state(MONTHLY, '#')), null);
});

test('an empty string is unset, which is what an unfilled Render field gives', () => {
  const env = state('', '');
  assert.equal(isCheckoutConfigured(env), false);
  assert.equal(isCheckoutConfiguredAnnual(env), false);
});

test('the annual URL is never silently substituted by the monthly one', () => {
  /* The failure the issue warns about in as many words: a second button
     pointing at the monthly product charges the wrong amount and looks like it
     worked. Nothing in the annual path may fall back to the monthly value. */
  const env = state(MONTHLY, undefined);
  assert.equal(checkoutBaseAnnual(env), null);
  assert.notEqual(checkoutBaseAnnual(env), MONTHLY);
  assert.equal(/INLINED_MONTHLY/.test(CHECKOUT.slice(CHECKOUT.indexOf('checkoutBaseAnnual'))), false,
    'the annual reader references the monthly constant - that is the wrong-amount bug');
});

test('/upgrade branches on both flags, in the order that makes state 2 safe', () => {
  /* Source-asserted because the states are a render, and the ORDER is the part
     that matters: `both ? … : monthly ? … : coming-soon`. Testing `monthly`
     first would show the monthly-only layout even when annual is configured. */
  assert.match(UPGRADE, /CHECKOUT_CONFIGURED && CHECKOUT_ANNUAL_CONFIGURED \?/);
  assert.match(UPGRADE, /\) : CHECKOUT_CONFIGURED \?/);
  const both = UPGRADE.indexOf('CHECKOUT_CONFIGURED && CHECKOUT_ANNUAL_CONFIGURED');
  const monthlyOnly = UPGRADE.indexOf(') : CHECKOUT_CONFIGURED ?');
  assert.ok(both > 0 && monthlyOnly > both,
    'the monthly-only branch is tested before the both branch - annual would never render');
});

test('the inlining trap has not come back', () => {
  /* #243. `env.NEXT_PUBLIC_X` off a passed-in object is NOT inlined into the
     client bundle, so the predicate was permanently false in the browser while
     /api/version reported true from the server - Pro was unbuyable through the
     UI in every environment and nothing said so.

     The fix was reading the literal `process.env.NEXT_PUBLIC_*` at module scope
     and defaulting to THAT rather than to `= process.env`. These assertions
     pin the shape, because the injectable `env` parameter above cannot detect
     its loss: every test in this file would still pass. */
  assert.match(CHECKOUT, /const INLINED_MONTHLY = process\.env\.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL;/);
  assert.match(CHECKOUT, /const INLINED_ANNUAL\s*= process\.env\.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_ANNUAL;/);
  assert.equal(/env: Record<string, string \| undefined> = process\.env/.test(CHECKOUT), false,
    'a `= process.env` default parameter is back - that is the #243 bug exactly, and it is invisible at runtime on the server');
});

test('CONTROL: these predicates can return true', () => {
  /* Most assertions here are `false` or `null`. A predicate stuck on false, or
     a reader stuck on null, satisfies nearly all of them. */
  assert.equal(isCheckoutConfigured(state(MONTHLY, ANNUAL)), true);
  assert.equal(isCheckoutConfiguredAnnual(state(MONTHLY, ANNUAL)), true);
  assert.equal(checkoutBaseAnnual(state(MONTHLY, ANNUAL)), ANNUAL);
  assert.notEqual(UPGRADE.indexOf('CHECKOUT_ANNUAL_CONFIGURED'), -1, 'the upgrade page never mentions the annual flag');
});
