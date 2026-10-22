/* Mutation check for the first part of __tests__/aiSpendCap.test.mts (constants, UTC windows, owner copy, migration). */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const CAP = 'lib/aiSpendCap.ts';
const JSONF = 'lib/labelDefaults.en.json';
const KEYS = 'lib/labelKeys.ts';
const MIG = 'supabase/migrations/20260927a_labels_ai_spend_caps.sql';
const TEST = '__tests__/aiSpendCap.test.mts';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  { name: 'K1 Pro daily cap changed', f: CAP, from: 'export const PRO_DAILY_CAP_USD    = 1.00;', to: 'export const PRO_DAILY_CAP_USD    = 1.50;', red: ['C1.'] },
  { name: 'K2 Pro monthly cap changed', f: CAP, from: 'export const PRO_MONTHLY_CAP_USD   = 10.00;', to: 'export const PRO_MONTHLY_CAP_USD   = 12.00;', red: ['C1.'] },
  { name: 'K3 free daily cap changed', f: CAP, from: 'export const FREE_DAILY_CAP_USD    = 0.15;', to: 'export const FREE_DAILY_CAP_USD    = 0.25;', red: ['C1.'] },
  { name: 'K4 site fuse changed', f: CAP, from: 'export const SITE_FUSE_DAILY_USD   = 10.00;', to: 'export const SITE_FUSE_DAILY_USD   = 20.00;', red: ['C1.'] },
  { name: 'K5 a Pro day is allowed to exceed the Pro month', f: CAP, from: 'export const PRO_DAILY_CAP_USD    = 1.00;', to: 'export const PRO_DAILY_CAP_USD    = 11.00;', red: ['C1.', 'C2.'] },
  { name: 'D1 the day window starts one millisecond late', f: CAP, from: "+ 'T00:00:00.000Z';", to: "+ 'T00:00:00.001Z';", red: ['W1.', 'W4.'] },   // W3 only compares month start with day start, which a 1 ms shift keeps ordered
  { name: 'D2 the month is off by one', f: CAP, from: 'String(d.getUTCMonth() + 1)', to: 'String(d.getUTCMonth())', red: ['W2.', 'W3.'] },
  { name: 'D3 the month loses its leading zero', f: CAP, from: ".padStart(2, '0')", to: '', red: ['W2.'] },
  { name: 'D4 the year is read in local time', f: CAP, from: 'd.getUTCFullYear()', to: 'd.getFullYear()', red: ['W2.'] },
  { name: 'D5 the day is read in local time', f: CAP, from: 'new Date(nowMs).toISOString().slice(0, 10)', to: 'new Date(nowMs + 8 * 3600_000).toISOString().slice(0, 10)', red: ['W1.', 'W4.'] },
  { name: 'R1 pro_daily and pro_monthly swap keys', f: CAP, from: "case 'pro_daily':   return 'AI_CAP_PRO_DAILY';", to: "case 'pro_daily':   return 'AI_CAP_PRO_MONTHLY';", red: ['L1.', 'L2.', 'L4.'] },
  { name: 'R2 the fuse shows the free-daily message', f: CAP, from: "case 'fuse':        return 'AI_CAP_FUSE';", to: "case 'fuse':        return 'AI_CAP_FREE_DAILY';", red: ['L1.', 'L2.', 'L4.'] },
  { name: 'T1 the Pro daily message tells a Pro user to upgrade', f: JSONF, from: 'You\'ve reached today\'s AI limit. It resets at midnight UTC.', to: 'You\'ve reached today\'s AI limit. Upgrade to Pro for more.', red: ['L4.', 'L7.'] },
  { name: 'T2 a message prints a dollar amount', f: JSONF, from: 'It resets on the 1st.', to: 'It resets on the 1st. Your $10 is used.', red: ['L5.', 'L7.'] },
  { name: 'T3 the fuse message is emptied', f: JSONF, from: 'AI is paused for free accounts today. Please try again tomorrow, or upgrade to Pro.', to: '', red: ['L3.', 'L4.', 'L7.'] },
  { name: 'T4 a key is dropped from the label registry', f: KEYS, from: "'AI_CAP_FUSE'", to: "'AI_CAP_FUSE_GONE'", red: ['L6.'] },
  { name: 'T5 the migration drifts from the defaults', f: MIG, from: "\n('AI_CAP_FUSE','en','AI is paused for free accounts today.", to: "\n('AI_CAP_FUSE','en','AI is paused today.", red: ['L7.'] },
];

const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', CAP, JSONF, KEYS, MIG], { windowsHide: true });
const keyOf = (n) => n.split(' ')[0];
const run = () => {
  let out = '', code = 0;
  try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 }); }
  catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  const failed = [...new Set([...out.matchAll(/^\u2716 (.+?) \(/gm)].map((x) => keyOf(x[1])))].filter((k) => !k.includes('__tests__') && k !== 'failing');
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
  writeFileSync(`${ROOT}/${m.f}`, src.replace(m.from, () => m.to));
  const r = run();
  revert();
  const missing = m.red.filter((k) => !r.failed.includes(k));
  const good = r.code !== 0 && missing.length === 0;
  if (!good) all = false;
  console.log(`${good ? 'OK    ' : 'WRONG '}  ${m.name}\n        want red: ${m.red.join(', ')} | actually red: ${r.failed.join(', ') || '(none - suite stayed GREEN)'}${missing.length ? ` | NOT CAUGHT: ${missing.join(', ')}` : ''}`);
}
revert();
console.log(all ? '\nAll mutations behaved as designed.' : '\nA MUTATION DID NOT BEHAVE AS DESIGNED.');
