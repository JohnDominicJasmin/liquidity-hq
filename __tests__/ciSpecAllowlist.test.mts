/* The `spec` dispatch input in ci.yml is an INJECTION BOUNDARY on a public repo: its value reaches a
 * shell on the runner. The defence is a `case` allowlist that rejects any character outside a small
 * set, and the value is then passed to Playwright quoted.
 *
 * WHAT THIS PINS: the REAL pattern, extracted from ci.yml and run through bash, rejects `;`, `$(`,
 * `&`, a backtick, a space, a quote and a newline, and accepts the shapes people actually dispatch
 * (a file path, a --grep=, and a `|` regex naming several specs).
 *
 * WHY THE `|` CASE IS THE ONE THAT MATTERS: in a bash `case` pattern an UNESCAPED `|` is the
 * alternation separator even inside a bracket expression, so `*[!a-z|-]*)` becomes two patterns and
 * the allowlist silently accepts EVERYTHING (measured 2026-11-12: `a;rm -rf x` and `$(id)` both
 * passed). The CONTROL below builds exactly that broken variant and asserts it does accept an
 * injection - so this test is shown able to go red, and a regression to the unescaped form fails the
 * extraction check as well.
 *
 * WHAT IT CANNOT PROVE: the rest of the step (that the value is quoted when handed to Playwright) is
 * asserted by a source pin, not by running Playwright. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CI = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').split(/\r?\n/).join('\n');

/** The `case "$QA_SPEC" in ... esac` block of the Run E2E step, with the error/exit replaced by a marker. */
function extractCase(): string {
  const m = CI.match(/case "\$QA_SPEC" in[\s\S]*?esac/);
  assert.ok(m, 'could not find the QA_SPEC case block in ci.yml - the allowlist moved or was removed');
  return m![0].replace(/echo "::error::[^\n]*"/, 'echo REJECT').replace(/exit 1 ;;/, ';;');
}

function verdict(caseBlock: string, value: string): 'accepted' | 'REJECT' {
  const r = spawnSync('bash', ['-c', caseBlock], { env: { ...process.env, QA_SPEC: value }, encoding: 'utf8' });
  assert.equal(r.error, undefined, `bash did not run: ${String(r.error)}`);
  return r.stdout.includes('REJECT') ? 'REJECT' : 'accepted';
}

const REJECT = [';rm -rf x', 'a;b', '$(id)', 'a$(id)', '`id`', 'a`id`', 'a&b', 'a&&b', 'a b', 'a\tb', "a'b", 'a"b', 'a\nb', 'a>b', 'a<b', 'a*b', 'a\\b'];
const ACCEPT = ['qa/e2e/onboarding.spec.ts', '--grep=Onboarding', 'qa/e2e/reconnect-|qa/e2e/audit-001|market-scenarios'];

test('A1. every injection shape is rejected by the allowlist as it is written in ci.yml', () => {
  const block = extractCase();
  for (const v of REJECT) assert.equal(verdict(block, v), 'REJECT', `allowlist ACCEPTED ${JSON.stringify(v)}`);
});

test('A2. the shapes people really dispatch are accepted, including a | regex of several specs', () => {
  const block = extractCase();
  for (const v of ACCEPT) assert.equal(verdict(block, v), 'accepted', `allowlist REJECTED ${JSON.stringify(v)}`);
});

test('A3. CONTROL: the UNESCAPED | form accepts an injection, so A1 is able to fail', () => {
  const broken = extractCase().replace('=\\|-]', '=|-]');
  assert.notEqual(broken, extractCase(), 'the control did not alter the pattern - the escaped form is no longer in ci.yml');
  assert.equal(verdict(broken, 'a;rm -rf x'), 'accepted', 'the broken variant should accept `a;rm -rf x`; if it does not, this control proves nothing');
});

test('A4. source pin: the value reaches Playwright QUOTED, and via an env var, never interpolated into the command', () => {
  assert.ok(/QA_SPEC: \$\{\{ inputs\.spec \}\}/.test(CI), 'the spec input is no longer passed through the QA_SPEC env var');
  assert.ok(/--trace=off "\$QA_SPEC"/.test(CI), 'the value is no longer handed to Playwright as one quoted argument');
  assert.equal(/run:[^\n]*\$\{\{ inputs\.spec \}\}/.test(CI), false, 'inputs.spec is interpolated directly into a run command');
});
