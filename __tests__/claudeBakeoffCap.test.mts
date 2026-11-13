/* #2235 cell 7 (unit): the quick-read bake-off harness cannot spend past its cap, and its public log carries fixed words and numbers only.
 * scripts/bakeoff/quick/run.mjs is run as a CHILD PROCESS with qa/bakeoff-standin.mjs preloaded (Anthropic and xAI answered from memory, nothing billed,
 * nothing leaves the machine) and the keys set to obvious fakes. Two runs: success (the cap must stop it) and every-call-fails with a planted sentinel in
 * the error body (a failed call must be charged its worst case and its text must not reach the log). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const SENTINEL = 'QA-SENTINEL-ERRTEXT-9918';
const run = (mode: 'ok' | 'fail') => spawnSync(process.execPath, ['--import', './qa/alias-register.mjs', '--import', './qa/bakeoff-standin.mjs', 'scripts/bakeoff/quick/run.mjs'], {
  encoding: 'utf8', timeout: 240_000,
  env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-qa-standin-not-a-key', GROK_API_KEY: 'qa-standin-not-a-key', BAKEOFF_CAP_USD: '0.05', BAKEOFF_GROK_CAP_USD: '0.01',
    BAKEOFF_ENGINES: 'claude-haiku-5-5,grok-4.3', BAKEOFF_INPUTS: '8', BAKEOFF_RUNS: '2', BAKEOFF_SEQUENTIAL: '1', QA_STANDIN_MODE: mode, QA_STANDIN_SENTINEL: SENTINEL },
});
const num = (out: string, key: string) => { const m = out.match(new RegExp(key + '=\s*([0-9.eE+-]+)')); return m ? Number(m[1]) : NaN; };
const FIXED = /^[A-Za-z_=0-9.$%: ()/<>-]+$/;

test('H1. with a $0.05 cap the run stops at the cap and the spend never exceeds it', () => {
  const r = run('ok');
  assert.equal(r.status, 0, 'the harness exited ' + r.status + ' stderr tail: ' + String(r.stderr).slice(-300));
  const out = String(r.stdout);
  assert.match(out, /STOPPED_AT_CAP/, 'it did not stop at the cap: ' + out.slice(-400));
  const spent = num(out, 'SPENT_CLAUDE_USD'); assert.ok(Number.isFinite(spent), 'no SPENT_CLAUDE_USD line');
  assert.ok(spent <= 0.05 + 1e-9, 'Claude spend ' + spent + ' passed the $0.05 cap');
  const grok = num(out, 'SPENT_GROK_USD'); assert.ok(grok <= 0.01 + 1e-9, 'Grok spend ' + grok + ' passed its $0.01 cap');
  assert.ok(/claude-haiku-5-5 calls= [1-9]/.test(out), 'the control failed: not one Claude call completed, so the cap was never exercised: ' + out.slice(0, 400));
});

test('H2. every line of the public log is fixed words and numbers (no free text)', () => {
  const r = run('ok');
  const lines = String(r.stdout).split('\n').filter(Boolean);
  assert.ok(lines.length > 3, 'no output');
  const bad = lines.filter(l => !FIXED.test(l));
  assert.deepEqual(bad, [], 'lines with characters outside the allowed set: ' + JSON.stringify(bad.slice(0, 3)));
});

test('H3. when EVERY call fails with a planted sentinel in the error, the sentinel is never printed and a failed call is charged its worst case (the cap still holds)', () => {
  const r = run('fail');
  const all = String(r.stdout) + '\n' + String(r.stderr);
  assert.equal(all.includes(SENTINEL), false, 'error text from the vendor reached the log');
  const out = String(r.stdout);
  assert.ok(out.split('\n').filter(Boolean).every(l => FIXED.test(l)), 'a line left the fixed-words set on the failure path');
  assert.match(out, /failed HTTP_500/, 'failures were not counted by class: ' + out.slice(-300));
  const spent = num(out, 'SPENT_CLAUDE_USD'); assert.ok(spent > 0, 'a failed call was charged nothing (it must be charged its worst case): ' + spent);
  assert.ok(spent <= 0.05 + 1e-9, 'failed calls pushed spend past the cap: ' + spent);
  assert.match(out, /STOPPED_AT_CAP/);
});
