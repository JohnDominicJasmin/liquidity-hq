/* #861 Phase 1: pay with crypto through BoomFi links (4ee68395, f9f7b543).
 *
 * Lemon Squeezy rejected the store, so /upgrade stopped reading its three links
 * and reads three BoomFi links instead, one per plan. A plan button no longer
 * navigates: it picks the plan, and a method panel then offers "Pay with Crypto".
 *
 * WHAT A WRONG ANSWER COSTS HERE. These are live payment links. A plan that
 * resolves to another plan's link charges the wrong amount and looks like it
 * worked; a link that renders when its variable is unset is a button to nowhere
 * on the page a visitor reached in order to pay. Both are pinned below for every
 * plan, in both directions.
 *
 * TWO HALVES, AND WHICH IS WHICH:
 *   - lib/checkout.ts and lib/configured.ts are real modules: imported and
 *     called. `getCryptoCheckoutUrl` reads values captured at module scope
 *     (#243), so those tests set the environment and THEN import a fresh copy.
 *   - app/upgrade/page.tsx is a React component and this repo has no DOM test
 *     library, so the page is asserted from its source (comments stripped).
 *     That proves how it is written, not that it renders; the manual steps on
 *     the PR cover the render. The Back-button reset (U8) in particular has not
 *     been reproduced in a browser by Dev or by QA.
 *
 * NOT COVERED, ON PURPOSE: whether a payment unlocks Pro. The link carries the
 * account id as BoomFi's `customer_ident` (C6), but nothing reads it yet - the
 * webhook's entitlement half is not written. PM's rule on #861: the crypto
 * buttons stay on staging until a payment is seen to find the right account. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cryptoCheckoutBase, cryptoCheckoutBaseAnnual, cryptoCheckoutBaseFortnightly,
  isCryptoCheckoutConfigured, isCryptoCheckoutConfiguredAnnual, isCryptoCheckoutConfiguredFortnightly,
  getCryptoCheckoutUrl,
  checkoutBase, checkoutBaseAnnual, checkoutBaseFortnightly,
} from '../lib/checkout.ts';
import { configuredFlags } from '../lib/configured.ts';
import { LABEL_KEYS } from '../lib/labelKeys.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CHECKOUT = stripComments(read('lib/checkout.ts'));
const UPGRADE = stripComments(read('app/upgrade/page.tsx'));
const labelDefaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

// Fixtures, not the live links: nothing here may point a test at a real payment page.
const MONTHLY = 'https://pay.example.test/monthly-link';
const ANNUAL = 'https://pay.example.test/annual-link';
const FORTNIGHTLY = 'https://pay.example.test/weekly-link';
const LS = 'https://store.example.test/checkout/buy/ls-uuid';
const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'payer@example.test' };

const K = {
  monthly: 'NEXT_PUBLIC_BOOMFI_CHECKOUT_URL',
  annual: 'NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_ANNUAL',
  fortnightly: 'NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_FORTNIGHTLY',
} as const;
type Plan = keyof typeof K;
const PLANS: Plan[] = ['monthly', 'annual', 'fortnightly'];
const URLS: Record<Plan, string> = { monthly: MONTHLY, annual: ANNUAL, fortnightly: FORTNIGHTLY };

const base: Record<Plan, (env?: Record<string, string | undefined>) => string | null> = {
  monthly: cryptoCheckoutBase, annual: cryptoCheckoutBaseAnnual, fortnightly: cryptoCheckoutBaseFortnightly,
};
const configured: Record<Plan, (env?: Record<string, string | undefined>) => boolean> = {
  monthly: isCryptoCheckoutConfigured, annual: isCryptoCheckoutConfiguredAnnual, fortnightly: isCryptoCheckoutConfiguredFortnightly,
};

const env = (v: Partial<Record<Plan, string | undefined>>, extra: Record<string, string | undefined> = {}) => ({
  [K.monthly]: v.monthly, [K.annual]: v.annual, [K.fortnightly]: v.fortnightly, ...extra,
});

/* ══ The readers: real calls ══ */

test('C1. all three set: each plan reads its OWN link', () => {
  const e = env(URLS);
  for (const p of PLANS) {
    assert.equal(base[p](e), URLS[p], `${p} did not read its own link`);
    assert.equal(configured[p](e), true);
  }
});

test("C2. '#', empty and undefined all mean unset, for every plan", () => {
  for (const p of PLANS) {
    for (const v of ['#', '', undefined]) {
      const e = env({ ...URLS, [p]: v });
      assert.equal(base[p](e), null, `${p}: value ${JSON.stringify(v)} must read as unset`);
      assert.equal(configured[p](e), false, `${p}: value ${JSON.stringify(v)} reports configured - /upgrade would render a button that goes nowhere`);
    }
  }
});

test('C3. an unset plan is never filled from another plan - the wrong-amount bug, all six directions', () => {
  for (const p of PLANS) {
    const e = env({ ...URLS, [p]: undefined });
    assert.equal(base[p](e), null, `${p} is unset but resolved to ${base[p](e)} - that is another plan's link`);
    for (const other of PLANS.filter((o) => o !== p)) {
      assert.equal(base[other](e), URLS[other], `unsetting ${p} changed ${other}`);
    }
  }
});

test('C4. the two processors do not leak into each other: a Lemon Squeezy link never makes a crypto plan buyable, and the reverse', () => {
  const onlyLs = env({}, {
    NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL: LS,
    NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_ANNUAL: LS,
    NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_FORTNIGHTLY: LS,
  });
  for (const p of PLANS) assert.equal(base[p](onlyLs), null, `${p}: a Lemon Squeezy link satisfied the crypto reader - the dead store's link would be offered as a payment page`);
  const onlyCrypto = env(URLS);
  assert.equal(checkoutBase(onlyCrypto), null);
  assert.equal(checkoutBaseAnnual(onlyCrypto), null);
  assert.equal(checkoutBaseFortnightly(onlyCrypto), null);
});

/* ══ getCryptoCheckoutUrl: reads module-scope values, so set the environment FIRST and import fresh ══ */

type GetUrl = (plan: Plan, user: { id: string; email?: string } | null) => string | null;
let importSeq = 0;
async function withCryptoEnv<T>(values: Partial<Record<Plan, string | undefined>>, fn: (get: GetUrl) => T | Promise<T>): Promise<T> {
  const saved = PLANS.map((p) => [K[p], process.env[K[p]]] as const);
  for (const p of PLANS) {
    if (values[p] === undefined) delete process.env[K[p]];
    else process.env[K[p]] = values[p];
  }
  try {
    const mod = await import(`../lib/checkout.ts?crypto=${Date.now()}-${importSeq++}`);
    return await fn(mod.getCryptoCheckoutUrl as GetUrl);
  } finally {
    for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
/** Origin + path: the part that decides WHICH product is charged. */
const product = (u: string) => { const x = new URL(u); return x.origin + x.pathname; };

test('C5. getCryptoCheckoutUrl(plan) goes to that plan\'s link and no other - signed in and signed out', async () => {
  await withCryptoEnv(URLS, (get) => {
    for (const p of PLANS) {
      assert.equal(get(p, null), URLS[p], `getCryptoCheckoutUrl('${p}', null) is not that plan's bare link`);
      const signedIn = get(p, USER);
      assert.ok(signedIn, `${p}: no link for a signed-in user`);
      assert.equal(product(signedIn), URLS[p], `getCryptoCheckoutUrl('${p}', user) points at another plan's product`);
    }
  });
});

test('C6. exactly ONE parameter is added for a signed-in user - customer_ident = their account id - and nothing else about them', async () => {
  /* BoomFi's own parameter for binding a payment to an id we already store. It
     is what lets the webhook find the account without guessing from an email.
     Email and name are deliberately not sent. */
  const withQuery = 'https://pay.example.test/monthly-link?ref=abc';
  await withCryptoEnv({ monthly: withQuery, annual: ANNUAL, fortnightly: FORTNIGHTLY }, (get) => {
    const url = new URL(get('annual', USER)!);
    assert.equal(url.searchParams.get('customer_ident'), USER.id);
    assert.deepEqual([...url.searchParams.keys()], ['customer_ident'], `unexpected parameters on the link: ${[...url.searchParams.keys()].join(', ')}`);
    assert.equal(url.toString().includes('payer'), false, 'the account email reached the payment link');

    const kept = new URL(get('monthly', USER)!);
    assert.equal(kept.searchParams.get('ref'), 'abc', 'a parameter already on the configured link was dropped');
    assert.deepEqual([...kept.searchParams.keys()].sort(), ['customer_ident', 'ref']);

    assert.equal(get('monthly', null), withQuery, 'signed out, the link must be returned exactly as configured');
  });
});

test('C6b. the account id on the link is client-editable, which is WHY the webhook must not treat it as proof of who paid', async () => {
  /* Not a defect and not to be "fixed" here: a payment link has to say who to
     credit, and it is a URL, so the payer can change it. Pinned so nobody later
     reads the webhook's checks as belt-and-braces. If the id ever moves somewhere
     signed or server-side, that is an improvement - say so on #861. */
  await withCryptoEnv(URLS, (get) => {
    const mine = new URL(get('monthly', USER)!);
    assert.equal(mine.searchParams.get('customer_ident'), USER.id, 'the link does not carry the account id to begin with');
    // Anyone can do this in the address bar before paying.
    mine.searchParams.set('customer_ident', '99999999-9999-4999-8999-999999999999');
    assert.equal(mine.searchParams.get('customer_ident'), '99999999-9999-4999-8999-999999999999',
      'customer_ident is a plain query parameter with no signature');
  });
});

test("C7. an unset plan returns null - not '/login?signup=1', not a sibling's link - signed in or not", async () => {
  for (const p of PLANS) {
    await withCryptoEnv({ ...URLS, [p]: undefined }, (get) => {
      assert.equal(get(p, USER), null, `${p} unset must be null so the page renders no button`);
      assert.equal(get(p, null), null);
      for (const other of PLANS.filter((o) => o !== p)) assert.equal(get(other, null), URLS[other]);
    });
    await withCryptoEnv({ ...URLS, [p]: '#' }, (get) => assert.equal(get(p, USER), null, `'#' must be unset for ${p}`));
  }
  await withCryptoEnv({}, (get) => { for (const p of PLANS) assert.equal(get(p, USER), null); });
});

test('C7b. a link that is not a URL is returned as given and does not throw - this runs during render on the page a visitor reached in order to pay', async () => {
  await withCryptoEnv({ monthly: 'not a url' }, (get) => {
    assert.doesNotThrow(() => get('monthly', USER));
    assert.equal(get('monthly', USER), 'not a url');
  });
});

test('C8. CONTROL: the fresh-import helper really does pick up the environment (a stale cached module would make C5-C7 pass on nothing)', async () => {
  await withCryptoEnv({ monthly: 'https://pay.example.test/first' }, (get) => assert.equal(get('monthly', null), 'https://pay.example.test/first'));
  await withCryptoEnv({ monthly: 'https://pay.example.test/second' }, (get) => assert.equal(get('monthly', null), 'https://pay.example.test/second'));
  assert.equal(getCryptoCheckoutUrl.length, 2, 'getCryptoCheckoutUrl\'s arity changed - re-read what it appends before trusting C6');
});

/* ══ Source rules that a call cannot see ══ */

test('C9. the inlining rule holds for all three crypto variables (#243): literal process.env reads at module scope, no `= process.env` default', () => {
  assert.match(CHECKOUT, /const INLINED_CRYPTO_MONTHLY\s*= process\.env\.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL;/);
  assert.match(CHECKOUT, /const INLINED_CRYPTO_ANNUAL\s*= process\.env\.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_ANNUAL;/);
  assert.match(CHECKOUT, /const INLINED_CRYPTO_FORTNIGHTLY\s*= process\.env\.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_FORTNIGHTLY;/);
  assert.equal(/env: Record<string, string \| undefined> = process\.env/.test(CHECKOUT), false, 'a `= process.env` default parameter is back - it is empty in the browser');
});

test('C10. each crypto reader uses only its own inlined constant - the no-argument path (the one the browser takes) cannot fall back either', () => {
  const body = (name: string) => {
    const at = CHECKOUT.indexOf(`export function ${name}(`);
    assert.ok(at >= 0, `${name} not found - re-derive this test`);
    return CHECKOUT.slice(at, CHECKOUT.indexOf('\n}', at));
  };
  const own: Record<string, string> = {
    cryptoCheckoutBase: 'INLINED_CRYPTO_MONTHLY', cryptoCheckoutBaseAnnual: 'INLINED_CRYPTO_ANNUAL', cryptoCheckoutBaseFortnightly: 'INLINED_CRYPTO_FORTNIGHTLY',
  };
  for (const [fn, constant] of Object.entries(own)) {
    const used = [...body(fn).matchAll(/INLINED_\w+/g)].map((m) => m[0]);
    assert.deepEqual([...new Set(used)], [constant], `${fn} reads ${used.join(', ')} - it must read only ${constant}`);
  }
});

test('C11. /api/version reports the three crypto flags from the same read the page gates on, booleans only, beside the three Lemon Squeezy flags', () => {
  const on = configuredFlags(env(URLS)) as Record<string, unknown>;
  assert.equal(on.cryptoCheckout, true);
  assert.equal(on.cryptoCheckoutAnnual, true);
  assert.equal(on.cryptoCheckoutFortnightly, true);
  assert.equal(on.checkout, false, 'crypto links made the Lemon Squeezy flag read true');
  const mixed = configuredFlags(env({ monthly: MONTHLY, annual: '#', fortnightly: undefined })) as Record<string, unknown>;
  assert.equal(mixed.cryptoCheckout, true);
  assert.equal(mixed.cryptoCheckoutAnnual, false, "'#' must read as unset in /api/version too, or the server and the page disagree");
  assert.equal(mixed.cryptoCheckoutFortnightly, false);
  for (const k of ['checkout', 'checkoutAnnual', 'checkoutFortnightly', 'cryptoCheckout', 'cryptoCheckoutAnnual', 'cryptoCheckoutFortnightly']) {
    assert.equal(typeof on[k], 'boolean', `configured.${k} is missing or not a boolean`);
  }
  assert.equal(JSON.stringify(on).includes('pay.example.test'), false, 'a link value reached /api/version - flags only');
});

/* ══ /upgrade: source-asserted ══ */

test('U1. /upgrade gates every plan on its crypto link, and imports nothing that could send a buyer to the rejected store', () => {
  /* The monthly gate goes through isProBuyable() since 58f64e3d - the one answer
     the trial-ending email and /api/version also give. Today it IS the BoomFi
     monthly link (proBuyable.test.mts pins that), so the page still shows plan
     buttons exactly when that link is set. */
  assert.match(UPGRADE, /const CHECKOUT_CONFIGURED = isProBuyable\(\);/);
  assert.match(UPGRADE, /const CHECKOUT_ANNUAL_CONFIGURED = isCryptoCheckoutConfiguredAnnual\(\);/);
  assert.match(UPGRADE, /const CHECKOUT_FORTNIGHTLY_CONFIGURED = isCryptoCheckoutConfiguredFortnightly\(\);/);
  assert.equal(/\bgetCheckoutUrl(Annual|Fortnightly)?\b|\bisCheckoutConfigured(Annual|Fortnightly)?\b/.test(UPGRADE), false, '/upgrade still references a Lemon Squeezy checkout function');
});

test('U2. step 1 - a plan button only CHOOSES: signed out it goes to sign-up and stops, signed in it sets the plan, and it never navigates to a payment page', () => {
  const at = UPGRADE.indexOf('function choosePlan(');
  assert.ok(at >= 0, 'choosePlan not found - re-derive this test');
  const body = UPGRADE.slice(at, UPGRADE.indexOf('\n  }', at));
  assert.match(body, /if \(!user\) \{ router\.push\('\/login\?signup=1&next=\/upgrade'\); return; \}/, 'the signed-out guard changed or no longer returns before choosing');
  assert.ok(body.indexOf('return;') < body.indexOf('setSelectedPlan(plan)'), 'the plan is set before the signed-out return - a signed-out visitor would reach the payment step with no account to credit');
  assert.equal(/window\.location|getCryptoCheckoutUrl/.test(body), false, 'choosePlan navigates or reads a link - step 1 must not leave the page');
});

test('U3. each plan button chooses ITS plan', () => {
  assert.match(UPGRADE, /const handleCheckout = \(\) => choosePlan\('monthly'\);/);
  assert.match(UPGRADE, /const handleCheckoutAnnual = \(\) => choosePlan\('annual'\);/);
  assert.match(UPGRADE, /const handleCheckoutFortnightly = \(\) => choosePlan\('fortnightly'\);/);
  const handlerFor = (testid: string) => {
    const hits = [...UPGRADE.matchAll(new RegExp(`data-testid="${testid}"\\s+onClick=\\{(\\w+)\\}`, 'g'))].map((m) => m[1]);
    assert.ok(hits.length > 0, `${testid} has no onClick directly after its test id - re-derive this test`);
    return [...new Set(hits)];
  };
  assert.deepEqual(handlerFor('checkout-cta-monthly'), ['handleCheckout']);
  assert.deepEqual(handlerFor('checkout-cta-annual'), ['handleCheckoutAnnual']);
  assert.deepEqual(handlerFor('checkout-cta-fortnightly'), ['handleCheckoutFortnightly']);
});

test('U4. step 2 - the only navigation to a payment page is payWithCrypto, to the picked plan\'s link, carrying the signed-in user', () => {
  assert.match(UPGRADE, /const cryptoUrl = selectedPlan \? getCryptoCheckoutUrl\(selectedPlan, user\) : null;/, 'the link is no longer read for the selected plan with the signed-in user');
  const navigations = [...UPGRADE.matchAll(/window\.location(?:\.href)?\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(navigations, ['cryptoUrl'], `expected exactly one navigation, to cryptoUrl; found: ${navigations.join(' | ') || '(none)'}`);
  const at = UPGRADE.indexOf('function payWithCrypto(');
  const body = UPGRADE.slice(at, UPGRADE.indexOf('\n  }', at));
  assert.match(body, /if \(!selectedPlan \|\| !cryptoUrl\) return;/, 'payWithCrypto no longer refuses when there is no plan or no link');
  assert.ok(body.indexOf('return;') < body.indexOf('window.location.href = cryptoUrl'), 'the guard comes after the navigation');
});

test('U5. the method panel: shows for the picked plan, offers crypto only when that plan has a link, and offers no card button (Polar is not live)', () => {
  const at = UPGRADE.indexOf('const methodPanel = selectedPlan && (');
  assert.ok(at >= 0, 'the panel is no longer gated on a selected plan');
  const panel = UPGRADE.slice(at, UPGRADE.indexOf('\n  );', at));
  assert.match(panel, /data-testid="checkout-method-panel"\s+data-plan=\{selectedPlan\}/);
  assert.match(panel, /\{cryptoUrl && \(\s*<button\s+data-testid="checkout-method-crypto"\s+onClick=\{payWithCrypto\}/, 'the crypto button is not gated on the link, or no longer calls payWithCrypto');
  assert.equal((panel.match(/<button/g) ?? []).length, 1, 'the panel has more than one button - a payment method was added; it needs its own link, its own gate and its own tests');
  assert.equal(/checkout-method-card/.test(UPGRADE), false, 'a card option is on the page before Polar is live');
});

test('U6. the weekly-billing note is shown for the two-weekly plan only - it is the one plan whose crypto price differs from the button', () => {
  const at = UPGRADE.indexOf('data-testid="checkout-method-crypto-weekly-note"');
  assert.ok(at >= 0, 'the weekly note is gone');
  const before = UPGRADE.slice(Math.max(0, at - 120), at);
  assert.match(before, /\{selectedPlan === 'fortnightly' && \(\s*<p\s*$/, 'the weekly note is no longer gated on the two-weekly plan');
  assert.equal((UPGRADE.match(/checkout-method-crypto-weekly-note/g) ?? []).length, 1);
  assert.match(UPGRADE, /t\('UPGRADE_METHOD_CRYPTO_WEEKLY_NOTE'\)/);
});

test('U7. the panel is placed in the two buyable states and not in the coming-soon state', () => {
  const both = UPGRADE.indexOf('CHECKOUT_CONFIGURED && CHECKOUT_ANNUAL_CONFIGURED ?');
  const monthlyOnly = UPGRADE.indexOf(') : CHECKOUT_CONFIGURED ?');
  const comingSoon = UPGRADE.indexOf(') : (', monthlyOnly + 1);
  assert.ok(both > 0 && monthlyOnly > both && comingSoon > monthlyOnly, 'the three-state branching has moved - re-derive this test');
  const uses = [...UPGRADE.matchAll(/\{methodPanel\}/g)].map((m) => m.index!);
  assert.equal(uses.length, 2, `expected the panel in exactly the two buyable states, found ${uses.length}`);
  assert.ok(uses[0] > both && uses[0] < monthlyOnly, 'first placement is not in the all-plans state');
  assert.ok(uses[1] > monthlyOnly && uses[1] < comingSoon, 'second placement is not in the monthly-only state');
});

test('U8. coming BACK from the payment page: a page restored from the back/forward cache clears "redirecting", and only then', () => {
  /* Without this the restored page keeps every button disabled and reading
     "Redirecting..." until a reload. Source only - not reproduced in a browser. */
  assert.match(UPGRADE, /const onPageShow = \(e: PageTransitionEvent\) => \{ if \(e\.persisted\) setRedirecting\(null\); \};/, 'the pageshow handler changed, or no longer checks persisted');
  assert.match(UPGRADE, /window\.addEventListener\('pageshow', onPageShow\);/);
  assert.match(UPGRADE, /return \(\) => window\.removeEventListener\('pageshow', onPageShow\);/, 'the listener is never removed');
});

test('U9. "Instant access" is not shown under the plan buttons - a crypto payment does not unlock the account by itself yet', () => {
  /* Owner's decision 2026-09-30 (0abd586c): the line would be untrue for the
     only way there is to pay. It comes back when a payment method that unlocks
     automatically exists - and this test is changed on purpose that day. */
  assert.match(UPGRADE, /const TRUST_LABELS = \['UPGRADE_TRUST_CANCEL_ANYTIME', 'UPGRADE_TRUST_SECURE_CHECKOUT'\] as const;/, 'the trust row\'s label list changed');
  assert.equal(/UPGRADE_TRUST_INSTANT_ACCESS/.test(UPGRADE), false, '"Instant access" is referenced in /upgrade\'s code again');
  assert.equal((UPGRADE.match(/TRUST_LABELS\.map\(/g) ?? []).length, 2, 'the two buyable states no longer both render the shared trust row');
  assert.equal(/UPGRADE_TRUST_[A-Z_]+'\s*[,\]]/.test(UPGRADE.replace(/const TRUST_LABELS = [^;]+;/, '')), false, 'a trust label is rendered from somewhere other than TRUST_LABELS');
  assert.ok((LABEL_KEYS as readonly string[]).includes('UPGRADE_TRUST_INSTANT_ACCESS'), 'the label key was deleted - production is additive-only; it should stay registered');
});

test('L1. the four new labels are registered, have English defaults, and are rendered through t()', () => {
  /* Wording is NOT pinned: the two-weekly note's text is with the owner (#861). */
  for (const key of ['UPGRADE_METHOD_PANEL_TITLE', 'UPGRADE_METHOD_CRYPTO_CTA', 'UPGRADE_METHOD_CRYPTO_NOTE', 'UPGRADE_METHOD_CRYPTO_WEEKLY_NOTE']) {
    assert.ok((LABEL_KEYS as readonly string[]).includes(key), `${key} is not in LABEL_KEYS`);
    assert.ok(typeof labelDefaults[key] === 'string' && labelDefaults[key].trim().length > 0, `${key} has no English default`);
    assert.ok(UPGRADE.includes(`t('${key}')`), `${key} is not rendered on /upgrade`);
  }
});
