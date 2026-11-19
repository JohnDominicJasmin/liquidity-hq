import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gateCookieHeader as gateCookieHeaderRaw } from '../scripts/deep-canary.mjs';
const gateCookieHeader = (base: string, env: Record<string, string | undefined>) => gateCookieHeaderRaw(base, env as NodeJS.ProcessEnv) as Record<string, string>;

/* #2674 THE DEEP CANARY BEHIND THE SITE GATE. The canary signs in (Supabase) and POSTs /api/grok with `Authorization: Bearer <token>` to the staging site; since the site gate (#2636) a Bearer request is a 401 "Authentication required" unless it also carries the gate cookie the gate accepts (#2672): lhq_gate = HMAC-SHA256(key = the password, "lhq-gate-v1") as hex. The canary read that 401 as "UNKNOWN: rejected as unauthenticated" and opened an issue (#2674) that cannot close on UNKNOWN.
 * Written rule: when SITE_GATE_PASSWORD is set the Deep POST carries Cookie: lhq_gate=<that value>; with no password nothing is added (an ungated target behaves as before); the cookie goes ONLY to the three gated hosts (dev, qa, staging), never to production or any other host (a value derived from the team password must not leave the team's own sites); the workflow passes the GitHub secret into the probe step only; the password itself is never put in a header, a log line or the repo.
 *   C1 no password / empty -> nothing   C2 the three gated hosts get exactly the written cookie   C3 production, look-alikes, other ports/schemes of other hosts, garbage -> nothing   C4 source: the Deep POST spreads gateCookieHeader(BASE) next to the Bearer, and no other request gets it   C5 workflow: the secret reaches the probe step env once, as a secret reference, never a literal */
const hmac = (pw: string) => createHmac('sha256', pw).update('lhq-gate-v1', 'utf8').digest('hex');
const GATED = ['https://liquidity-hq-dev.onrender.com', 'https://liquidity-hq-qa.onrender.com', 'https://liquidity-hq-staging.onrender.com'];
const PW = 'correct horse: battery:staple';
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('C1. without a password nothing is added', () => {
  for (const env of [{}, { SITE_GATE_PASSWORD: '' }, { SITE_GATE_PASSWORD: undefined }]) for (const base of GATED) assert.deepEqual(gateCookieHeader(base, env as Record<string, string | undefined>), {}, `${base} ${JSON.stringify(env)}`);
});
test('C2. the three gated hosts get exactly lhq_gate = HMAC-SHA256(password, "lhq-gate-v1") hex, and nothing else', () => {
  for (const base of [...GATED, GATED[2] + '/', GATED[2] + '/api', GATED[0].toUpperCase().replace('HTTPS', 'https')]) { const h = gateCookieHeader(base, { SITE_GATE_PASSWORD: PW }); assert.deepEqual(Object.keys(h), ['Cookie'], base); assert.equal(h.Cookie, `lhq_gate=${hmac(PW)}`, `${base}: the cookie is not the written HMAC`); assert.match(h.Cookie, /^lhq_gate=[0-9a-f]{64}$/); assert.equal(h.Cookie.includes(PW), false, 'the password is in the header'); }
  assert.notEqual(gateCookieHeader(GATED[0], { SITE_GATE_PASSWORD: PW }).Cookie, gateCookieHeader(GATED[0], { SITE_GATE_PASSWORD: PW + 'x' }).Cookie, 'a different password gives a different cookie');
});
test('C3. production, look-alike and unknown hosts get NOTHING even with the password set', () => {
  const env = { SITE_GATE_PASSWORD: PW };
  for (const base of ['https://liquidity-hq.com', 'https://www.liquidity-hq.com', 'https://liquidity-hq.onrender.com', 'https://liquidity-hq-prod.onrender.com', 'https://liquidity-hq-staging.onrender.com.evil.test', 'https://evil.test/liquidity-hq-staging.onrender.com', 'https://xliquidity-hq-qa.onrender.com', 'https://liquidity-hq-staging.onrender.com@evil.test', 'http://localhost:3000', 'https://127.0.0.1', 'not a url', '', 'liquidity-hq-staging.onrender.com'])
    assert.deepEqual(gateCookieHeader(base, env), {}, `${JSON.stringify(base)} must get no cookie`);
});
test('C4. source: only the Deep POST carries the cookie, next to the Bearer', () => {
  const src = read('scripts/deep-canary.mjs').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((src.match(/gateCookieHeader\(/g) ?? []).length, 2, 'the definition and exactly one use'); assert.match(src, /headers: \{ 'Content-Type': 'application\/json', Authorization: `Bearer \$\{token\}`, \.\.\.gateCookieHeader\(BASE\) \}/, 'the Deep POST does not spread gateCookieHeader(BASE)');
  const authAt = src.indexOf('/auth/v1/token'); assert.ok(authAt > 0); assert.equal(src.slice(authAt, authAt + 400).includes('gateCookieHeader'), false, 'the Supabase sign-in must never get the gate cookie');
  assert.equal(/console\.log\([^)]*SITE_GATE_PASSWORD|log\([^)]*SITE_GATE_PASSWORD/.test(src), false, 'the password is logged'); assert.match(src, /new Set\(\['liquidity-hq-dev\.onrender\.com', 'liquidity-hq-qa\.onrender\.com', 'liquidity-hq-staging\.onrender\.com'\]\)/, 'the allowlist changed');
});
test('C5. workflow: the secret reaches the probe step once, as a secret reference', () => {
  const wf = read('.github/workflows/deep-canary.yml'); const lines = wf.split('\n').filter((l) => l.includes('SITE_GATE_PASSWORD') && !/^\s*#/.test(l));
  assert.equal(lines.length, 1, `exactly one SITE_GATE_PASSWORD entry, found ${lines.length}`); assert.match(lines[0], /^\s+SITE_GATE_PASSWORD:\s+\$\{\{ secrets\.SITE_GATE_PASSWORD \}\}\s*$/, 'not a bare secret reference');
  const probe = wf.indexOf('- name: Probe Deep and classify'); const at = wf.indexOf('SITE_GATE_PASSWORD:'); assert.ok(probe > 0 && at > probe && at < probe + 4000, 'the secret is not in the probe step env');
  assert.equal(/SITE_GATE_PASSWORD['"]?\s*[:=]\s*['"][^'"$\s{][^'"\s]*['"]/.test(wf), false, 'a literal password');
});
