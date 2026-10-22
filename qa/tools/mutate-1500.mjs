// Mutation check for __tests__/priceAlertsListPaging.test.mts. Run from the worktree root.
// Each mutation edits app/api/price-alerts/route.ts, runs the test file, lists the failing tests,
// then restores the file with git checkout. Exact-string replacements only.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const ROUTE = 'app/api/price-alerts/route.ts';
const original = readFileSync(ROUTE, 'utf8');

const EOL = original.includes('\r\n') ? '\r\n' : '\n';
function replaceOnce(src, from, to) {
  from = from.split('\n').join(EOL);
  to = to.split('\n').join(EOL);
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`expected exactly one match for ${JSON.stringify(from)}, found ${n}`);
  return src.replace(from, () => to);
}

const mutations = {
  a_pre_fix_limit_100: () => execFileSync('git', ['show', 'f3569b55^:' + ROUTE], { encoding: 'utf8' }),
  b_drop_active_filter: () => replaceOnce(original, "      .eq('active', true)\n", ''),
  c_continue_on_error: () => replaceOnce(original, "    if (error) return apiError('price-alerts', error);\n    alerts.push", '    if (error) continue;\n    alerts.push'),
  d_page_500: () => replaceOnce(original, 'const PAGE = 1000;', 'const PAGE = 500;'),
};

const only = process.argv[2];
for (const [name, make] of Object.entries(mutations)) {
  if (only && name !== only) continue;
  const mutated = make();
  if (mutated === original) throw new Error(`${name}: mutation changed nothing`);
  writeFileSync(ROUTE, mutated);
  const r = spawnSync(process.execPath, ['--import', './qa/alias-register.mjs', '--test', '__tests__/priceAlertsListPaging.test.mts'], { encoding: 'utf8' });
  execFileSync('git', ['checkout', '--', ROUTE]);
  const out = r.stdout + r.stderr;
  const failed = out.split('\n').filter((l) => /^✖ /.test(l) && !l.startsWith('✖ failing tests')).map((l) => l.replace(/ \(\d+(\.\d+)?ms\)$/, '').slice(0, 90));
  const summary = out.split('\n').filter((l) => /^ℹ (pass|fail|todo) /.test(l)).join(' | ');
  console.log(`\n=== ${name} === exit ${r.status} :: ${summary}`);
  for (const f of [...new Set(failed)]) console.log('  RED ' + f);
}
const after = readFileSync(ROUTE, 'utf8');
console.log(after === original ? '\nroute.ts restored (byte-identical)' : '\nWARNING: route.ts differs from original');
