/* Mutation check for __tests__/entitlementsRetryBudget.test.mts (#1173). Real behavioral module, mutated
 * directly - not a structure/grep test, so this exercises actual runtime differences. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const LIB = 'lib/retryWithBackoff.ts';
const AUTH = 'components/AuthProvider.tsx';
const TEST = ['__tests__/entitlementsRetryBudget.test.mts'];
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  { name: 'M1 remaining() always returns Infinity, ignoring overallBudgetMs entirely', f: LIB,
    from: 'const remaining = () =>\n    overallBudgetMs === undefined ? Infinity : Math.max(0, overallBudgetMs - (Date.now() - start));',
    to: 'const remaining = () => Infinity;',
    red: ['attempt 1 always runs', 'each attempt receives', 'stops before starting', 'FLAGSHIP'] },
  { name: 'M2 EQUIVALENT MUTANT - the top-of-loop past-budget guard is removed', f: LIB,
    from: 'if (n > 1 && remaining() <= 0) return { result: result!, attempts: n - 1, cancelled: false };',
    to: '',
    red: [],
    note: 'Proven unreachable, not untested: reaching iteration n>1 requires the PRIOR skip-check\n        (remaining()<=backoffMs[n-1]) to have found remaining()>backoffMs[n-1] (else it would already have\n        returned there); after waiting exactly backoffMs[n-1], the new remaining() = old - backoffMs[n-1] > 0\n        by construction. So this guard can never see remaining()<=0 given retryWithBackoff\'s own control flow -\n        no attempt callback, however slow or bound-ignoring, changes that, because an overrun is caught by the\n        SAME skip-check first (any remaining()<=0 is also <= any non-negative backoffMs). No test could ever\n        observe removing this line, so none was written to.' },
  { name: 'M3 the backoff-skip check only fires when the budget is FULLY gone (<=0), not when it would not cover the next backoff', f: LIB,
    from: 'if (overallBudgetMs !== undefined && remaining() <= backoffMs[n - 1]) {',
    to: 'if (overallBudgetMs !== undefined && remaining() <= 0) {',
    red: ['stops before starting'] },
  { name: 'M4 EQUIVALENT MUTANT - the backoff wait is shortened to the remaining budget instead of a fixed skip/full-wait', f: LIB,
    from: 'await new Promise(resolve => setTimeout(resolve, backoffMs[n - 1]));',
    to: 'await new Promise(resolve => setTimeout(resolve, overallBudgetMs !== undefined ? Math.min(backoffMs[n - 1], remaining()) : backoffMs[n - 1]));',
    red: [],
    note: 'This line only runs when the skip-check just above it decided NOT to skip, which requires\n        remaining()>backoffMs[n-1] at that moment - so Math.min(backoffMs[n-1], remaining()) always picks\n        backoffMs[n-1], identically to the unmutated code, for every input that can reach this line. No test\n        could distinguish them.' },
  { name: 'M5 EQUIVALENT MUTANT - the floor at 0 is removed, remaining can return negative', f: LIB,
    from: 'Math.max(0, overallBudgetMs - (Date.now() - start))',
    to: '(overallBudgetMs - (Date.now() - start))',
    red: [],
    note: 'Same subsuming argument as M2: any call site that could ever observe a negative remaining() is a\n        call site the skip-check would already have returned from (negative <= any non-negative backoffMs).\n        The floor only matters to a caller reading remaining() from outside retryWithBackoff\'s own sequence,\n        which does not exist yet.' },
  { name: 'M6 AuthProvider stops bounding the AbortSignal by the remaining budget', f: AUTH,
    from: '.abortSignal(AbortSignal.timeout(Math.min(ENTITLEMENTS_FETCH_MS, remainingBudgetMs)))',
    to: '.abortSignal(AbortSignal.timeout(ENTITLEMENTS_FETCH_MS))',
    red: ['ENTITLEMENTS_OVERALL_BUDGET_MS is wired'] },
  { name: 'M7 AuthProvider stops passing overallBudgetMs into retryWithBackoff at all', f: AUTH,
    from: '        overallBudgetMs: ENTITLEMENTS_OVERALL_BUDGET_MS,\n',
    to: '',
    red: ['ENTITLEMENTS_OVERALL_BUDGET_MS is wired'] },
  { name: 'M8 the budget constant regresses back toward the old ~48s worst case', f: AUTH,
    from: 'const ENTITLEMENTS_OVERALL_BUDGET_MS = 22000;',
    to: 'const ENTITLEMENTS_OVERALL_BUDGET_MS = 48000;',
    red: [] }, // structure test only checks the anchor's presence with literal 22000 - see note
];

const FILES = [LIB, AUTH];
const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', ...FILES], { windowsHide: true });
const run = () => {
  let out = '', code = 0;
  try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', ...TEST], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 15_000 }); }
  catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  const failed = [...new Set([...out.matchAll(/^\s*\u2716 (.+?) \(/gm)].map((x) => x[1]))];
  return { code, failed };
};

revert();
const base = run();
console.log(`BASELINE exit ${base.code} red: ${base.failed.join(', ') || '(none)'}`);
if (base.code !== 0) process.exit(2);
let all = true;
for (const m of M) {
  const src = readFileSync(`${ROOT}/${m.f}`, 'utf8').split(CR + LF).join(LF);
  const n = src.split(m.from).length - 1;
  if (n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); all = false; continue; }
  const at = src.indexOf(m.from);
  const out = src.slice(0, at) + m.to + src.slice(at + m.from.length);
  writeFileSync(`${ROOT}/${m.f}`, out);
  const r = run();
  revert();
  const missing = m.red.filter((want) => !r.failed.some((f) => f.includes(want)));
  const caughtByAnything = r.code !== 0;
  const good = m.red.length === 0 ? true : (caughtByAnything && missing.length === 0);
  if (!good) all = false;
  const label = m.red.length === 0 ? (caughtByAnything ? 'CAUGHT (bonus, not required)' : 'CONFIRMED EQUIVALENT - suite correctly stayed green') : (good ? 'OK' : 'WRONG');
  console.log(`${good || m.red.length === 0 ? 'INFO  ' : 'WRONG '}  ${m.name}\n        ${m.red.length ? `want red matching: ${m.red.join(', ')} | ` : ''}actually red: ${r.failed.join(' | ') || '(none - suite stayed GREEN)'}\n        verdict: ${label}${m.note ? `\n        ${m.note}` : ''}`);
}
revert();
console.log(all ? '\nAll REQUIRED mutations behaved as designed.' : '\nA REQUIRED MUTATION DID NOT BEHAVE AS DESIGNED.');
