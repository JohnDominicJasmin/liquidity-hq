/* The third plan's link (#1400), pinned the same way the annual one is in
 * checkoutAnnualStates.test.mts - and for the same reason: the plan is
 * code-complete and waits on one value, the owner pasting
 * `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_FORTNIGHTLY`. Every environment will
 * be in the "not set" state first, so "unset -> no button, and never the
 * monthly link instead" is the behaviour that has to hold on the way in.
 *
 * The one rule that is new here: the two-weekly plan is ADDITIVE. It renders
 * only inside a state that already has the monthly anchor (both, or monthly
 * only), never on its own and never in the coming-soon branch - a two-weekly
 * link without a monthly one must show nothing, exactly as annual does. The
 * annual test's pinned branching order must still hold afterwards; that test
 * is left untouched and this one asserts the addition did not move it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkoutBase, checkoutBaseAnnual, checkoutBaseFortnightly,
  isCheckoutConfigured, isCheckoutConfiguredAnnual, isCheckoutConfiguredFortnightly,
} from '../lib/checkout.ts';
import { configuredFlags } from '../lib/configured.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKOUT = readFileSync(path.join(ROOT, 'lib', 'checkout.ts'), 'utf8');
const UPGRADE = readFileSync(path.join(ROOT, 'app', 'upgrade', 'page.tsx'), 'utf8');

const MONTHLY = 'https://store.lemonsqueezy.com/checkout/buy/monthly-uuid';
const ANNUAL = 'https://store.lemonsqueezy.com/checkout/buy/annual-uuid';
const FORTNIGHTLY = 'https://store.lemonsqueezy.com/checkout/buy/fortnightly-uuid';

const state = (monthly?: string, annual?: string, fortnightly?: string) => ({
  NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL: monthly,
  NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_ANNUAL: annual,
  NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_FORTNIGHTLY: fortnightly,
});

test('all three set', () => {
  const env = state(MONTHLY, ANNUAL, FORTNIGHTLY);
  assert.equal(isCheckoutConfiguredFortnightly(env), true);
  assert.equal(checkoutBaseFortnightly(env), FORTNIGHTLY);
  assert.equal(checkoutBase(env), MONTHLY);
  assert.equal(checkoutBaseAnnual(env), ANNUAL);
});

test('monthly only - the state every environment starts in - reports the two-weekly plan as NOT configured', () => {
  const env = state(MONTHLY, undefined, undefined);
  assert.equal(isCheckoutConfigured(env), true);
  assert.equal(isCheckoutConfiguredFortnightly(env), false, 'two-weekly reports configured with no URL - /upgrade would render a button that goes nowhere');
  assert.equal(checkoutBaseFortnightly(env), null);
});

test("'#', empty and whitespace-free unset all mean unset for the two-weekly link, the same as the other two", () => {
  for (const v of ['#', '', undefined]) {
    assert.equal(isCheckoutConfiguredFortnightly(state(MONTHLY, ANNUAL, v)), false, `value ${JSON.stringify(v)} must be unset`);
    assert.equal(checkoutBaseFortnightly(state(MONTHLY, ANNUAL, v)), null);
  }
});

test('the two-weekly URL is never silently substituted by the monthly (or annual) one', () => {
  /* The failure #1400 names: a button pointing at the wrong product charges the
     wrong amount and looks like it worked. Nothing in the two-weekly reader may
     fall back to another plan's value. */
  const env = state(MONTHLY, ANNUAL, undefined);
  assert.equal(checkoutBaseFortnightly(env), null);
  assert.notEqual(checkoutBaseFortnightly(env), MONTHLY);
  assert.notEqual(checkoutBaseFortnightly(env), ANNUAL);
  const reader = CHECKOUT.slice(CHECKOUT.indexOf('checkoutBaseFortnightly'));
  assert.equal(/INLINED_MONTHLY|INLINED_ANNUAL/.test(reader), false, 'the two-weekly reader references another plan\'s constant - that is the wrong-amount bug');
});

test('the inlining trap has not come back for the third variable (#243)', () => {
  assert.match(CHECKOUT, /const INLINED_FORTNIGHTLY\s*= process\.env\.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_FORTNIGHTLY;/);
  assert.equal(/env: Record<string, string \| undefined> = process\.env/.test(CHECKOUT), false, 'a `= process.env` default parameter is back');
});

test('/api/version reports the two-weekly flag beside the other two, booleans only, from the same read', () => {
  const flags = configuredFlags(state(MONTHLY, ANNUAL, FORTNIGHTLY)) as Record<string, unknown>;
  assert.equal(flags.checkout, true);
  assert.equal(flags.checkoutAnnual, true);
  assert.equal(flags.checkoutFortnightly, true);
  const off = configuredFlags(state(MONTHLY, undefined, '#')) as Record<string, unknown>;
  assert.equal(off.checkoutAnnual, false);
  assert.equal(off.checkoutFortnightly, false, "'#' must read as unset in /api/version too, or the server and the page disagree (#243's shape)");
  for (const [k, v] of Object.entries(flags)) assert.equal(typeof v, 'boolean', `configured.${k} is not a boolean`);
});

test('/upgrade: the two-weekly button is ADDITIVE - only inside a monthly-anchored state, and the annual branching order is untouched', () => {
  /* Source-asserted, like the annual test, because the states are a render. */
  assert.match(UPGRADE, /const CHECKOUT_FORTNIGHTLY_CONFIGURED = isCheckoutConfiguredFortnightly\(\);/);
  assert.match(UPGRADE, /const fortnightlyButton = CHECKOUT_FORTNIGHTLY_CONFIGURED && \(/, 'the button must be gated on its own flag');
  assert.match(UPGRADE, /data-testid="checkout-cta-fortnightly"/);

  // The annual test's pinned order still holds: both -> monthly-only -> coming-soon.
  const both = UPGRADE.indexOf('CHECKOUT_CONFIGURED && CHECKOUT_ANNUAL_CONFIGURED ?');
  const monthlyOnly = UPGRADE.indexOf(') : CHECKOUT_CONFIGURED ?');
  assert.ok(both > 0 && monthlyOnly > both, 'the branching order the annual test pins has moved');

  // The button is placed inside the "both" and "monthly only" branches, and NOT after the monthly-only branch closes (the coming-soon block).
  const uses = [...UPGRADE.matchAll(/\{fortnightlyButton\}/g)].map(m => m.index!);
  assert.equal(uses.length, 2, `expected the button in exactly the two anchored states, found ${uses.length} placements`);
  assert.ok(uses[0] > both && uses[0] < monthlyOnly, 'first placement is not inside the "both" branch');
  const comingSoon = UPGRADE.indexOf('coming', monthlyOnly);
  assert.ok(uses[1] > monthlyOnly && (comingSoon === -1 || uses[1] < comingSoon), 'second placement is not inside the monthly-only branch');
  // No third, unanchored render path: the flag never decides a branch on its own.
  assert.equal(/CHECKOUT_FORTNIGHTLY_CONFIGURED \?/.test(UPGRADE), false, 'the two-weekly flag opens its own branch - a two-weekly link without a monthly one would render a lone button');
});

test('the page renders no "$25" any more, and every price literal became a label', () => {
  // Comments stripped: a historical note may still say "$25"; what a visitor sees may not.
  const code = UPGRADE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/\$25\b/.test(code), false, 'a $25 literal survives in /upgrade\'s rendered code');
  assert.equal(/\$\{'250'\}|\$250\b/.test(code), false, 'the $250 annual literal survives on /upgrade');
  for (const key of ['UPGRADE_PRICE_MONTHLY', 'UPGRADE_PRICE_ANNUAL', 'UPGRADE_PRICE_FORTNIGHTLY', 'UPGRADE_FORTNIGHTLY_CHECKOUT_BUTTON_CTA', 'UPGRADE_PRICE_SUFFIX_FORTNIGHTLY']) {
    assert.ok(UPGRADE.includes(`t('${key}')`), `${key} is not rendered through t()`);
  }
});

test('CONTROL: these predicates can return true', () => {
  assert.equal(isCheckoutConfiguredFortnightly(state(MONTHLY, ANNUAL, FORTNIGHTLY)), true);
  assert.equal(checkoutBaseFortnightly(state(MONTHLY, ANNUAL, FORTNIGHTLY)), FORTNIGHTLY);
  assert.equal(isCheckoutConfiguredAnnual(state(MONTHLY, ANNUAL, FORTNIGHTLY)), true);
});
