import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  isProductionTarget, assertProductionRunAllowed, classifySpec,
  PROD_READONLY_SPECS, PROD_EXCLUDED, PROD_READONLY_TEST_MATCH,
} from '../qa/prod-readonly.ts';

/* #1364 / #1259 - the guard that keeps the mutating suite off production. Two halves:
 * the refusal (host detection, explicit opt-in, no billed calls) and the allowlist
 * that cannot rot (every allowlisted spec still classifies as clean; every spec file
 * is in exactly one of the two lists). Controls throughout: a check that cannot fail
 * is worth nothing here, because the failure it guards is silent until it is expensive. */

const specDir = new URL('../qa/e2e/', import.meta.url);
const specFiles = readdirSync(specDir).filter(f => f.endsWith('.spec.ts')).map(f => f.replace(/\.spec\.ts$/, '')).sort();
const read = (name: string) => readFileSync(new URL(`${name}.spec.ts`, specDir), 'utf8');

test('production hosts are recognised, deployed non-production hosts and localhost are not', () => {
  for (const u of ['https://liquidity-hq.com', 'https://liquidity-hq.com/', 'https://www.liquidity-hq.com', 'HTTPS://LIQUIDITY-HQ.COM',
    'https://liquidity-hq-prod.onrender.com', 'https://app.liquidity-hq.com']) {
    assert.equal(isProductionTarget(u), true, `${u} must be production`);
  }
  for (const u of ['https://liquidity-hq-qa.onrender.com', 'https://liquidity-hq-staging.onrender.com', 'https://liquidity-hq-dev.onrender.com',
    'http://localhost:3100', 'http://127.0.0.1:3100', undefined, '']) {
    assert.equal(isProductionTarget(u), false, `${String(u)} must NOT be production`);
  }
});

test('a look-alike host is not mistaken for production, and unparseable input is refused rather than waved through', () => {
  assert.equal(isProductionTarget('https://liquidity-hq.com.evil.example'), false, 'a host that merely starts with the production name is a different host');
  assert.equal(isProductionTarget('not a url'), true, 'a non-empty URL that cannot be parsed must be treated as production');
});

test('a production run needs an explicit opt-in, and billed AI calls are refused outright', () => {
  assert.throws(() => assertProductionRunAllowed({ E2E_BASE_URL: 'https://liquidity-hq.com' }), /REFUSING TO LOAD/);
  assert.throws(() => assertProductionRunAllowed({ E2E_ALLOW_PRODUCTION: '0' }), /REFUSING TO LOAD/, 'only "1" counts as opting in');
  assert.throws(() => assertProductionRunAllowed({ E2E_ALLOW_PRODUCTION: '1', E2E_ALLOW_BILLED_CALLS: '1' }), /billed AI calls never run/i);
  assert.doesNotThrow(() => assertProductionRunAllowed({ E2E_ALLOW_PRODUCTION: '1' }));
});

test('every allowlisted spec exists and still classifies as clean: no write verb, no dev-only seam, no billed gate', () => {
  const bad: string[] = [];
  for (const { spec } of PROD_READONLY_SPECS) {
    assert.ok(specFiles.includes(spec), `allowlisted spec "${spec}" does not exist in qa/e2e/`);
    const c = classifySpec(read(spec));
    if (!c.clean) bad.push(`${spec}: ${[...c.writes, c.seam ? 'dev-only seam' : '', c.billed ? 'billed AI' : ''].filter(Boolean).join(', ')}`);
  }
  assert.deepEqual(bad, [], 'these allowlisted specs now write, use a QA seam or spend AI credits - remove them from the allowlist and give them a reason in PROD_EXCLUDED');
});

test('every spec file is in EXACTLY ONE list, so a new spec has to be classified by whoever adds it', () => {
  const allowed = new Set(PROD_READONLY_SPECS.map(s => s.spec));
  const excluded = new Set(Object.keys(PROD_EXCLUDED));
  const unclassified = specFiles.filter(f => !allowed.has(f) && !excluded.has(f));
  assert.deepEqual(unclassified, [], 'these specs are in neither PROD_READONLY_SPECS nor PROD_EXCLUDED (qa/prod-readonly.ts): decide, and say why if excluded');
  assert.deepEqual([...allowed].filter(f => excluded.has(f)), [], 'a spec cannot be both allowed and excluded');
  assert.deepEqual([...excluded].filter(f => !specFiles.includes(f)), [], 'PROD_EXCLUDED names a spec that no longer exists');
  assert.equal(new Set(PROD_READONLY_SPECS.map(s => s.spec)).size, PROD_READONLY_SPECS.length, 'duplicate allowlist entry');
  for (const [spec, why] of Object.entries(PROD_EXCLUDED)) assert.ok(why.trim().length > 10, `"${spec}" is excluded without a real reason`);
});

test('CONTROL: the classifier can fail - it catches a write, a seam and a billed gate, and ignores prose', () => {
  assert.equal(classifySpec("await fetch('/api/settings', { method: 'PATCH', body: '{}' });").clean, false);
  assert.equal(classifySpec("await request.post('/api/x', { data: {} });").clean, false);
  assert.equal(classifySpec("window.__LHQ_QA_FORCE_ENTITLEMENTS_FAIL__ = true;").clean, false);
  assert.equal(classifySpec("test.skip(!BILLED_CALLS_READY, 'x');").clean, false);
  assert.equal(classifySpec("/* this spec used to PATCH settings: method: 'PATCH' */ await page.goto('/');").clean, true, 'a mention in a comment must not count');
  assert.equal(classifySpec("// method: 'POST'\nawait page.goto('/');").clean, true);
  // And on REAL files: known writers must be caught by the same function that vouches for the allowlist.
  for (const writer of ['bola', 'strategy-panel-preload-race', 'payments-webhook']) {
    assert.equal(classifySpec(read(writer)).clean, false, `${writer} writes on purpose but classified clean - the classifier is blind to it`);
  }
});

test('the production testMatch selects allowlisted specs on either path separator and nothing else', () => {
  const [re] = PROD_READONLY_TEST_MATCH;
  assert.ok(re.test('C:\\repo\\qa\\e2e\\smoke.spec.ts'));
  assert.ok(re.test('/repo/qa/e2e/support-contact-address.spec.ts'));
  assert.equal(re.test('/repo/qa/e2e/bola.spec.ts'), false, 'a writer must not match');
  assert.equal(re.test('/repo/qa/e2e/lemonsqueezy-real-purchase.spec.ts'), false);
  assert.equal(re.test('/repo/qa/e2e/checkout.spec.ts'), false, '"checkout" is excluded; "checkout-config-agrees" must not drag it in by prefix');
  assert.equal(re.test('/repo/qa/e2e/checkout-config-agrees.spec.ts'), true);
  assert.equal(re.test('/repo/qa/e2e/a11y.spec.ts'), true);
  assert.equal(re.test('/repo/qa/e2e/xa11y.spec.ts'), false, 'no substring matching: "xa11y" is not "a11y"');
});
