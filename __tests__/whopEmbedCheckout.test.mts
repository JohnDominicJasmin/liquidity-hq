/* #1606 (#1610): the Whop checkout embedded on /upgrade, with the account email filled and locked.
 *
 * WHAT THIS PINS (pure code, no browser, no network):
 *   - getWhopCheckoutUrl: the hosted fallback link carries the account email as `email` and `email.disabled=1`, keeps what was already on the link, and is the link
 *     EXACTLY as configured when there is no usable address (signed out) or no link;
 *   - getWhopEmbed: the plan id and the sandbox/production choice are read from the configured link and nothing else;
 *   - the Content-Security-Policy header the app really sends: Whop's two hosts are added to script, frame and connect, and nothing wider (no wallet, bank or card host);
 *   - source pins on the two files: nothing is unlocked from the browser (no `onComplete`), the element is told to lock the email, the return reads only the three documented
 *     `status` values, and no `history.replaceState` (it resets the page and loses the banner, measured by Dev);
 *   - both Whop packages are pinned to an exact version.
 *
 * WHAT IT CANNOT PROVE (the verdict says so): that the element renders, that Whop's frame really disables the email input, that the return flow works, that wallets
 * (Apple Pay, Google Pay) work, or that a buyer already signed in to Whop under another address is held to the locked one. Those need qa with the links and a look inside
 * Whop's frame (a live checkout on qa, so looked at and never submitted). */
import test from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appPath } from './_appPath.mts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* next.config.ts wraps its config in withSentryConfig; under plain Node the package's entry is built for Next's bundler, so a stand-in returns the config unchanged. */
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent('export const withSentryConfig = (c) => c; export const captureException = () => {}; export default {};'), shortCircuit: true };
     return next(specifier, context);
   }`));

const LINKS = {
  NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: 'https://whop.com/checkout/plan_QaMonthly1',
  NEXT_PUBLIC_WHOP_CHECKOUT_ANNUAL: 'https://whop.com/checkout/plan_QaAnnual1/',
  NEXT_PUBLIC_WHOP_CHECKOUT_FORTNIGHTLY: 'https://whop.com/checkout/plan_QaFort1?d=keepme',
};
let n = 0;
/* lib/checkout.ts and next.config.ts read their settings once, when they load, so each environment gets its own import. */
async function loadCheckout(links: Record<string, string | undefined> = LINKS) {
  for (const k of Object.keys(LINKS)) { const v = (links as Record<string, string | undefined>)[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return await import(`../lib/checkout.ts?x=${Date.now()}-${n++}`) as typeof import('../lib/checkout.ts');
}
async function loadCsp(links: Record<string, string | undefined> = LINKS): Promise<string> {
  for (const k of Object.keys(LINKS)) { const v = (links as Record<string, string | undefined>)[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const cfg = (await import(`../next.config.ts?x=${Date.now()}-${n++}`)).default as { headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> };
  const all = await cfg.headers();
  const csp = all.flatMap((h) => h.headers).find((h) => h.key.toLowerCase() === 'content-security-policy');
  assert.ok(csp, 'no Content-Security-Policy header is sent');
  return csp.value;
}
const directive = (csp: string, name: string) => (csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' ')) ?? '');

test('E1. getWhopCheckoutUrl: the account email is appended as email and email.disabled=1, encoded, keeping what the link already carried', async () => {
  const c = await loadCheckout();
  const u = new URL(c.getWhopCheckoutUrl('monthly', 'buyer+tag@example.test')!);
  assert.equal(u.origin + u.pathname, 'https://whop.com/checkout/plan_QaMonthly1');
  assert.equal(u.searchParams.get('email'), 'buyer+tag@example.test'); assert.equal(u.searchParams.get('email.disabled'), '1');
  assert.ok(!/buyer\+tag@example/.test(u.search), 'the address must be percent-encoded in the query');
  const f = new URL(c.getWhopCheckoutUrl('fortnightly', 'b@example.test')!);
  assert.equal(f.searchParams.get('d'), 'keepme', 'a parameter already on the link was dropped'); assert.equal(f.searchParams.get('email'), 'b@example.test');
  // the other two plans each use their OWN link, never another plan's
  assert.ok(c.getWhopCheckoutUrl('annual', 'b@example.test')!.startsWith('https://whop.com/checkout/plan_QaAnnual1/'));
});

test('E2. getWhopCheckoutUrl: no usable address (signed out, empty, spaces, not an address, null) returns the link exactly as configured; an unset plan is null', async () => {
  const c = await loadCheckout();
  for (const e of [undefined, null, '', '   ', 'not-an-address', 'a@b', 'two words@example.test', '@example.test']) assert.equal(c.getWhopCheckoutUrl('monthly', e), 'https://whop.com/checkout/plan_QaMonthly1', JSON.stringify(e));
  assert.equal(c.getWhopCheckoutUrl('monthly'), 'https://whop.com/checkout/plan_QaMonthly1');
  const none = await loadCheckout({ NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: undefined, NEXT_PUBLIC_WHOP_CHECKOUT_ANNUAL: undefined, NEXT_PUBLIC_WHOP_CHECKOUT_FORTNIGHTLY: undefined });
  assert.equal(none.getWhopCheckoutUrl('monthly', 'b@example.test'), null);
  const insecure = await loadCheckout({ ...LINKS, NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: 'http://whop.com/checkout/plan_X' });
  assert.equal(insecure.getWhopCheckoutUrl('monthly', 'b@example.test'), null, 'only an https link counts as set');
});

test('E3. getWhopEmbed: the plan id and the sandbox choice come from the configured link; no plan id or no link gives null (the page then shows the hosted link)', async () => {
  const c = await loadCheckout();
  assert.deepEqual(c.getWhopEmbed('monthly'), { planId: 'plan_QaMonthly1', environment: 'production' });
  assert.deepEqual(c.getWhopEmbed('annual'), { planId: 'plan_QaAnnual1', environment: 'production' }, 'a trailing slash must not hide the id');
  assert.deepEqual(c.getWhopEmbed('fortnightly'), { planId: 'plan_QaFort1', environment: 'production' }, 'a query string must not hide the id');
  const sb = await loadCheckout({ ...LINKS, NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: 'https://sandbox.whop.com/checkout/plan_SbMonthly1' });
  assert.deepEqual(sb.getWhopEmbed('monthly'), { planId: 'plan_SbMonthly1', environment: 'sandbox' });
  assert.equal(sb.getWhopEmbed('annual')!.environment, 'production', 'one sandbox link must not turn the others sandbox');
  const odd = await loadCheckout({ ...LINKS, NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: 'https://whop.com/checkout/', NEXT_PUBLIC_WHOP_CHECKOUT_ANNUAL: 'https://whop.com/somewhere/else' });
  assert.equal(odd.getWhopEmbed('monthly'), null); assert.equal(odd.getWhopEmbed('annual'), null);
  const none = await loadCheckout({ NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: undefined, NEXT_PUBLIC_WHOP_CHECKOUT_ANNUAL: undefined, NEXT_PUBLIC_WHOP_CHECKOUT_FORTNIGHTLY: undefined });
  assert.equal(none.getWhopEmbed('monthly'), null);
});

test('C1. the CSP the app sends adds Whop\'s hosts and nothing wider: cdn.whop.com to script and frame, api.whop.com to connect; the sandbox API only when a link is on the sandbox', async () => {
  const csp = await loadCsp();
  assert.ok(directive(csp, 'script-src').split(/\s+/).includes('https://cdn.whop.com'), 'script-src lacks cdn.whop.com');
  assert.ok(directive(csp, 'frame-src').split(/\s+/).includes('https://cdn.whop.com'), 'frame-src lacks cdn.whop.com');
  assert.ok(directive(csp, 'connect-src').split(/\s+/).includes('https://api.whop.com'), 'connect-src lacks api.whop.com');
  assert.ok(!/sandbox-api\.whop\.com/.test(csp), 'the sandbox API must not be allowed on a production build');
  assert.ok(!/cdn\.whop\.com/.test(directive(csp, 'connect-src')) && !/api\.whop\.com/.test(directive(csp, 'script-src')), 'a Whop host was added to the wrong directive');
  const sb = await loadCsp({ ...LINKS, NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: 'https://sandbox.whop.com/checkout/plan_SbMonthly1' });
  assert.ok(directive(sb, 'connect-src').split(/\s+/).includes('https://sandbox-api.whop.com')); assert.ok(!directive(sb, 'connect-src').split(/\s+/).includes('https://api.whop.com'));
});

test('C2. the CSP allows no wallet, bank or card host (those are Whop\'s own frame\'s business), and the only whop.com hosts in it are cdn.whop.com and api.whop.com', async () => {
  const csp = await loadCsp();
  for (const host of ['applepay.cdn-apple.com', 'pay.google.com', 'paypal.com', 'js.stripe.com', 'plaid.com', 'basistheory', 'hcaptcha.com', 'sardine']) assert.ok(!csp.includes(host), `the CSP names ${host}`);
  const whopHosts = [...new Set([...csp.matchAll(/https:\/\/([a-z0-9.-]*whop\.com)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(whopHosts, ['api.whop.com', 'cdn.whop.com']);
  assert.ok(!/\*\.whop\.com/.test(csp) && !/ https:( |;|$)/.test(' ' + directive(csp, 'script-src') + ' ') , 'a wildcard or a bare https: in script-src');
});

test('S1. source: nothing is unlocked from the browser (no onComplete), the element locks the email, and the email passed is the account email', () => {
  const embed = stripTsComments(read('components/WhopCheckoutEmbed.tsx')); const page = stripTsComments(read(appPath('app/upgrade/page.tsx')));
  assert.ok(!/onComplete/.test(embed) && !/onComplete/.test(page), 'a client-side completion handler exists');
  assert.ok(/<CheckoutElement[^>]*\blockBuyerEmail\b/.test(embed), 'the element is not told to lock the email');
  assert.ok(/buyerEmail=\{email\}/.test(embed));
  assert.ok(/email=\{accountEmail\}/.test(page) && /accountEmail\s*=\s*user\?\.email/.test(page), 'the embed does not get the signed-in account email');
  assert.ok(!/role\s*:\s*['"]pro['"]/.test(embed + page), 'the browser writes a Pro role');
});

test('S2. source: the return reads only succeeded, failed and canceled from ?status, says nothing about Pro being on, and does not call history.replaceState', () => {
  const page = stripTsComments(read(appPath('app/upgrade/page.tsx')));
  const m = page.match(/get\('status'\);\s*if\s*\(([^)]*)\)\s*setReturnStatus/); assert.ok(m, 'the status reader moved: re-derive this pin');
  assert.deepEqual([...m![1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort(), ['canceled', 'failed', 'succeeded']);
  assert.ok(!/history\.replaceState/.test(page), 'history.replaceState resets the page state and loses the banner');
  assert.ok(/UPGRADE_RETURN_PENDING/.test(page));
});

test('P1. both Whop packages are pinned to one exact version, the same one', () => {
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
  const a = pkg.dependencies['@whop/elements']; const b = pkg.dependencies['@whop/elements-react'];
  assert.match(a, /^\d+\.\d+\.\d+$/, '@whop/elements is not an exact version'); assert.match(b, /^\d+\.\d+\.\d+$/, '@whop/elements-react is not an exact version'); assert.equal(a, b);
});
