/* Mutation check for __tests__/lemonsqueezyCancelled.test.mts (#1429, cells A and D).
 * red = the mutation reintroduces a defect and the named tests MUST go red.
 * A string anchor must occur EXACTLY once or the mutation is SKIPPED, never silently "passed". */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const LIB = `${ROOT}/lib/lemonsqueezy.ts`;
const TEST = '__tests__/lemonsqueezyCancelled.test.mts';

const CANC = "    if (status === 'cancelled') {";
const FUT = "        return { ...common, role: endMs > nowMs ? 'pro' : 'free', current_period_end: periodEnd };";
const UNR = "      return { ...common };";
const RULE = "      role:               status === 'active' ? 'pro' : 'free',";

const M = [
  { name: 'M1  REINTRODUCE #1429: the cancelled branch disabled (old rule for cancelled)',
    edits: [[CANC, "    if (false) {"]], red: ['A1.', 'A5b.', 'A6.'] },
  { name: 'M2  boundary: `>` becomes `>=`',
    edits: [[FUT, FUT.replace('endMs > nowMs', 'endMs >= nowMs')]], red: ['A4.'], only: true },
  { name: 'M3  paid-through FOREVER: a cancelled subscription is always Pro',
    edits: [[FUT, FUT.replace("endMs > nowMs ? 'pro' : 'free'", "'pro'")]], red: ['A2.', 'A3.'] },
  { name: 'M4  the injected clock is IGNORED (uses the real one)',
    edits: [[FUT, FUT.replace('endMs > nowMs', 'endMs > Date.now()')]], red: ['A1.', 'A2.'] },
  { name: 'M5  unreadable ends_at REVOKES (free) instead of preserving',
    edits: [[UNR, "      return { ...common, role: 'free' };"]], red: ['A5.', 'A5b.'] },
  { name: 'M6  unreadable ends_at grants Pro and WIPES the period end',
    edits: [[UNR, "      return { ...common, role: 'pro', current_period_end: null };"]], red: ['A5.', 'A5b.'] },
  { name: 'M7  the future-ends_at branch stops keeping the period end',
    edits: [[FUT, "        return { ...common, role: endMs > nowMs ? 'pro' : 'free' };"]], red: ['A1.', 'A3.'] },   // A6 cannot: the earlier created already stored the date
  { name: 'M8  cancellation writes a role (the #134 defect)',
    edits: [["  if (RECORD_ONLY.has(eventName)) {", "  if (RECORD_ONLY.has(eventName)) { return { role: 'free', ls_status: status || 'x' };"]], red: ['D2.'] },
  { name: 'M9  the fix widens the rule: past_due now grants Pro',
    edits: [[RULE, "      role:               status === 'active' || status === 'past_due' ? 'pro' : 'free',"]], red: ['D1.'] },
  { name: 'M10 the default clock is broken (0)',
    edits: [["  nowMs: number = Date.now(),", "  nowMs: number = 0,"]], red: ['CONTROL:the'] },
  { name: 'M11 payment_failed no longer ends access',
    edits: [["  'subscription_payment_failed',", "  'subscription_payment_failed_x',"]], red: ['D3.'] },
  { name: 'M12 the subscription id is no longer written',
    edits: [["      ls_subscription_id: dataId ?? '',", "      ls_subscription_id: '',"]], red: ['A1.', 'A6.'] },
  { name: 'M13 an unhandled event (payment_recovered) starts writing',
    edits: [["  'subscription_updated',", "  'subscription_updated', 'subscription_payment_recovered',"]], red: ['D4.'] },
  { name: 'M14 active updates stop granting (control)',
    edits: [[RULE, "      role:               'free',"]], red: ['CONTROL:a', 'A5b.'] },   // A6 cannot: the cancelled branch re-grants Pro by itself
];

const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', 'lib/lemonsqueezy.ts'], { windowsHide: true });
const key = (n) => { const t = n.split(' '); return t[0] === 'CONTROL:' ? `CONTROL:${t[1]}` : t[0]; };

let all = true;
for (const m of M) {
  let src = readFileSync(LIB, 'utf8'), ok = true;
  for (const [from, to] of m.edits) {
    const n = src.split(from).length - 1;
    if (n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x: ${JSON.stringify(from.slice(0, 64))}`); ok = false; break; }
    src = src.replace(from, () => to);
  }
  if (!ok) { all = false; continue; }
  writeFileSync(LIB, src);
  let out = '', code = 0;
  try { out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', TEST], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 }); }
  catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  revert();
  const failed = [...new Set([...out.matchAll(/^\u2716 (.+?) \(/gm)].map((x) => key(x[1])))].filter((k) => !k.includes('__tests__'));
  const caught = m.red.filter((p) => failed.includes(p));
  const good = code !== 0 && caught.length === m.red.length && (!m.only || failed.length === m.red.length);
  if (!good) all = false;
  console.log(`${good ? 'OK    ' : 'WRONG '}  ${m.name}\n        want red: ${m.red.join(', ')}${m.only ? ' (ONLY)' : ''} | actually red: ${failed.length ? failed.join(', ') : '(none - suite stayed GREEN)'}`);
}
console.log(all ? '\nAll mutations behaved as designed.' : '\nA MUTATION DID NOT BEHAVE AS DESIGNED.');
