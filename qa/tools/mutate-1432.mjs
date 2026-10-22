/* Mutation check for __tests__/lemonsqueezyOneActivePlan.test.mts (Fix B, #1432).
 * Each mutation reintroduces a defect; the named tests MUST go red. An anchor that does not occur
 * EXACTLY once is SKIPPED, never silently passed. The three `todo` findings (C9, R11, R12) fail on
 * the unmutated code by design and are subtracted from every run; a BASELINE run proves that first. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const LIB = 'lib/lemonsqueezy.ts';
const ROUTE = 'app/api/lemonsqueezy/webhook/route.ts';
const PAID = 'lib/paidPeriod.ts';
const TEST = '__tests__/lemonsqueezyOneActivePlan.test.mts';
const BASELINE_TODO = new Set(); // todo tests print with a different symbol and are not counted red; baseline checks their count instead

const SAME = "if (storedSubId === incomingSubId) {";
const IDLESS = "if (!storedSubId) {";
const IGN = "return { action: 'ignore', reason:";
const TWO = "{ action: 'report', reason: 'a second active";
const GRACE = "if (stored!.ls_status === 'cancelled') {";
const LAPSE = "    && !paidPeriodLapsed('pro', stored.current_period_end, nowMs);";
const ROLE = "    && stored.role === 'pro'";
const NOID = "if (!incomingSubId) {";
const ATTRSID = "const s = attrs.subscription_id;";
const ATTRSET = "  'subscription_payment_failed', 'subscription_payment_refunded',";
const DATASET = "  'subscription_cancelled', 'subscription_expired',";
const NUM = "if (typeof s === 'number' && Number.isFinite(s)) return String(s);";
const EMPTY = "return dataId && dataId.length > 0 ? dataId : null;";

const R_IGN = "    return NextResponse.json({ received: true, ignored: 'different_subscription' });";
const R_REP = "    return NextResponse.json({ received: true, ignored: 'subscription_mismatch_reported' });";
const R_STAT = "const incomingStatus = typeof attrs.status === 'string' ? attrs.status : '';";
const R_SUBID = "    incomingSubId,";
const R_SEL = ".select('ls_subscription_id, role, ls_status, current_period_end')";
const R_EQ = ".eq('user_id', userId)";

const M = [
  { name: 'L1  same-subscription check disabled (own writes never apply)', f: LIB, from: SAME, to: 'if (false) {', red: ['C2.', 'R2.', 'R8.'] },
  { name: 'L2  EVERYTHING applies (the #1429 defect, wholesale)', f: LIB, from: SAME, to: 'if (true) {', red: ['C1.', 'C8.', 'R1.', 'R1b.', 'R5.', 'R8b.', 'R8c.'] },
  { name: 'L3  a foreign non-active event applies instead of ignore (#1429 returns)', f: LIB, from: IGN, to: "return { action: 'apply', reason:", red: ['C1.', 'C8.', 'R1.', 'R1b.', 'R8b.', 'R8c.'] },
  { name: 'L4  two-active applies instead of report', f: LIB, from: TWO, to: "{ action: 'apply', reason: 'a second active", red: ['C1.', 'R5.'] },
  { name: 'L5  grace takeover removed', f: LIB, from: GRACE, to: 'if (false) {', red: ['C1.', 'R6.'] },
  { name: 'L6  liveness ignores the period (a lapsed pro row is still "live")', f: LIB, from: LAPSE, to: '    ;', red: ['C1.', 'C4.', 'R4b.'] },
  { name: 'L7  liveness ignores role (a free row with no period is "live")', f: LIB, from: ROLE, to: '    && true', red: ['C1.', 'R15.'] },
  { name: 'L8  the injected clock is ignored', f: LIB, from: LAPSE, to: "    && !paidPeriodLapsed('pro', stored.current_period_end, Date.now());", red: ['C1.', 'C4.', 'C5.'] },
  { name: 'L9  the no-subscription-id report is removed', f: LIB, from: NOID, to: 'if (false) {', red: ['C3.', 'C11.', 'R7.'] },
  { name: 'L10 payment_failed/refunded read data.id (the invoice) not attributes.subscription_id', f: LIB, from: ATTRSID, to: 'const s = dataId;', red: ['B2.', 'B2b.', 'B2c.', 'R8.', 'R8c.'] },
  { name: 'L11 order_refunded made matchable', f: LIB, from: ATTRSET, to: "  'subscription_payment_failed', 'subscription_payment_refunded', 'order_refunded',", red: ['B3.', 'R7.'] },
  { name: 'L12 subscription_expired dropped from the data.id set', f: LIB, from: DATASET, to: "  'subscription_cancelled',", red: ['B1.', 'B5.'] },
  { name: 'L13 numeric subscription_id no longer normalised', f: LIB, from: NUM, to: '', red: ['B2b.'] },
  { name: 'L14 an empty data.id is passed through instead of null', f: LIB, from: EMPTY, to: 'return dataId ?? null;', red: ['B1b.'] },
  { name: 'P1  backstop boundary: `<` becomes `<=`', f: PAID, from: 'return end + PAID_GRACE_MS < nowMs;', to: 'return end + PAID_GRACE_MS <= nowMs;', red: ['C4.'] },
  { name: 'Ro1 route: an ignored event still falls through to the upsert', f: ROUTE, from: R_IGN, to: '    /* fallthrough */', red: ['R1.', 'R1b.', 'R8b.', 'R8c.'] },
  { name: 'Ro2 route: a reported event still falls through to the upsert', f: ROUTE, from: R_REP, to: '    /* fallthrough */', red: ['R5.', 'R7.'] },
  { name: 'Ro3 route: the incoming status is never passed', f: ROUTE, from: R_STAT, to: "const incomingStatus = '';", red: ['R5.', 'R6.'] },
  { name: 'Ro4 route: data.id is passed to the resolver instead of incomingSubscriptionId()', f: ROUTE, from: R_SUBID, to: '    dataId,', red: ['R7.', 'R8.', 'R8c.'] },
  { name: 'Ro5 route: the stored read forgets current_period_end', f: ROUTE, from: R_SEL, to: ".select('ls_subscription_id, role, ls_status')", red: ['R4b.'] },
  { name: 'Ro6 route: the stored read forgets role', f: ROUTE, from: R_SEL, to: ".select('ls_subscription_id, ls_status, current_period_end')", red: ['R1.', 'R1b.'] },
  { name: 'Ro7 route: the stored read is for the wrong user', f: ROUTE, from: R_EQ, to: ".eq('user_id', 'someone-else')", red: ['R1.', 'R1b.', 'R5.', 'R8b.', 'R8c.'] },
  { name: 'L15 the id-less rule removed (a first purchase on an id-less pro row is reported and dropped again)', f: LIB, from: IDLESS, to: 'if (false) {', red: ['C9.', 'C10.', 'R12.'] },
  { name: 'L16 the id-less rule over-applies (everything applies)', f: LIB, from: IDLESS, to: 'if (true) {', red: ['C1.', 'C10.', 'R1.', 'R13.', 'R14.'] },
  { name: 'Ro8 route: the read error is ignored again (fails open)', f: ROUTE, from: 'if (readErr) {', to: 'if (false) {', red: ['R11.'] },
  { name: 'Ro9 route: a failed read answers 500', f: ROUTE, from: "return NextResponse.json({ received: true, ignored: 'stored_read_failed' });", to: "return NextResponse.json({ error: 'x' }, { status: 500 });", red: ['R11.'] },
  { name: 'Ro10 route: a failed read is reported but still falls through to the write', f: ROUTE, from: "return NextResponse.json({ received: true, ignored: 'stored_read_failed' });", to: '/* fallthrough */', red: ['R11.'] },
  { name: 'Ro11 route: a failed read is not reported', f: ROUTE, from: 'stored-subscription read failed before the identity decision', to: 'x before the identity decision', red: ['R11.'] },
];

const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', LIB, ROUTE, PAID], { windowsHide: true });
const keyOf = (n) => n.split(' ')[0];
const run = () => {
  let out = '', code = 0;
  try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 180_000 }); }
  catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  const failed = [...new Set([...out.matchAll(/^\u2716 (.+?) \(/gm)].map((x) => keyOf(x[1])))].filter((k) => !k.includes('__tests__') && k !== 'failing');
  return { code, failed, out };
};

revert();
const base = run();
const todoN = Number((base.out.match(/^ℹ todo (\d+)/m) ?? [])[1]);
const baseOk = base.code === 0 && base.failed.length === 0 && todoN === 0;
console.log(`BASELINE ${baseOk ? 'OK' : 'WRONG'}  exit ${base.code}  red: ${base.failed.join(', ') || '(none)'}  todo: ${todoN} (want 0 red, 0 todo)`);
if (!baseOk) process.exit(2);

let all = true;
for (const m of M) {
  const src = readFileSync(`${ROOT}/${m.f}`, 'utf8');
  const n = src.split(m.from).length - 1;
  if (n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x`); all = false; continue; }
  writeFileSync(`${ROOT}/${m.f}`, src.replace(m.from, () => m.to));
  const r = run();
  revert();
  const red = r.failed.filter((k) => !BASELINE_TODO.has(k));
  const missing = m.red.filter((k) => !red.includes(k));
  const good = r.code !== 0 && missing.length === 0;
  if (!good) all = false;
  console.log(`${good ? 'OK    ' : 'WRONG '}  ${m.name}\n        want red: ${m.red.join(', ')} | actually red: ${red.length ? red.join(', ') : '(none - suite stayed GREEN)'}${missing.length ? ` | NOT CAUGHT: ${missing.join(', ')}` : ''}`);
}
revert();
console.log(all ? '\nAll mutations behaved as designed.' : '\nA MUTATION DID NOT BEHAVE AS DESIGNED.');
