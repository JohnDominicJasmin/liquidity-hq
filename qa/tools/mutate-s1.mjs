/* Mutations for the dated-cancellable cases in __tests__/cancelSubscription.test.mts (S1). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const F = 'lib/subscriptionPanel.ts';
const TEST = '__tests__/cancelSubscription.test.mts';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const M = [
  { name: 'S-a the date is dropped (old shape)', from: "return { kind: 'cancellable', untilDate: futureDateOrNull(sub.currentPeriodEnd, nowMs) };", to: "return { kind: 'cancellable' };", red: ['S1.'] },
  { name: 'S-b the raw date is passed through (no future-only rule)', from: "return { kind: 'cancellable', untilDate: futureDateOrNull(sub.currentPeriodEnd, nowMs) };", to: "return { kind: 'cancellable', untilDate: sub.currentPeriodEnd };", red: ['S1.'] },
  { name: 'S-c the date is hard-coded null', from: "return { kind: 'cancellable', untilDate: futureDateOrNull(sub.currentPeriodEnd, nowMs) };", to: "return { kind: 'cancellable', untilDate: null };", red: ['S1.'] },
  { name: 'S-d the active (no-API-key) view also carries a date', from: "  return { kind: 'active' };", to: "  return { kind: 'active', untilDate: futureDateOrNull(sub.currentPeriodEnd, nowMs) } as never;", red: ['S1.'] },
];
const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', F], { windowsHide: true });
const run = () => {
  let out = '', code = 0;
  try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 }); }
  catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  const failed = [...new Set([...out.matchAll(/^\u2716 (.+?) \(/gm)].map((x) => x[1].split(' ')[0]))].filter((k) => !k.includes('__tests__') && k !== 'failing');
  return { code, failed };
};
revert();
const base = run();
console.log(`BASELINE exit ${base.code} red: ${base.failed.join(', ') || '(none)'}`);
if (base.code !== 0) process.exit(2);
let all = true;
for (const m of M) {
  const src = readFileSync(`${ROOT}/${F}`, 'utf8').split(CR + LF).join(LF);
  const n = src.split(m.from).length - 1;
  if (n !== 1) { console.log(`SKIP ${m.name}: anchor x${n}`); all = false; continue; }
  writeFileSync(`${ROOT}/${F}`, src.replace(m.from, () => m.to));
  const r = run();
  revert();
  const good = r.code !== 0 && m.red.every((k) => r.failed.includes(k));
  if (!good) all = false;
  console.log(`${good ? 'OK   ' : 'WRONG'} ${m.name}\n       red: ${r.failed.length} test(s) ${r.failed.slice(0, 3).join(', ')}`);
}
revert();
console.log(all ? 'All mutations behaved as designed.' : 'A MUTATION DID NOT BEHAVE AS DESIGNED.');
