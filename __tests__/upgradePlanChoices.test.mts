/* The /upgrade plan-choices layout (#861, Danivy's recommendation): the Free and Pro cards come first, "Upgrade to
 * Pro" on the Pro card reveals the three billing buttons, the payment-method panel is unchanged.
 *
 * WHY THESE PINS. The redesign moved the plan buttons behind a click. That is easy to break in three quiet ways, and
 * none of them is visible to a unit test that only counts badges (cryptoCheckout U5e does that part):
 *   - the reveal button shows in the "launching soon" state, which must have ZERO buttons (production today);
 *   - the billing buttons render before the reveal, so the "cards first" order is lost;
 *   - copy that does not exist yet comes back: "Cancel anytime" (owner, 2026-09-30: copy says only what exists), or the
 *     Free and Pro lists are typed into the page instead of read from lib/planFeatures.ts.
 *
 * Structure only, the same limit as every component file here: the branches are JSX inside one component, there is no
 * DOM test library, and the rendered proof is QA's A|B pairs on #1531 (signed out and Free, 390 to 1920, dark and light).
 * Mutations run when this was written (each turned the named test red): reveal rendered outside CHECKOUT_CONFIGURED -> UP1;
 * `plansOpen &&` removed from a branch -> UP2; the cancel-anytime label added to the page -> UP3; a hard-coded feature
 * string -> UP4; Monthly badge removed -> UP5. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appPath } from './_appPath.mts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const UPGRADE = code(read(appPath('app/upgrade/page.tsx')));
const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

test('UP1. "Upgrade to Pro" is rendered only where checkout is configured, so the launching-soon state still has no button', () => {
  const at = UPGRADE.indexOf('data-testid="upgrade-reveal-plans"');
  assert.ok(at > 0, 'CONTROL: the reveal button is gone');
  assert.equal(UPGRADE.split('data-testid="upgrade-reveal-plans"').length - 1, 1, 'more than one reveal button');
  const before = UPGRADE.slice(Math.max(0, at - 160), at);
  assert.match(before, /\{CHECKOUT_CONFIGURED && \(\s*<button\s+type="button"\s*$/, 'the reveal button is no longer gated on CHECKOUT_CONFIGURED');
  const soon = UPGRADE.indexOf("t('UPGRADE_COMING_SOON_TITLE')");
  assert.ok(soon > 0, 'CONTROL: the coming-soon block moved');
  const region = UPGRADE.slice(soon, soon + 1400);
  assert.doesNotMatch(region, /<button|upgrade-reveal-plans|checkout-cta/, 'the launching-soon state gained a button');
});

test('UP2. the billing buttons wait for the reveal in BOTH buyable states, and the reveal only shows them', () => {
  assert.equal((UPGRADE.match(/plansOpen && </g) ?? []).length, 2, 'expected the billing choices gated on plansOpen in both buyable branches (all three plans, and monthly-only)');
  assert.match(UPGRADE, /const \[plansOpen, setPlansOpen\] = useState\(false\);/, 'the billing choices no longer start closed');
  assert.match(UPGRADE, /onClick=\{\(\) => setPlansOpen\(true\)\}/, 'the reveal button no longer just opens the choices');
  assert.match(UPGRADE, /aria-expanded=\{plansOpen\}/, 'the reveal button lost aria-expanded');
  assert.match(UPGRADE, /aria-controls="billing-choices"/, 'the reveal button no longer names what it controls');
  assert.equal((UPGRADE.match(/id="billing-choices"/g) ?? []).length, 2, 'each buyable branch needs the billing-choices container');
  const onClick = UPGRADE.slice(UPGRADE.indexOf('onClick={() => setPlansOpen(true)}'), UPGRADE.indexOf('onClick={() => setPlansOpen(true)}') + 120);
  assert.doesNotMatch(onClick, /router\.push|window\.location|startCheckout|redirect/i, 'the reveal now navigates or charges - it must only show the choices');
});

test('UP3. no "Cancel anytime": the page neither uses its label nor types the words', () => {
  assert.equal(UPGRADE.includes('UPGRADE_TRUST_CANCEL_ANYTIME'), false, 'the page renders the "Cancel anytime" label again');
  assert.equal(/cancel anytime/i.test(UPGRADE), false, 'the words "Cancel anytime" are in the page');
  assert.equal(typeof defaults.UPGRADE_TRUST_CANCEL_ANYTIME, 'string', 'CONTROL: the label key moved - re-derive, because this test is about its USE on /upgrade');
});

test('UP4. the Free and Pro lists come from lib/planFeatures.ts, not from strings typed into the page', () => {
  assert.match(UPGRADE, /FREE_PLAN_FEATURES\.map\(/);
  assert.match(UPGRADE, /PRO_PLAN_FEATURES\.map\(/);
  for (const invented of ['Advanced signals', 'Basic charts', 'AI market analysis', 'Why LiquidityHQ Pro', 'Trade with the full picture', 'Continue to Checkout']) {
    assert.equal(UPGRADE.includes(invented), false, `invented copy is in the page: "${invented}"`);
  }
});

test('UP5. Monthly has its price badge and the recommended tag, from existing labels', () => {
  const at = UPGRADE.indexOf('data-testid="checkout-cta-monthly"');
  assert.ok(at > 0, 'CONTROL: the monthly button is gone');
  const near = UPGRADE.slice(at, at + 1700);
  assert.match(near, /<span style=\{PRICE_BADGE\}>\{t\('UPGRADE_PRICE_MONTHLY'\)\}\{t\('UPGRADE_PRICE_SUFFIX_MONTHLY'\)\}<\/span>/, 'the Monthly button lost its price badge');
  assert.match(near, /<span style=\{PLAN_RECOMMENDED_TAG\}>\{t\('UPGRADE_PRO_CARD_BADGE'\)\}<\/span>/, 'the Monthly button lost its "Recommended" tag');
  for (const key of ['UPGRADE_PRICE_MONTHLY', 'UPGRADE_PRICE_SUFFIX_MONTHLY', 'UPGRADE_PRO_CARD_BADGE', 'UPGRADE_GATE_CTA']) {
    assert.ok(typeof defaults[key] === 'string' && defaults[key].trim().length > 0, `${key} has no English default`);
  }
});

test('UP6. pressing "Upgrade to Pro" moves focus to the first billing button, so a keyboard user lands on the choices', () => {
  assert.match(UPGRADE, /if \(plansOpen\) billingChoicesRef\.current\?\.querySelector<HTMLButtonElement>\('button'\)\?\.focus\(\);/, 'the reveal no longer moves focus into the billing choices');
  assert.match(UPGRADE, /\}, \[plansOpen\]\);/, 'the focus effect is no longer keyed on plansOpen');
});
