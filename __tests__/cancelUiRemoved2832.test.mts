/* QA: PR #2832 (#1630 owner item 61). The switched-off payment pieces a customer could reach are gone from Settings; what a Whop subscriber sees stays.
 * Replaces cancelPanelButtons (the sizing and wording pins of the removed confirm buttons).
 *   R1 Settings has no cancel button, no confirm row and no call to the Lemon Squeezy cancel route; the styles went with it
 *   R2 a Whop Pro still sees status, renewal date and "Manage on Whop"
 *   R3 every view the panel rules can answer still draws something truthful: a row the rules call "cancellable" falls to "Active" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { subscriptionPanelView } from '../lib/subscriptionPanel.ts';
import { appPath } from './_appPath.mts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const page = read(appPath('app/settings/page.tsx'));
const from = page.indexOf('{subView && subView.kind !== ');
const panel = page.slice(from, page.indexOf("t('SETTINGS_SECTION_WATCHLIST')", from));

test('R1. no in-product cancel is left', () => {
  for (const gone of ['/api/lemonsqueezy/cancel', 'SETTINGS_SUB_CANCEL_BUTTON', 'SETTINGS_SUB_CANCEL_CONFIRM', 'doCancel', 'cancelConfirm', "kind === 'cancellable'"]) assert.equal(page.includes(gone), false, gone);
  assert.equal(read(appPath('app/globals.css')).replace(/\/\*[\s\S]*?\*\//g, '').includes('.st-confirm-btn'), false);
});

test('R2. the Whop panel is as it was', () => {
  assert.ok(panel.length > 200, 'CONTROL: the panel was found');
  const whop = panel.slice(panel.indexOf("kind === 'providerManaged'"), panel.indexOf("kind === 'managed'"));
  for (const part of ["t('SETTINGS_SUB_ACTIVE')", "t('SETTINGS_SUB_RENEWS_ON'", 'href={WHOP_MANAGE_URL}', "t('SETTINGS_SUB_MANAGE_ON_WHOP')", "t('SETTINGS_SUB_CANCEL_KEEPS_ACCESS')"]) assert.ok(whop.includes(part), part);
});

test('R3. a cancellable row reads Active, with no button', () => {
  const view = subscriptionPanelView({ role: 'pro', lsStatus: 'active', currentPeriodEnd: '2099-01-01T00:00:00Z', hasSubscription: true, canCancel: true }, Date.parse('2026-11-25T00:00:00Z'));
  assert.equal(view.kind, 'cancellable', 'CONTROL: the rules still answer it');
  const rest = panel.slice(panel.lastIndexOf(') : ('));
  assert.ok(rest.includes("t('SETTINGS_SUB_ACTIVE')"));
  assert.equal(/<button|<a /.test(rest), false);
});
