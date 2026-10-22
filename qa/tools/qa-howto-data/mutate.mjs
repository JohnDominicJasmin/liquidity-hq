/* Mutation controls for the QA how-to-test unit runs. Each mutation is applied in the worktree, the
 * named test file is run, and the file is restored with git checkout. A mutation must turn named tests red.
 * usage: node mutate.mjs <worktree> <out.json> */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
const [WT, OUT] = process.argv.slice(2);
const sh = (c) => execSync(c, { cwd: WT, encoding: 'utf8', maxBuffer: 64 << 20 });
const MUT = [
  { id: '1523-bound', pr: 1523, file: 'lib/selectAllRows.ts', from: 'const readTo = maxRows + 1;', to: 'const readTo = maxRows;', test: '__tests__/qaSelectAllRows.test.mts' },
  { id: '1523-standin-key', pr: 1523, file: 'app/api/market/klines/route.ts', from: '${interval}:${limit}${closedTag}`;\n          const fallbackFetch', to: '${interval}:${limit}`;\n          const fallbackFetch', test: '__tests__/qaKlinesHold.test.mts' },
  { id: '1515-no-hold', pr: 1515, file: 'app/api/market/klines/route.ts', all: [[', { failTtlMs: KLINES_FAIL_TTL_MS })', ')'], [',\n            { failTtlMs: KLINES_FAIL_TTL_MS })', ')']], test: '__tests__/qaKlinesHold.test.mts' },
  { id: '1514-one-page', pr: 1514, file: 'lib/selectAllRows.ts', from: 'if (page.length < to - from + 1) break;', to: 'break;', test: '__tests__/qaSelectAllRows.test.mts' },
  { id: '1514-route-before', pr: 1514, file: 'app/api/macro-alert/route.ts', gitFrom: '75bc189b~1', test: '__tests__/qaSelectAllRows.test.mts' },
  { id: '1522-route-before', pr: 1522, file: 'app/api/ops/ai-cost/route.ts', gitFrom: 'fdc35d5e~1', test: '__tests__/qaAiCostPaging.test.mts' },
];
const res = [];
for (const m of MUT) {
  const p = `${WT}/${m.file}`;
  const orig = readFileSync(p, 'utf8');
  const eol = orig.includes('\r\n') ? '\r\n' : '\n';
  let next;
  if (m.gitFrom) next = sh(`git show ${m.gitFrom}:${m.file}`);
  else {
    next = orig.split(eol).join('\n');
    for (const [a, b] of m.all ?? [[m.from, m.to]]) {
      if (!next.includes(a)) { res.push({ id: m.id, error: `pattern not found: ${a}` }); next = null; break; }
      next = next.split(a).join(b);
    }
    if (next) next = next.split('\n').join(eol);
  }
  if (!next) continue;
  writeFileSync(p, next);
  const r = spawnSync(process.execPath, ['--import', './qa/alias-register.mjs', '--test', m.test], { cwd: WT, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 240_000 });
  sh(`git checkout -- "${m.file}"`);
  const txt = (r.stdout || '') + (r.stderr || '');
  const failed = [...txt.matchAll(/^✖ (.+?) \(\d/gm)].map((x) => x[1]);
  const pass = Number(/ℹ pass (\d+)/.exec(txt)?.[1]), fail = Number(/ℹ fail (\d+)/.exec(txt)?.[1]);
  res.push({ id: m.id, pr: m.pr, test: m.test, pass, fail, failed: [...new Set(failed)] });
  console.log(JSON.stringify(res.at(-1)));
}
const clean = sh('git status --porcelain --untracked-files=no').trim();
res.push({ worktreeCleanAfter: clean === '', status: clean });
console.log(JSON.stringify(res.at(-1)));
writeFileSync(OUT, JSON.stringify(res, null, 1));
