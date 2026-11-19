import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2605: the 20 x 8 x 16 strategy audit is a MANUAL, READ-ONLY, FREE job. Rules as literals (OWNER-RULES section 17: a 20-job matrix must never fire on every push; section 14: the repo is public, so nothing secret):
 *   W1 triggers: ONLY pull_request types [labeled] and workflow_dispatch: no push, no schedule, no other pull_request type (an open, a sync or a reopen must start nothing)
 *   W2 every job is gated on the label name run-strategy-audit (or a dispatch), including the merge job
 *   W3 least privilege: permissions contents read only, no secret anywhere, no write token, no issue / PR / deploy step
 *   W4 no workflow input is interpolated into a shell command (inputs reach the script through env), the matrix is constants
 *   W5 the script reads ONLY the public Binance archive, reads no environment and writes only under the --out directory */
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const wf = read('.github/workflows/strategy-audit.yml'), script = read('scripts/strategy-audit-matrix.mts');
const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('W1. CONTROL + triggers: only a label on a pull request, or a manual dispatch', () => {
  assert.ok(/^on:\n/m.test(code), 'CONTROL: no on: block found');
  const on = code.slice(code.indexOf('on:'), code.indexOf('permissions:'));
  assert.ok(/pull_request:\n\s+types: \[labeled\]/.test(on), 'pull_request must be limited to types [labeled]');
  assert.ok(/workflow_dispatch:/.test(on)); for (const bad of ['push:', 'schedule:', 'pull_request_target', 'workflow_run', 'release:', 'issue_comment']) assert.equal(on.includes(bad), false, `a trigger "${bad}" would run the matrix on something other than a label or a dispatch`);
  assert.equal((on.match(/types:/g) ?? []).length, 1, 'exactly one types: list (pull_request)');
});
test('W2. every job is gated on the run-strategy-audit label or a dispatch', () => {
  const jobs = [...code.matchAll(/^  ([a-z][a-z-]*):\n((?:    .*\n|\n)+)/gm)]; assert.ok(jobs.length >= 2, `CONTROL: parsed ${jobs.length} jobs`);
  for (const [, name, body] of jobs) assert.ok(/\n    if: .*github\.event\.label\.name == 'run-strategy-audit'/.test('\n' + body) && /github\.event_name == 'workflow_dispatch'/.test(body), `job "${name}" is not gated on the label / dispatch`);
});
test('W3. least privilege: contents read only, no secret, no write step', () => {
  assert.ok(/^permissions:\n  contents: read\n/m.test(code), 'permissions must be exactly contents: read at the top');
  assert.equal(/^\s+[a-z-]+: write/m.test(code), false, 'a write permission');
  assert.equal(/secrets\.|GITHUB_TOKEN|gh (pr|issue|release|workflow)|git push|render|supabase/i.test(code), false, 'a secret, a token, or a service write is referenced');
});
test('W4. no input is interpolated into a shell line; the matrix is a constant list', () => {
  const runs = (() => {
    const ls = code.split('\n'); const out: string[] = [];
    for (let k = 0; k < ls.length; k++) {
      const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(ls[k]); if (!m) continue;
      const ind = m[1].length + (ls[k].trimStart().startsWith('- ') ? 2 : 0); out.push(m[2]);
      for (let j = k + 1; j < ls.length && (ls[j].trim() === '' || ls[j].search(/\S/) > ind); j++) out.push(ls[j]);
    }
    return out.join('\n');
  })();
  assert.ok(runs.length > 100, `CONTROL: only ${runs.length} chars of run: blocks were found`);
  assert.equal(/\$\{\{\s*(github\.event\.inputs|inputs)\./.test(runs), false, 'an input is interpolated into a run: block (shell injection)');
  assert.ok(/DAYS: \$\{\{ github\.event\.inputs\.days/.test(code) && /TFS: \$\{\{ github\.event\.inputs\.tfs/.test(code), 'CONTROL: the inputs no longer arrive through env');
  const m = /coin: \[([^\]]+)\]/.exec(code); assert.ok(m, 'CONTROL: no coin matrix'); assert.ok(/^[a-z0-9, ]+$/.test(m![1]), 'the matrix must be plain constants'); assert.equal(m![1].split(',').length, 20, 'twenty coins');
});
test('W5. the script reads only the public Binance archive, no environment, writes only under --out', () => {
  const hosts = new Set([...script.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((x) => x[1].toLowerCase())); const bad = [...hosts].filter((h) => h !== 'data.binance.vision');
  assert.deepEqual(bad.filter((h) => !/^(www\.)?github\.com$/.test(h)), [], `the script names a host other than data.binance.vision: ${bad.join(', ')}`);
  assert.equal(/process\.env/.test(script), false, 'the script reads the environment');
  for (const m of script.matchAll(/(?:writeFileSync|mkdirSync)\(([^,)]+)/g)) assert.ok(/out|dir/.test(m[1]), `a write outside the output directory: ${m[0]}`);
  assert.equal(/child_process|\bexec(Sync)?\(|\bspawn/.test(script), false, 'the script runs a process');
});
