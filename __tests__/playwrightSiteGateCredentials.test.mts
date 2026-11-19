import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* THE BROWSER SUITE BEHIND THE TEAM-ONLY GATE (#2636, PM: "httpCredentials { username: 'team', password: process.env.SITE_GATE_PASSWORD } when that env is set, and the GitHub secret passed into the CI workflow env; harmless while the secret is empty").
 * Rules as literals: no password (unset or empty) = the config adds NOTHING (behaviour unchanged); a local build (no E2E_BASE_URL) adds nothing; production NEVER gets credentials even with the password set (the team password must not leave the team's own sites);
 * a gated site gets { username 'team', password, origin = ONLY the origin under test, send 'always' }; the secret reaches the e2e step env next to E2E_BASE_URL and is never echoed.
 *   P1 the config expression, run on a table   P2 the CI env   P3 no literal password anywhere in the config or the workflow */
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cfg = read('playwright.config.ts'), ci = read('.github/workflows/ci.yml');
const line = cfg.split('\n').filter((l) => l.includes('httpCredentials') && l.trim().startsWith('...('));
assert.equal(line.length, 1, `CONTROL: expected exactly one httpCredentials spread in playwright.config.ts, found ${line.length}`);
const expr = line[0].trim().replace(/,$/, '').replace(/ as const/g, '');
const build = new Function('BASE_URL', 'TARGETS_PRODUCTION', 'process', `return ({ ${expr} });`) as (b: string | undefined, p: boolean, proc: { env: Record<string, string | undefined> }) => Record<string, unknown>;
const run = (base: string | undefined, prod: boolean, pw: string | undefined) => build(base, prod, { env: { SITE_GATE_PASSWORD: pw } });

test('P1. credentials only for a gated (non-production, remote) site with the password set; the origin only; always sent; nothing otherwise', () => {
  const STAGING = 'https://liquidity-hq-staging.onrender.com';
  assert.deepEqual(run(STAGING, false, 'pw: with colons'), { httpCredentials: { username: 'team', password: 'pw: with colons', origin: STAGING, send: 'always' } });
  assert.deepEqual(run(`${STAGING}/arena?x=1`, false, 'pw'), { httpCredentials: { username: 'team', password: 'pw', origin: STAGING, send: 'always' } }, 'only the ORIGIN of the base URL is trusted, not its path');
  assert.deepEqual(run('http://localhost:3100', false, 'pw'), { httpCredentials: { username: 'team', password: 'pw', origin: 'http://localhost:3100', send: 'always' } }, 'a remote-style URL on localhost is fine (the origin is still pinned)');
  for (const pw of [undefined, '']) assert.deepEqual(run(STAGING, false, pw), {}, `password ${JSON.stringify(pw)}: the config must add nothing`);
  assert.deepEqual(run(undefined, false, 'pw'), {}, 'a local build (no base URL) must not carry the password');
  assert.deepEqual(run('https://liquidity-hq.com', true, 'pw'), {}, 'production must NEVER get the team password'); assert.deepEqual(run('https://liquidity-hq.onrender.com', true, 'pw'), {});
});
test('P2. the CI e2e step passes the secret next to E2E_BASE_URL, once, and never prints it', () => {
  const lines = ci.split('\n'); const idx = lines.map((l, i) => (l.includes('SITE_GATE_PASSWORD') ? i : -1)).filter((i) => i >= 0);
  const assignments = idx.filter((i) => /^\s*SITE_GATE_PASSWORD:\s*\$\{\{ inputs\.base_url != '' && secrets\.SITE_GATE_PASSWORD \|\| '' \}\}\s*$/.test(lines[i])); assert.equal(assignments.length, 1, 'the secret must be passed exactly once, and ONLY for a deployed target: SITE_GATE_PASSWORD: ${{ inputs.base_url != \'\' && secrets.SITE_GATE_PASSWORD || \'\' }}');
  const base = lines.findIndex((l) => /^\s*E2E_BASE_URL:\s*\$\{\{\s*inputs\.base_url\s*\}\}/.test(l)); assert.ok(base >= 0, 'CONTROL: E2E_BASE_URL moved'); assert.ok(assignments[0] > base && assignments[0] - base <= 14, 'the secret is not in the same env block as E2E_BASE_URL');
  for (const i of idx) { const l = lines[i]; if (i === assignments[0] || /^\s*#/.test(l)) continue; assert.equal(/echo|printf|cat |env\b|set -x/.test(l), false, `a line other than the env entry mentions the secret and may print it: ${l.trim()}`); }
  assert.equal(/secrets\.SITE_GATE_PASSWORD/.test(lines.filter((l, i) => i !== assignments[0] && !/^\s*#/.test(l)).join('\n')), false, 'the secret is referenced somewhere other than the e2e env entry');
});
test('P4. a run that BUILDS the ref itself never has the gate password in its environment (release PR 2658 failed 50 specs with HTTP 401 when it did)', () => {
  /* GitHub's `a != '' && b || ''` is JS truthiness over strings: b when a is non-empty and b is non-empty, else ''. Table over the three kinds of run. */
  const gh = (baseUrl: string | null, secret: string) => ((baseUrl ?? '') !== '' && secret) || '';
  assert.equal(gh(null, 'pw'), '', 'a PR / push / schedule run (inputs empty) must not carry the password: its local server would gate itself'); assert.equal(gh('', 'pw'), '', 'a dispatch without base_url builds locally: no password');
  assert.equal(gh('https://liquidity-hq-staging.onrender.com', 'pw'), 'pw', 'a dispatch at a deployed site carries it'); assert.equal(gh('https://liquidity-hq-staging.onrender.com', ''), '', 'no secret set: empty (no gate, no credentials)');
  assert.ok(/SITE_GATE_PASSWORD: \$\{\{ inputs\.base_url != '' && secrets\.SITE_GATE_PASSWORD \|\| '' \}\}/.test(ci), 'the workflow expression is not the guarded one the table above models');
});
test('P3. no literal password in the config or the workflow', () => {
  for (const [name, src] of [['playwright.config.ts', cfg], ['ci.yml', ci]] as const) assert.equal(/SITE_GATE_PASSWORD['"]?\s*[:=]\s*['"][^'"$\s{][^'"\s]*['"]/.test(src), false, `${name} assigns SITE_GATE_PASSWORD a literal value`);
  assert.ok(/password:\s*process\.env\.SITE_GATE_PASSWORD/.test(cfg), 'the config does not read the password from the environment');
});
