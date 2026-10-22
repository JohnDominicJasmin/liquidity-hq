/* Mutation check for part 2 of __tests__/aiSpendCap.test.mts: decisions, requests, read-fail, choke point, migration text.
   Every mutation is one defect put back into the code under test; the tests named in `red` must go red. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const CAP = 'lib/aiSpendCap.ts';
const USE = 'lib/aiUsage.ts';
const MIG = 'supabase/migrations/20260927b_ai_spend_sums.sql';
const TEST = '__tests__/aiSpendCap.test.mts';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);

const M = [
  // ── comparison and ordering in spendCapBlock
  { name: 'X1 month cap uses > instead of >=', f: CAP, from: 'firstRow(monthRes.data)) >= PRO_MONTHLY_CAP_USD', to: 'firstRow(monthRes.data)) > PRO_MONTHLY_CAP_USD', red: ['P6.'] },
  { name: 'X2 day cap uses > instead of >=', f: CAP, from: 'firstRow(dayRes.data)) >= PRO_DAILY_CAP_USD', to: 'firstRow(dayRes.data)) > PRO_DAILY_CAP_USD', red: ['P3.', 'P12.'] },
  { name: 'X3 free cap uses > instead of >=', f: CAP, from: 'firstRow(mineRes.data)) >= FREE_DAILY_CAP_USD', to: 'firstRow(mineRes.data)) > FREE_DAILY_CAP_USD', red: ['F3.', 'F3t.', 'F6.'] },
  { name: 'X4 fuse uses > instead of >=', f: CAP, from: 'firstRow(siteRes.data)) >= SITE_FUSE_DAILY_USD', to: 'firstRow(siteRes.data)) > SITE_FUSE_DAILY_USD', red: ['F10.', 'F10t.'] },
  { name: 'X5 the day is checked before the month', f: CAP, apply: (s) => {
      const L = s.split(LF);
      const a = L.findIndex((l) => l.includes('firstRow(monthRes.data)'));
      const b = L.findIndex((l) => l.includes('firstRow(dayRes.data)'));
      if (a < 0 || b !== a + 3) throw new Error('order anchors');
      const month = L.slice(a, a + 3), day = L.slice(b, b + 3);
      L.splice(a, 6, ...day, ...month);
      return L.join(LF);
    }, red: ['P8.'] },
  { name: 'X6 Pro fails CLOSED on a read error', f: CAP, from: '      return { blocked: false };\n    }\n\n    // free / trial: own daily cap, then the whole-site fuse.', to: "      if (monthRes.error || dayRes.error) return { blocked: true, reason: 'free_daily' };\n      return { blocked: false };\n    }\n\n    // free / trial: own daily cap, then the whole-site fuse.", red: ['R1.', 'R2.', 'R3.', 'R4.', 'R5.', 'R13.'] },
  { name: 'X24 the day error blocks the month overage from counting (old throw behaviour, month side)', f: CAP, from: 'if (!monthRes.error && spendSumToUsd(', to: 'if (!dayRes.error && !monthRes.error && spendSumToUsd(', red: ['R10.', 'R12.'] },
  { name: 'X25 the month error blocks the day overage from counting (old throw behaviour, day side)', f: CAP, from: 'if (!dayRes.error && spendSumToUsd(', to: 'if (!monthRes.error && !dayRes.error && spendSumToUsd(', red: ['R11.'] },
  { name: 'X26 a failed month read counts as over the cap', f: CAP, from: 'if (!monthRes.error && spendSumToUsd(firstRow(monthRes.data)) >= PRO_MONTHLY_CAP_USD) {', to: 'if (monthRes.error || spendSumToUsd(firstRow(monthRes.data)) >= PRO_MONTHLY_CAP_USD) {', red: ['R2.', 'R13.'] },
  { name: 'X27 a failed day read counts as over the cap', f: CAP, from: 'if (!dayRes.error && spendSumToUsd(firstRow(dayRes.data)) >= PRO_DAILY_CAP_USD) {', to: 'if (dayRes.error || spendSumToUsd(firstRow(dayRes.data)) >= PRO_DAILY_CAP_USD) {', red: ['R3.', 'R13.'] },
  { name: 'X7 free and trial fail OPEN on a read error', f: CAP, from: "return tier === 'pro' ? { blocked: false } : { blocked: true, reason: 'free_daily' };", to: 'return { blocked: false };', red: ['R6.', 'R6t.', 'R7.', 'R8.', 'R9.'] },
  { name: 'X8 a read error on free is reported with the wrong reason', f: CAP, from: "return tier === 'pro' ? { blocked: false } : { blocked: true, reason: 'free_daily' };", to: "return tier === 'pro' ? { blocked: false } : { blocked: true, reason: 'fuse' };", red: ['R6.', 'R7.', 'R8.', 'R9.'] },
  { name: 'X9 Pro is also stopped by the whole-site fuse', f: CAP, from: '      return { blocked: false };\n    }\n\n    // free / trial: own daily cap, then the whole-site fuse.',
    to: "      const sp = await db.rpc('lhq_ai_spend_all_since', { p_since: dayStart });\n      if (spendSumToUsd(firstRow(sp.data)) >= SITE_FUSE_DAILY_USD) return { blocked: true, reason: 'fuse' };\n      return { blocked: false };\n    }\n\n    // free / trial: own daily cap, then the whole-site fuse.", red: ['Q4.', 'P14.'] },
  { name: 'X10 free never reads the fuse', f: CAP, from: 'if (spendSumToUsd(firstRow(siteRes.data)) >= SITE_FUSE_DAILY_USD) {', to: 'if (false) {', red: ['F10.', 'F12.', 'F14.'] },
  { name: 'X11 free ignores its own cap', f: CAP, from: 'firstRow(mineRes.data)) >= FREE_DAILY_CAP_USD', to: 'firstRow(mineRes.data)) >= 1e9', red: ['F3.', 'F4.', 'F8.'] },
  // ── windows and who is asked about
  { name: 'X12 the month window starts today', f: CAP, from: 'const monthStart = monthStartIsoUtc(nowMs);', to: 'const monthStart = dayStartIsoUtc(nowMs);', red: ['P6.', 'P7.', 'Q1.'] },
  { name: 'X13 the fuse window is the month', f: CAP, from: "db.rpc('lhq_ai_spend_all_since', { p_since: dayStart })", to: "db.rpc('lhq_ai_spend_all_since', { p_since: monthStartIsoUtc(nowMs) })", red: ['F13.', 'Q2.'] },
  { name: 'X14 the month sum is asked for a different account', f: CAP, from: '{ p_user: userId, p_since: monthStart }', to: "{ p_user: userId + 'x', p_since: monthStart }", red: ['Q1.', 'P6.'] },
  { name: 'X15 the own-day sum is asked for a different account', f: CAP, from: "db.rpc('lhq_ai_spend_user_since', { p_user: userId, p_since: dayStart });\n    if (mineRes.error)", to: "db.rpc('lhq_ai_spend_user_since', { p_user: userId + 'x', p_since: dayStart });\n    if (mineRes.error)", red: ['Q2.', 'F3.'] },
  // ── the combiner and the row reader
  { name: 'X16 unmeasured search rows charged the wrong estimate', f: CAP, from: 'num(row.null_search) * NULL_COST_SEARCH_ESTIMATE_USD', to: 'num(row.null_search) * NULL_COST_OTHER_ESTIMATE_USD', red: ['S2.', 'S4.', 'P15.'] },
  { name: 'X17 unmeasured non-search rows are not charged', f: CAP, from: '    + num(row.null_other)  * NULL_COST_OTHER_ESTIMATE_USD;', to: '    + 0;', red: ['S3.', 'S4.', 'P19.'] },
  { name: 'X18 the measured cost is dropped', f: CAP, from: 'return num(row.cost)\n', to: 'return 0\n', red: ['S1.', 'P3.', 'F3.'] },
  { name: 'X19 a string-valued field is not read', f: CAP, from: "const n = typeof v === 'number' ? v : Number(v);", to: "const n = typeof v === 'number' ? v : NaN;", red: ['S5.'] },
  { name: 'X20 the wrong element of the RPC result is read', f: CAP, from: '(data[0] ?? null)', to: '(data[1] ?? null)', red: ['P3.', 'F3.', 'TR1.'] },
  { name: 'X21 the search estimate is changed', f: CAP, from: 'export const NULL_COST_SEARCH_ESTIMATE_USD = 0.0372;', to: 'export const NULL_COST_SEARCH_ESTIMATE_USD = 0.03;', red: ['S7.', 'P15.'] },
  { name: 'X22 the other estimate stops following aiCost.ts', f: CAP, from: 'export const NULL_COST_OTHER_ESTIMATE_USD  = PLAIN_CALL_COST_USD;', to: 'export const NULL_COST_OTHER_ESTIMATE_USD  = 0.01;', red: ['S7.'] },
  { name: 'X23 the JS-sum path comes back (the truncation bug)', f: CAP, apply: () => {
      const old = execFileSync('git', ['-C', ROOT, 'show', 'b1b419ff:lib/aiSpendCap.ts'], { encoding: 'utf8' }).split(CR + LF).join(LF);
      return old + '\nexport function spendSumToUsd(row: { cost?: number | string | null; null_search?: number | string | null; null_other?: number | string | null } | null | undefined): number {\n  if (!row) return 0;\n  const num = (v: unknown): number => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : 0; };\n  return num(row.cost) + num(row.null_search) * NULL_COST_SEARCH_ESTIMATE_USD + num(row.null_other) * NULL_COST_OTHER_ESTIMATE_USD;\n}\n';
    }, red: ['TR1.', 'TR2.', 'Q5.'] },
  // ── the choke point
  { name: 'Y1 the dollar check is skipped', f: USE, from: 'const dollar = await spendCapBlock(tier, userId);', to: 'const dollar = { blocked: false } as { blocked: boolean; reason?: string };', red: ['A1.'] },
  { name: 'Y2 the block reports the wrong reason', f: USE, from: 'return { blocked: true, reason: dollar.reason, limit: 0 };', to: "return { blocked: true, reason: 'user', limit: 0 };", red: ['A1.'] },
  { name: 'Y3 a dollar block does not stop the call (falls through to the reserve)', f: USE, from: 'return { blocked: true, reason: dollar.reason, limit: 0 };', to: 'void 0;', red: ['A1.'] },
  { name: 'Y4 the fuse reason is missing from the message map', f: USE, from: "['pro_daily', 'pro_monthly', 'free_daily', 'fuse'];", to: "['pro_daily', 'pro_monthly', 'free_daily'];", red: ['A6.'] },
  { name: 'Y5 the admin kill switch is removed', f: USE, from: "if (!(await isFeatureEnabled('grok'))) return { blocked: true, reason: 'disabled', limit };", to: '', red: ['A5.'] },
  { name: 'Y6 every spend reason shows the Pro-daily message', f: USE, from: 'spendCapLabelKey(reason as SpendReason)', to: "spendCapLabelKey('pro_daily')", red: ['A6.'] },
  { name: 'Y7 an older message is reworded', f: USE, from: 'return `Daily limit of ${limit} ${label} reached.`;', to: 'return `Limit of ${limit} ${label} reached.`;', red: ['A7.'] },
  { name: 'Y8 the check is made for the wrong tier', f: USE, from: 'spendCapBlock(tier, userId)', to: "spendCapBlock('pro', userId)", red: ['A1.'] },
  { name: 'Y9 the check is made for the wrong account', f: USE, from: 'spendCapBlock(tier, userId)', to: "spendCapBlock(tier, 'someone-else')", red: ['A1.'] },
  { name: 'Y10 the count reserve is called before the dollar check', f: USE, apply: (s) => {
      const a = s.indexOf('  const dollar = await spendCapBlock(tier, userId);');
      const b = s.indexOf('  const today = todayUtc();');
      if (a < 0 || b < a) throw new Error('order anchors');
      const dollarBlock = s.slice(a, b);
      const c = s.indexOf('  if (data === -1) {');
      const rpcStart = b;
      return s.slice(0, a) + s.slice(b, c) + dollarBlock + s.slice(c);
    }, red: ['A1.', 'A3.'] },
  // ── the migration
  { name: 'Z1 the revoke on the per-user sum is dropped', f: MIG, first: true, from: 'revoke execute on function lhq_ai_spend_user_since(uuid, timestamptz) from public, anon, authenticated;', to: '', red: ['M3.', 'M8.'] },
  { name: 'Z2 authenticated may run them', f: MIG, first: true, from: 'to service_role;', to: 'to service_role, authenticated;', red: ['M3.'] },
  { name: 'Z3 the window starts AFTER p_since', f: MIG, first: true, from: 'where user_id = p_user and created_at >= p_since;', to: 'where user_id = p_user and created_at > p_since;', red: ['M4.', 'M8.'] },
  { name: 'Z4 the whole-site sum is filtered by user', f: MIG, first: true, from: 'where created_at >= p_since;', to: 'where created_at >= p_since and user_id is not null;', red: ['M4.', 'M8.'] },
  { name: 'Z5 security definer is removed', f: MIG, first: true, from: 'stable\nsecurity definer\nset search_path', to: 'stable\nset search_path', red: ['M2.', 'M8.'] },
  { name: 'Z6 the search_path pin is removed', f: MIG, first: true, from: 'set search_path = public', to: '', red: ['M2.', 'M8.'] },
  { name: 'Z7 an estimate is copied into the SQL', f: MIG, first: true, from: "count(*) filter (where cost_usd is null and call_type = 'chat_search')::int", to: "count(*) filter (where cost_usd is null and call_type = 'chat_search')::int * 1 + 0.0372", red: ['M6.', 'M8.'] },
  { name: 'Z8 a NULL call_type is dropped (is distinct from becomes <>)', f: MIG, first: true, from: "call_type is distinct from 'chat_search'", to: "call_type <> 'chat_search'", red: ['M5.', 'M8.'] },
  { name: 'Z9 the SQL parameter is renamed', f: MIG, first: true, from: '(p_user uuid, p_since timestamptz)', to: '(p_user uuid, p_from timestamptz)', red: ['Q6.', 'P3.', 'F1.'] },
  { name: 'Z10 a result column is renamed', f: MIG, first: true, from: 'returns table(cost float8, null_search int, null_other int)', to: 'returns table(cost float8, null_srch int, null_other int)', red: ['Q6.', 'P15.', 'P17.', 'F8.'] },
  { name: 'Z11 the dev block drifts from the prod block', f: MIG, nth: 2, from: 'coalesce(sum(cost_usd), 0)::float8', to: 'coalesce(sum(cost_usd), 1)::float8', red: ['M8.'] },
  { name: 'Z12 the prod block reads the dev table', f: MIG, first: true, from: 'from lhq_ai_call_log', to: 'from lhq_dev_ai_call_log', red: ['M7.'] },
  { name: 'Z13 the migration drops something', f: MIG, apply: (s) => s + '\ndrop table if exists lhq_some_old_table;\n', red: ['M1.'] },
  { name: 'Z14 the function is not marked stable', f: MIG, first: true, from: 'stable\nsecurity definer', to: 'security definer', red: ['M2.', 'M8.'] },
  { name: 'Z15 the sum is no longer cast to float8', f: MIG, first: true, from: 'coalesce(sum(cost_usd), 0)::float8', to: 'coalesce(sum(cost_usd), 0)', red: ['M2.', 'M8.'] },
  { name: 'Z16 anon is also granted the whole-site sum', f: MIG, first: true, from: 'grant  execute on function lhq_ai_spend_all_since(timestamptz) to service_role;', to: 'grant  execute on function lhq_ai_spend_all_since(timestamptz) to service_role;\ngrant execute on function lhq_ai_spend_all_since(timestamptz) to anon;', red: ['M3.'] },
  { name: 'Z17 public keeps execute on the per-user sum (revoke lists only anon and authenticated)', f: MIG, first: true, from: 'revoke execute on function lhq_ai_spend_user_since(uuid, timestamptz) from public, anon, authenticated;', to: 'revoke execute on function lhq_ai_spend_user_since(uuid, timestamptz) from anon, authenticated;', red: ['M3.'] },
];

const FILES = [CAP, USE, MIG];
const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', ...FILES], { windowsHide: true });
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
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
for (const m of M) {
  if (ONLY.length && !ONLY.includes(m.name.split(' ')[0])) continue;
  const src = readFileSync(`${ROOT}/${m.f}`, 'utf8').split(CR + LF).join(LF);
  let out;
  try {
    if (m.apply) out = m.apply(src);
    else {
      const n = src.split(m.from).length - 1;
      const need = m.nth ?? 1;
      if (m.first ? n < 1 : m.nth ? n < need : n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); all = false; continue; }
      let at = -1;
      for (let i = 0; i < (m.first ? 1 : need); i++) at = src.indexOf(m.from, at + 1);
      out = src.slice(0, at) + m.to + src.slice(at + m.from.length);
    }
  } catch (e) { console.log(`SKIP    ${m.name}\n        ${e.message}`); all = false; continue; }
  if (out === src) { console.log(`SKIP    ${m.name}\n        mutation changed nothing`); all = false; continue; }
  writeFileSync(`${ROOT}/${m.f}`, out);
  const r = run();
  revert();
  const missing = m.red.filter((k) => !r.failed.includes(k));
  const good = r.code !== 0 && missing.length === 0;
  if (!good) all = false;
  console.log(`${good ? 'OK    ' : 'WRONG '}  ${m.name}\n        want red: ${m.red.join(', ')} | actually red: ${r.failed.join(', ') || '(none - suite stayed GREEN)'}${missing.length ? ` | NOT CAUGHT: ${missing.join(', ')}` : ''}`);
}
revert();
console.log(all ? '\nAll mutations behaved as designed.' : '\nA MUTATION DID NOT BEHAVE AS DESIGNED.');
