/* #861: one answer to "is Pro on sale" (58f64e3d).
 *
 * After /upgrade moved to BoomFi, three surfaces decided the same question from
 * two different settings. /upgrade read the BoomFi links; the upgrade prompt on
 * every locked feature (UpgradeGateModal, FullPageUpgradeGate) and the
 * trial-ending email still read the Lemon Squeezy link - the store that rejected
 * us. Found on qa, where that link was still set: "Upgrade" on a locked card
 * went straight to the dead store and skipped /upgrade. On a host without it
 * (production), the email would have said "Pro is not on sale yet" on the day
 * crypto went on sale.
 *
 * The fix is `isProBuyable()` in lib/checkout.ts, used by /upgrade, the email and
 * /api/version; and the two prompts now read no payment setting at all - they
 * always go to /upgrade.
 *
 * THE EMAIL IS RUN FOR REAL, IN ITS OWN PROCESS. `isProBuyable()` with no
 * argument reads a value captured when lib/checkout.ts is first loaded (#243),
 * and lib/email.ts imports that module by a fixed path - so one process can only
 * ever see one setting. Each case below starts a child Node process with its own
 * environment, replaces `fetch` with a stand-in that records the request, calls
 * the real `sendTrialEndingEmail`, and prints what it would have sent to Brevo.
 * No mail is sent and no request leaves the machine: the stand-in answers every
 * URL itself, and the key and sender are placeholders.
 *
 * The prompts are React components, so they are asserted from source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { isProBuyable, isCryptoCheckoutConfigured } from '../lib/checkout.ts';
import { configuredFlags } from '../lib/configured.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CRYPTO = 'https://pay.example.test/monthly-link';
const LS = 'https://store.example.test/checkout/buy/ls-uuid';
const K = {
  crypto: 'NEXT_PUBLIC_BOOMFI_CHECKOUT_URL',
  cryptoAnnual: 'NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_ANNUAL',
  cryptoFortnightly: 'NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_FORTNIGHTLY',
  ls: 'NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL',
  lsAnnual: 'NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_ANNUAL',
  lsFortnightly: 'NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_FORTNIGHTLY',
} as const;

/* ══ The predicate ══ */

test('P1. Pro is buyable exactly when the MONTHLY plan has a BoomFi link - not from a Lemon Squeezy link, and not from another plan\'s link alone', () => {
  assert.equal(isProBuyable({ [K.crypto]: CRYPTO }), true);
  assert.equal(isProBuyable({ [K.crypto]: CRYPTO, [K.ls]: LS }), true);
  assert.equal(isProBuyable({ [K.ls]: LS, [K.lsAnnual]: LS, [K.lsFortnightly]: LS }), false, 'a Lemon Squeezy link made Pro "on sale" - that store rejected us');
  assert.equal(isProBuyable({ [K.cryptoAnnual]: CRYPTO, [K.cryptoFortnightly]: CRYPTO }), false, 'the other plans only render beside the monthly one; without it /upgrade shows no buttons');
  assert.equal(isProBuyable({}), false);
  for (const v of ['#', '', undefined]) assert.equal(isProBuyable({ [K.crypto]: v, [K.ls]: LS }), false, `monthly BoomFi link ${JSON.stringify(v)} must be unset`);
});

test('P2. /api/version reports proBuyable from the same read, and it cannot disagree with cryptoCheckout today', () => {
  for (const env of [{ [K.crypto]: CRYPTO }, { [K.ls]: LS }, { [K.crypto]: '#' }, { [K.cryptoAnnual]: CRYPTO }, {}, { [K.crypto]: CRYPTO, [K.ls]: LS }]) {
    const flags = configuredFlags(env) as Record<string, unknown>;
    assert.equal(typeof flags.proBuyable, 'boolean', 'configured.proBuyable is missing or not a boolean');
    assert.equal(flags.proBuyable, isProBuyable(env), `flag and predicate disagree for ${JSON.stringify(env)}`);
    assert.equal(flags.proBuyable, isCryptoCheckoutConfigured(env), 'proBuyable no longer equals the monthly BoomFi link being set - if card payments were added, update P1 and this line together');
  }
  assert.equal((configuredFlags({ [K.ls]: LS }) as Record<string, unknown>).checkout, true, 'CONTROL: the Lemon Squeezy flag still reports its own link');
});

/* ══ The trial-ending email, run for real in a child process per environment ══ */

const CHILD = `
const calls = [];
globalThis.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  calls.push({ url, body: init && typeof init.body === 'string' ? init.body : null });
  return new Response('{"messageId":"qa-stand-in"}', { status: 201, headers: { 'content-type': 'application/json' } });
};
const { sendTrialEndingEmail } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'lib', 'email.ts')).href)});
const ok = await sendTrialEndingEmail({ to: 'trial@example.test', daysLeft: 3 });
process.stdout.write('QA_RESULT' + JSON.stringify({ ok, calls }));
process.exit(0);
`;

type Sent = { ok: boolean; html: string; to: string; hosts: string[] };
function sendTrialEmail(links: Partial<Record<keyof typeof K, string>>): Sent {
  // Typed as ProcessEnv, not a plain record: the project's typing requires NODE_ENV on it, and with a
  // plain record execFileSync's string-returning overload does not match (the hook's whole-project
  // typecheck caught this; a file-scoped check without next-env.d.ts did not).
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('NEXT_PUBLIC_') || k.startsWith('BREVO_')) delete env[k];
  env.BREVO_API_KEY = 'qa-placeholder-not-a-key';
  env.BREVO_SENDER_EMAIL = 'sender@example.test';
  env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
  for (const [name, value] of Object.entries(links)) env[K[name as keyof typeof K]] = value!;
  const out = execFileSync(process.execPath, ['--import', './qa/alias-register.mjs', '--input-type=module', '-e', CHILD], { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const at = out.indexOf('QA_RESULT');
  assert.ok(at >= 0, `the child process printed no result: ${out.slice(0, 300)}`);
  const { ok, calls } = JSON.parse(out.slice(at + 'QA_RESULT'.length)) as { ok: boolean; calls: { url: string; body: string | null }[] };
  const brevo = calls.filter((c) => c.url.startsWith('https://api.brevo.com/'));
  assert.equal(brevo.length, 1, `expected exactly one request to the mail provider, saw ${brevo.length}`);
  const payload = JSON.parse(brevo[0].body!) as { htmlContent: string; to: { email: string }[] };
  return { ok, html: payload.htmlContent, to: payload.to[0].email, hosts: [...new Set(calls.map((c) => new URL(c.url).host))] };
}
const keepPro = (html: string) => /Keep Pro: <a href="https:\/\/app\.example\.test\/upgrade">/.test(html);
const notOnSale = (html: string) => html.includes('Pro is not on sale yet');

test('E1. only the BoomFi monthly link set (production, the day crypto goes on sale): the email says "Keep Pro" and links /upgrade', { timeout: 90_000 }, () => {
  const sent = sendTrialEmail({ crypto: CRYPTO });
  assert.equal(sent.ok, true);
  assert.equal(sent.to, 'trial@example.test');
  assert.equal(keepPro(sent.html), true, 'with Pro on sale the email offers no way to keep it');
  assert.equal(notOnSale(sent.html), false, 'the email says Pro is not on sale while /upgrade is selling it - the bug this fix is for');
});

test('E2. only a Lemon Squeezy link set (qa and staging today): the email says Pro is not on sale - it no longer believes the dead store', { timeout: 90_000 }, () => {
  const sent = sendTrialEmail({ ls: LS, lsAnnual: LS, lsFortnightly: LS });
  assert.equal(notOnSale(sent.html), true);
  assert.equal(keepPro(sent.html), false, 'the email promises a purchase path on a host where /upgrade shows "coming soon"');
});

test('E3. nothing set: not on sale. Both set: Keep Pro. Another plan\'s BoomFi link alone: not on sale, same as /upgrade', { timeout: 120_000 }, () => {
  assert.equal(notOnSale(sendTrialEmail({}).html), true);
  assert.equal(keepPro(sendTrialEmail({ crypto: CRYPTO, ls: LS }).html), true);
  const annualOnly = sendTrialEmail({ cryptoAnnual: CRYPTO });
  assert.equal(notOnSale(annualOnly.html), true, 'an annual link with no monthly one renders no buttons on /upgrade, so the email must not promise a purchase');
});

test('E4. either way the email links the app\'s own /upgrade and never a payment page, and nothing but the mail provider\'s stand-in is contacted for the send', { timeout: 90_000 }, () => {
  for (const links of [{ crypto: CRYPTO }, { ls: LS }] as const) {
    const sent = sendTrialEmail(links);
    assert.equal(/pay\.example\.test|store\.example\.test|boomfi|lemonsqueezy/i.test(sent.html), false, 'a payment-provider address is in the email body');
    assert.ok(sent.hosts.includes('api.brevo.com'));
  }
});

/* ══ The two upgrade prompts: source ══ */

test('S1. UpgradeGateModal and FullPageUpgradeGate read no payment setting and always go to /upgrade', () => {
  const src = stripComments(read('components/UpgradeGateModal.tsx'));
  assert.equal(/from ['"]@\/lib\/checkout['"]/.test(src), false, 'the prompt imports from lib/checkout again - it must not decide where to send a buyer from a payment link');
  assert.match(src, /function useUpgradeHref\(\) \{\s*const \{ user \} = useAuth\(\);\s*return user \? '\/upgrade' : '\/login\?signup=1&next=\/upgrade';\s*\}/, 'useUpgradeHref changed - both prompts must go to /upgrade (signed in) or sign-up with /upgrade next (signed out)');
  assert.equal((src.match(/const ctaHref = useUpgradeHref\(\);/g) ?? []).length, 2, 'the modal and the full-page gate do not both use useUpgradeHref');
  assert.equal((src.match(/href=\{ctaHref\}/g) ?? []).length, 2);
  assert.equal(/lemonsqueezy|boomfi|getCheckoutUrl|getCryptoCheckoutUrl|process\.env/i.test(src), false, 'the prompt names a payment provider, a checkout getter or an environment value');
});

test('S2. /upgrade and the email both ask isProBuyable()', () => {
  assert.match(stripComments(read('app/upgrade/page.tsx')), /const CHECKOUT_CONFIGURED = isProBuyable\(\);/);
  const email = stripComments(read('lib/email.ts'));
  assert.match(email, /const checkoutLive = isProBuyable\(\);/);
  assert.equal(/isCheckoutConfigured|NEXT_PUBLIC_LEMONSQUEEZY/.test(email), false, 'the email reads the Lemon Squeezy link again');
});

test('S3. SWEEP: no file under app/, components/ or lib/ reads a Lemon Squeezy checkout link, except lib/checkout.ts and lib/configured.ts', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(rel);
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(d);
  const NEEDLE = /\b(?:isCheckoutConfigured|getCheckoutUrl|checkoutBase)(?:Annual|Fortnightly)?\b|NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL/;
  const hits = files.filter((f) => NEEDLE.test(stripComments(read(f)))).sort();
  // Positive controls first: a sweep that scanned nothing, or whose pattern matches nothing, would "pass".
  assert.ok(files.length > 150, `only ${files.length} files were scanned - the walk is not seeing the tree`);
  assert.ok(files.includes('app/arena/page.tsx') && files.includes('components/UpgradeGateModal.tsx'), 'expected files are missing from the walk');
  assert.ok(hits.includes('lib/checkout.ts'), 'CONTROL: the pattern does not even match the file that defines these readers');
  assert.deepEqual(hits, ['lib/checkout.ts', 'lib/configured.ts'], `a Lemon Squeezy checkout link is read outside the two allowed files: ${hits.join(', ')}`);
});
