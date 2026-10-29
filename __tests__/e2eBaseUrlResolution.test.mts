/**
 * WHERE THE BROWSER SUITE POINTS. One value decides two things, and getting it wrong
 * produces a run that looks healthy and measures nothing.
 *
 * `E2E_BASE_URL` sets the `baseURL` every `page.goto('/x')` resolves against AND
 * whether `webServer` builds and boots the app. Asserted because #1802 added a
 * `workflow_dispatch` input for it, and a dispatch input declared `default: ''` arrives
 * as an EMPTY STRING rather than as an absent variable - which `?.` and `??` do not
 * treat as absent. Dev Team caught it in review; the measured consequences are in
 * qa/baseUrl.ts.
 *
 * BOTH DIRECTIONS ON PURPOSE. A config aimed at the wrong host fails in a way that
 * reads as the product being broken, so "a real url is honoured" needs asserting as
 * loudly as "a blank one is ignored".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveBaseUrl } from '@/qa/baseUrl';

const LOCAL = 'http://localhost:3100';

/* What the config does with the resolver's answer, in the two places it matters. */
const baseUrlFor = (raw: string | undefined) => resolveBaseUrl(raw) ?? LOCAL;
const buildsLocally = (raw: string | undefined) => !resolveBaseUrl(raw);

test('B1. unset, empty and whitespace-only all mean BUILD LOCALLY', () => {
  for (const raw of [undefined, '', '   ', '\t', '\n  \n'] as (string | undefined)[]) {
    assert.equal(resolveBaseUrl(raw), undefined, `${JSON.stringify(raw)} should resolve to undefined`);
    assert.equal(baseUrlFor(raw), LOCAL, `${JSON.stringify(raw)} should fall back to the local url`);
    assert.equal(buildsLocally(raw), true, `${JSON.stringify(raw)} should leave webServer defined`);
  }
});

test('B2. the empty string is the case that regressed - it must NOT become the baseURL', () => {
  /* The defect in one assertion: before the guard, `''` gave `baseURL: ''`, so every
     navigation resolved against nothing while the build succeeded and the run looked
     fine. This is the row that would have caught it. */
  assert.notEqual(baseUrlFor(''), '', 'an empty E2E_BASE_URL is being used as the baseURL');
  assert.equal(baseUrlFor(''), LOCAL);
});

test('B3. whitespace-only must not suppress webServer - worse than the empty case', () => {
  /* `'   '` was truthy before the guard, so it set IS_REMOTE and skipped the build
     entirely: nothing built AND the target whitespace. A stray space in a free-text
     dispatch field is all it takes. */
  assert.equal(buildsLocally('   '), true, 'whitespace-only suppressed the local build');
  assert.equal(baseUrlFor('   '), LOCAL);
});

test('B4. a real url is honoured, with or without a trailing slash', () => {
  const HOST = 'https://liquidity-hq-qa.onrender.com';
  for (const raw of [HOST, `${HOST}/`, `  ${HOST}  `, `  ${HOST}/  `]) {
    assert.equal(resolveBaseUrl(raw), HOST, `${JSON.stringify(raw)} should normalise to ${HOST}`);
    assert.equal(buildsLocally(raw), false, `${JSON.stringify(raw)} should suppress webServer`);
  }
  /* Only the TRAILING slash goes. A path must survive, or a suite pointed at a
     sub-path silently tests the root. */
  assert.equal(resolveBaseUrl('https://example.com/base/'), 'https://example.com/base');
});

test('B5. CONTROL: the config actually uses the resolver, not its own inline copy', () => {
  /* Without this, the four tests above could pass against a helper nothing calls -
     the shape of failure that makes a green suite meaningless. Asserted on the source
     because the alternative is importing playwright.config.ts, which executes
     defineConfig and reads the live environment. */
  const cfg = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  const code = cfg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(code, /import\s*\{\s*resolveBaseUrl\s*\}\s*from\s*['"]\.\/qa\/baseUrl['"]/,
    'playwright.config.ts does not import resolveBaseUrl');
  assert.match(code, /resolveBaseUrl\(\s*process\.env\.E2E_BASE_URL\s*\)/,
    'playwright.config.ts does not pass E2E_BASE_URL through resolveBaseUrl');
  assert.doesNotMatch(code, /process\.env\.E2E_BASE_URL\s*\?\./,
    'playwright.config.ts still reads E2E_BASE_URL with ?. - the empty string slips through that');
});
