/* Mutation check for __tests__/cryptoCheckout.test.mts and __tests__/boomfiWebhookVerify.test.mts
 * (#861, Dev head b45bf22e). One test file per mutation run - never the full suite. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const CO = 'lib/checkout.ts';
const CF = 'lib/configured.ts';
const UP = 'app/upgrade/page.tsx';
const LK = 'lib/labelKeys.ts';
const BF = 'lib/boomfi.ts';
const T_CRYPTO = '__tests__/cryptoCheckout.test.mts';
const T_BOOMFI = '__tests__/boomfiWebhookVerify.test.mts';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const ANNUAL_READ = "const base = env ? env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_ANNUAL : INLINED_CRYPTO_ANNUAL;\n  return base && base !== '#' ? base : null;";
const FORT_READ = "const base = env ? env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_FORTNIGHTLY : INLINED_CRYPTO_FORTNIGHTLY;\n  return base && base !== '#' ? base : null;";

const M = [
  // ── lib/checkout.ts, lib/configured.ts ──
  { t: T_CRYPTO, name: 'M1 annual falls back to the monthly link when unset', f: CO, from: ANNUAL_READ,
    to: "const base = env ? env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_ANNUAL : INLINED_CRYPTO_ANNUAL;\n  return base && base !== '#' ? base : cryptoCheckoutBase(env);", red: ['C2.', 'C3.'] },
  { t: T_CRYPTO, name: "M2 '#' counts as a link for the two-weekly plan", f: CO, from: FORT_READ,
    to: "const base = env ? env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_FORTNIGHTLY : INLINED_CRYPTO_FORTNIGHTLY;\n  return base ? base : null;", red: ['C2.', 'C7.'] },
  { t: T_CRYPTO, name: 'M3 getCryptoCheckoutUrl(annual) uses the monthly link', f: CO,
    from: "const base = plan === 'annual' ? cryptoCheckoutBaseAnnual()", to: "const base = plan === 'annual' ? cryptoCheckoutBase()", red: ['C5.', 'C7.'] },
  { t: T_CRYPTO, name: 'M4 getCryptoCheckoutUrl falls back to the sign-up path when unset', f: CO,
    from: '  if (!base) return null;\n  if (!user?.id) return base;', to: "  if (!base) return '/login?signup=1';\n  if (!user?.id) return base;", red: ['C7.'] },
  { t: T_CRYPTO, name: 'M5 the account email is added to the link too', f: CO,
    from: "    url.searchParams.set('customer_ident', user.id);", to: "    url.searchParams.set('customer_ident', user.id);\n    url.searchParams.set('email', (user as { email?: string }).email ?? '');", red: ['C6.'] },
  { t: T_CRYPTO, name: 'M5b customer_ident is not added at all', f: CO,
    from: "    url.searchParams.set('customer_ident', user.id);\n", to: '', red: ['C6.', 'C6b.'] },
  { t: T_CRYPTO, name: 'M5c the parameter is misnamed', f: CO,
    from: "url.searchParams.set('customer_ident', user.id);", to: "url.searchParams.set('customer_id', user.id);", red: ['C6.'] },
  { t: T_CRYPTO, name: 'M5d a link that is not a URL throws instead of degrading', f: CO,
    from: "    url.searchParams.set('customer_ident', user.id);\n    return url.toString();\n  } catch {\n    return base;\n  }", to: "    url.searchParams.set('customer_ident', user.id);\n    return url.toString();\n  } catch (e) {\n    throw e;\n  }", red: ['C7b.'] },
  { t: T_CRYPTO, name: 'M5e the existing query on the configured link is dropped', f: CO,
    from: "    url.searchParams.set('customer_ident', user.id);", to: "    url.search = '';\n    url.searchParams.set('customer_ident', user.id);", red: ['C6.'] },
  { t: T_CRYPTO, name: 'M6 the annual constant reads the monthly variable', f: CO,
    from: 'const INLINED_CRYPTO_ANNUAL = process.env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_ANNUAL;', to: 'const INLINED_CRYPTO_ANNUAL = process.env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL;', red: ['C5.', 'C9.'] },
  { t: T_CRYPTO, name: 'M7 the two-weekly reader uses the monthly constant in the browser path', f: CO, from: FORT_READ,
    to: "const base = env ? env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_FORTNIGHTLY : INLINED_CRYPTO_MONTHLY;\n  return base && base !== '#' ? base : null;", red: ['C5.', 'C10.'] },
  { t: T_CRYPTO, name: 'M8 the monthly crypto reader accepts the Lemon Squeezy link', f: CO,
    from: 'const base = env ? env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL : INLINED_CRYPTO_MONTHLY;',
    to: 'const base = env ? (env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL ?? env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL) : INLINED_CRYPTO_MONTHLY;', red: ['C4.'] },
  { t: T_CRYPTO, name: 'M9 /api/version reports the annual flag from the monthly read', f: CF,
    from: 'cryptoCheckoutAnnual:      isCryptoCheckoutConfiguredAnnual(env),', to: 'cryptoCheckoutAnnual:      isCryptoCheckoutConfigured(env),', red: ['C11.'] },
  // ── app/upgrade/page.tsx ──
  { t: T_CRYPTO, name: 'M10 /upgrade gates the annual button on the monthly link', f: UP,
    from: 'const CHECKOUT_ANNUAL_CONFIGURED = isCryptoCheckoutConfiguredAnnual();', to: 'const CHECKOUT_ANNUAL_CONFIGURED = isCryptoCheckoutConfigured();', red: ['U1.'] },
  { t: T_CRYPTO, name: 'M11 a signed-out visitor is sent to sign-up AND still reaches the payment step', f: UP,
    from: "if (!user) { router.push('/login?signup=1&next=/upgrade'); return; }", to: "if (!user) { router.push('/login?signup=1&next=/upgrade'); }", red: ['U2.'] },
  { t: T_CRYPTO, name: 'M12 the annual button chooses the monthly plan', f: UP,
    from: "const handleCheckoutAnnual = () => choosePlan('annual');", to: "const handleCheckoutAnnual = () => choosePlan('monthly');", red: ['U3.'] },
  { t: T_CRYPTO, name: 'M13 the link is always the monthly one, whatever plan was picked', f: UP,
    from: 'getCryptoCheckoutUrl(selectedPlan, user)', to: "getCryptoCheckoutUrl('monthly', user)", red: ['U4.'] },
  { t: T_CRYPTO, name: 'M13b the signed-in user is not passed, so no account id reaches the link', f: UP,
    from: 'getCryptoCheckoutUrl(selectedPlan, user)', to: 'getCryptoCheckoutUrl(selectedPlan, null)', red: ['U4.'] },
  { t: T_CRYPTO, name: 'M14 a plan button navigates straight to the payment page (no method step)', f: UP,
    from: '    setSelectedPlan(plan);\n  }', to: "    setSelectedPlan(plan);\n    window.location.href = getCryptoCheckoutUrl(plan, user) ?? '/upgrade';\n  }", red: ['U2.', 'U4.'] },
  { t: T_CRYPTO, name: 'M15 the crypto button renders even when the plan has no link', f: UP,
    from: '{cryptoUrl && (', to: '{true && (', red: ['U5.'] },
  { t: T_CRYPTO, name: 'M16 the weekly note shows for every plan', f: UP,
    from: "{selectedPlan === 'fortnightly' && (", to: '{selectedPlan && (', red: ['U6.'] },
  { t: T_CRYPTO, name: 'M17 the panel is dropped from the monthly-only state', f: UP, nth: 2,
    from: '{methodPanel}', to: '', red: ['U7.'] },
  { t: T_CRYPTO, name: 'M18 a label key is not registered', f: LK,
    from: "'UPGRADE_METHOD_CRYPTO_NOTE', 'UPGRADE_METHOD_CRYPTO_WEEKLY_NOTE',", to: "'UPGRADE_METHOD_CRYPTO_NOTE',", red: ['L1.'] },
  { t: T_CRYPTO, name: 'M19 payWithCrypto loses its no-link guard', f: UP,
    from: '    if (!selectedPlan || !cryptoUrl) return;\n', to: '', red: ['U4.'] },
  { t: T_CRYPTO, name: 'M20 a second button (card) appears in the panel', f: UP,
    from: "      {/* BoomFi has no two-week interval", to: "      <button data-testid=\"checkout-method-card\">Card</button>\n      {/* BoomFi has no two-week interval", red: ['U5.'] },
  { t: T_CRYPTO, name: 'M21 the Back-button reset fires on every pageshow, not only a restored page', f: UP,
    from: 'if (e.persisted) setRedirecting(null);', to: 'setRedirecting(null);', red: ['U8.'] },
  { t: T_CRYPTO, name: 'M22 the pageshow listener is never removed', f: UP,
    from: "    return () => window.removeEventListener('pageshow', onPageShow);\n", to: '', red: ['U8.'] },
  // ── lib/boomfi.ts ──
  { t: T_BOOMFI, name: 'W1 the signature is not checked at all', f: BF,
    from: "return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };", to: 'return { ok: true };', red: ['B3.', 'B4.', 'B5.', 'B6.'] },
  { t: T_BOOMFI, name: 'W2 the timestamp is left out of the signed message', f: BF,
    from: 'Buffer.from(`${timestamp}.${opts.rawBody}`, \'utf8\'),', to: "Buffer.from(opts.rawBody, 'utf8'),", red: ['B1.'] },
  { t: T_BOOMFI, name: 'W3 the freshness check is removed', f: BF,
    from: "  if (Math.abs(nowS - Number(timestamp)) > tolerance) return { ok: false, reason: 'stale_timestamp' };\n", to: '', red: ['B11.', 'B12.'] },
  { t: T_BOOMFI, name: 'W4 only the past is checked - a future timestamp passes', f: BF,
    from: 'if (Math.abs(nowS - Number(timestamp)) > tolerance)', to: 'if (nowS - Number(timestamp) > tolerance)', red: ['B11.'] },
  { t: T_BOOMFI, name: 'W5 the window boundary is exclusive (300 s itself is refused)', f: BF,
    from: 'if (Math.abs(nowS - Number(timestamp)) > tolerance)', to: 'if (Math.abs(nowS - Number(timestamp)) >= tolerance)', red: ['B11.'] },
  { t: T_BOOMFI, name: 'W6 the window is 3000 s', f: BF,
    from: 'export const BOOMFI_TIMESTAMP_TOLERANCE_S = 300;', to: 'export const BOOMFI_TIMESTAMP_TOLERANCE_S = 3000;', red: ['B11.'] },
  { t: T_BOOMFI, name: 'W7 the timestamp is parsed with Number() instead of digits-only', f: BF,
    from: "if (!/^\\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad_timestamp' };", to: "if (!Number.isFinite(Number(timestamp))) return { ok: false, reason: 'bad_timestamp' };", red: ['B10.'] },
  { t: T_BOOMFI, name: 'W8 the key type is not checked (an EC key is verified under its own rules)', f: BF,
    from: "  if (key.asymmetricKeyType !== 'rsa') return { ok: false, reason: 'bad_public_key' };\n", to: '', red: ['B7.'] },
  { t: T_BOOMFI, name: 'W9 the padding is not fixed', f: BF,
    from: '{ key, padding: crypto.constants.RSA_PKCS1_PADDING },', to: '{ key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING },', red: ['B1.'] },
  { t: T_BOOMFI, name: 'W10 SHA-1 is accepted', f: BF,
    from: "      'RSA-SHA256',", to: "      'RSA-SHA1',", red: ['B1.'] },
  { t: T_BOOMFI, name: 'W11 an unparseable key throws instead of returning a reason', f: BF,
    from: "  } catch {\n    return { ok: false, reason: 'bad_public_key' };\n  }", to: '  } catch (e) {\n    throw e;\n  }', red: ['B7.'] },
  { t: T_BOOMFI, name: 'W12 no key configured passes', f: BF,
    from: "if (!pem) return { ok: false, reason: 'no_public_key' };", to: 'if (!pem) return { ok: true };', red: ['B8.'] },
  { t: T_BOOMFI, name: 'W13 the backslash-n form of the key is not normalised', f: BF,
    from: "return (raw ?? '').replace(/\\\\n/g, '\\n').trim();", to: "return (raw ?? '').trim();", red: ['B2.'] },
  { t: T_BOOMFI, name: 'W14 a missing signature header is judged as a bad signature', f: BF,
    from: "  if (!signature || !timestamp) return { ok: false, reason: 'missing_headers' };\n", to: '', red: ['B9.'] },
  // W15 (drop the `!expected` guard) is an EQUIVALENT mutant and is not run: the return line's own
  // `actual !== ''` already makes an empty expected id unmatchable, so either guard alone gives the same
  // answers for every input. O3 pins the behaviour; no test can tell the two guards apart.
  { t: T_BOOMFI, name: 'W16 either org field matching is enough', f: BF,
    from: "return actual !== '' && actual === expected;", to: 'return b.org_id === expected || nested === expected;', red: ['O4.'] },
  { t: T_BOOMFI, name: 'W17 the org check is a prefix match', f: BF,
    from: "return actual !== '' && actual === expected;", to: "return actual !== '' && actual.startsWith(expected);", red: ['O2.'] },
  { t: T_BOOMFI, name: 'W18 the org check always passes', f: BF,
    from: "return actual !== '' && actual === expected;", to: 'return true;', red: ['O2.', 'O4.'] },
];

const FILES = [CO, CF, UP, LK, BF];
const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', ...FILES], { windowsHide: true });
const run = (t) => {
  let out = '', code = 0;
  try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', t], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 60_000 }); }
  catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  const failed = [...new Set([...out.matchAll(/^\s*\u2716 (\S+)/gm)].map((x) => x[1]))].filter((k) => /^[A-Z]\d+[a-z]?\.$/.test(k));
  return { code, failed };
};

revert();
for (const t of [T_CRYPTO, T_BOOMFI]) {
  const b = run(t);
  console.log(`BASELINE ${t} exit ${b.code} red: ${b.failed.join(', ') || '(none)'}`);
  if (b.code !== 0) process.exit(2);
}
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
let all = true, ok = 0, total = 0;
for (const m of M) {
  if (ONLY.length && !ONLY.includes(m.name.split(' ')[0])) continue;
  total++;
  const src = readFileSync(`${ROOT}/${m.f}`, 'utf8').split(CR + LF).join(LF);
  const n = src.split(m.from).length - 1;
  const need = m.nth ?? 1;
  if (m.nth ? n < need : n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); all = false; continue; }
  let at = -1;
  for (let i = 0; i < need; i++) at = src.indexOf(m.from, at + 1);
  writeFileSync(`${ROOT}/${m.f}`, src.slice(0, at) + m.to + src.slice(at + m.from.length));
  const r = run(m.t);
  revert();
  const missing = m.red.filter((k) => !r.failed.includes(k));
  const good = r.code !== 0 && missing.length === 0;
  if (good) ok++; else all = false;
  console.log(`${good ? 'OK    ' : 'WRONG '}  ${m.name}\n        want red: ${m.red.join(', ')} | actually red: ${r.failed.join(', ') || '(none - suite stayed GREEN)'}${missing.length ? ` | NOT CAUGHT: ${missing.join(', ')}` : ''}`);
}
revert();
console.log(execFileSync('git', ['-C', ROOT, 'status', '--short', '--', ...FILES], { encoding: 'utf8' }) || 'source files clean after run');
console.log(`${ok}/${total} behaved as designed.` + (all ? '' : '  A MUTATION DID NOT BEHAVE AS DESIGNED.'));
