/* QA: PR #2824 (#1263 owner item 65). On Arena a confirmed Free plan meets the upgrade prompt before the price-alert form.
 *   G1 only a CONFIRMED free plan: auth and plan both settled and 'not_entitled'; loading and 'unknown' open the form (the server decides)
 *   G2 the gate returns before anything of the form is set up, and the form button is the one way in */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/(main)/arena/page.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = page.slice(page.indexOf('function openAlertForm() {'), page.indexOf('setAlertDir(', page.indexOf('function openAlertForm() {')));

test('G1. the gate asks for a confirmed Free plan only', () => {
  assert.ok(body.includes("if (!authLoading && !entitlementsLoading && entitlementStatus === 'not_entitled') {"));
  assert.ok(body.includes("setUpgradeGate(t('ALERTS_PRICE_ALERTS_LABEL'));\n      return;"));
  assert.equal(/'unknown'/.test(body.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'an unreadable plan must still open the form');
});

test('G2. the gate comes first, and only the button opens the form', () => {
  assert.ok(body.indexOf('setUpgradeGate') < body.indexOf('const price = store.coins[selectedCoin]?.price;'));
  assert.equal(page.split('openAlertForm()').length - 1, 2, 'CONTROL: the declaration and the one button');
  assert.equal(page.split('setAlertFormOpen(true)').length - 1, 1, 'another way into the form skips the gate');
});
