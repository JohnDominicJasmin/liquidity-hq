/* Mutation check for __tests__/resolveAlertOutcomes.test.mts.
 * A suite green on its first run is unproven. Each mutation is reverted with git. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const R = `${ROOT}/app/api/alert-outcomes/resolve/route.ts`;

const M = [
  ['M1 drop the read-error handling (the original defect)', R,
   'if (readError) {', 'if (false) {', ['1.', '1b']],

  ['M2 THE TRAP: treat an empty read as an error', R,
   'if (updates.length === 0) return { resolved: 0 };',
   "if (updates.length === 0) return { resolved: 0, error: `${hours}h: nothing to resolve` };", ['2.']],

  ['M3 remove the no-prices guard', R,
   'if (Object.keys(prices).length === 0) {', 'if (false) {', ['5b']],

  ['M4 swallow the RPC error', R,
   'if (error) {\n    console.error(`[alert-outcomes/resolve] ${hours}h batch update failed',
   'if (false) {\n    console.error(`[alert-outcomes/resolve] ${hours}h batch update failed', ['5.']],

  ['M5 collect only the 48h error', R,
   'const errors = [w24.error, w48.error]', 'const errors = [w48.error]', ['3.']],

  ['M6 drop rows whose percentage is not finite', R,
   'updates.push({ id: row.id, price: current, pct: outcomePct(row.dir, row.price_at_fire, current) });',
   '{ const p = outcomePct(row.dir, row.price_at_fire, current); if (Number.isFinite(p)) updates.push({ id: row.id, price: current, pct: p }); }',
   ['4.']],

  ['M7 errors no longer map to 500', R,
   '{ status: errors.length ? 500 : 200 },', '{ status: 200 },', ['the route maps']],
];

const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', 'app/api/alert-outcomes/resolve/route.ts'], { windowsHide: true });

let all = true;
for (const [name, file, from, to, expect] of M) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes(from)) { console.log(`SKIP    ${name} - anchor not found`); all = false; continue; }
  writeFileSync(file, src.replace(from, to));
  let out = '', code = 0;
  try {
    out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', '__tests__/resolveAlertOutcomes.test.mts'],
      { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  } catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  revert();
  const failed = [...out.matchAll(/^✖ (.+?) \(/gm)].map(m => m[1]);
  const caught = expect.filter(p => failed.some(f => f.startsWith(p)));
  const ok = code !== 0 && caught.length === expect.length;
  if (!ok) all = false;
  console.log(`${ok ? 'CAUGHT' : 'MISSED'}  ${name}\n        want ${expect.join(', ')} | red: ${failed.length ? [...new Set(failed.map(f => f.split(' ')[0]))].join(', ') : '(none - stayed GREEN)'}`);
}
console.log(all ? '\nAll mutations caught.' : '\nA MUTATION SURVIVED.');
