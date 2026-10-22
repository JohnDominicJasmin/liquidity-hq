/* Mutation check for __tests__/lemonsqueezyPaymentSuccess.test.mts (#1422).
 *
 * Two kinds of expectation, because this fix is STRUCTURAL:
 *   red   - the mutation reintroduces a defect and named tests MUST go red
 *   green - the mutation is one the structure is designed to absorb, and the
 *           suite must STAY green. A protection that has never been shown to hold is
 *           an assertion about the design, not evidence for it.
 * Every mutation is reverted with git afterwards. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq';
const LIB = `${ROOT}/lib/lemonsqueezy.ts`;
const ROUTE = `${ROOT}/app/api/lemonsqueezy/webhook/route.ts`;
const TEST = '__tests__/lemonsqueezyPaymentSuccess.test.mts';

const IGN = "  if (IGNORED_INVOICE_EVENTS.has(eventName)) return null;";
const ENDS = "  if (ENDS_ACCESS.has(eventName)) {";
const SUBS_MEMBER = "  'subscription_updated',";
const PS = "  'subscription_payment_success',";

/* Each edit: [file, from|RegExp, to]. A string anchor must occur EXACTLY once or the
   mutation is reported as SKIP - a mutation that silently did not apply proves nothing. */
const MUTATIONS = [
  { name: 'M1  REINTRODUCE #1422: event back in SUBSCRIPTION_EVENTS, ignore check disabled',
    edits: [[LIB, SUBS_MEMBER, `${SUBS_MEMBER}\n${PS}`], [LIB, IGN, '  if (false) return null;']],
    red: ['1.', '2.', '2b.', '2c.', '6.', '6c.'] },

  { name: 'M2  STRUCTURE HOLDS: event ALSO in SUBSCRIPTION_EVENTS, ignore check still first',
    edits: [[LIB, SUBS_MEMBER, `${SUBS_MEMBER}\n${PS}`]],
    green: true },

  { name: 'M3  event in SUBSCRIPTION_EVENTS AND ignore check moved below it',
    edits: [[LIB, SUBS_MEMBER, `${SUBS_MEMBER}\n${PS}`], [LIB, IGN, ''], [LIB, ENDS, `${IGN}\n${ENDS}`]],
    red: ['1.', '2.', '6.', '6c.'] },

  { name: 'M4  ordering ONLY: ignore check moved below the branches, sets still disjoint',
    edits: [[LIB, IGN, ''], [LIB, ENDS, `${IGN}\n${ENDS}`]],
    red: ['6c.'], onlyRed: true },

  { name: 'M5  ignored event returns a patch carrying the INVOICE id',
    edits: [[LIB, IGN, "  if (IGNORED_INVOICE_EVENTS.has(eventName)) return { ls_status: status || 'x', ls_subscription_id: dataId ?? '' };"]],
    red: ['1.', '2.', '2b.', '2c.', '2d.', '6.'] },

  { name: "M6  role rule stops granting (always 'free')",
    edits: [[LIB, "      role:               status === 'active' ? 'pro' : 'free',", "      role:               'free',"]],
    red: ['1.', '1b.', 'CONTROL:created', '4.'] },

  { name: 'M7  renews_at no longer stored',
    edits: [[LIB, "      current_period_end: pickDate(attrs.renews_at) ?? pickDate(attrs.ends_at) ?? null,", "      current_period_end: null,"]],
    red: ['1.', 'CONTROL:created', '4.'] },

  { name: 'M8  payment_failed no longer ends access',
    edits: [[LIB, "  'subscription_payment_failed',", "  'subscription_payment_failed_x',"]],
    red: ['5.'] },

  { name: 'M9  cancellation now writes a role (the #134 defect)',
    edits: [[LIB, "  if (RECORD_ONLY.has(eventName)) {", "  if (RECORD_ONLY.has(eventName)) { return { role: 'free', ls_status: status || 'x' };"]],
    red: ['5.'] },

  { name: 'M10 a non-active subscription_updated stops downgrading',
    edits: [[LIB, "      role:               status === 'active' ? 'pro' : 'free',", "      role:               'pro',"]],
    red: ['CONTROL:a'] },

  { name: 'M11 the parsed set is EMPTY (vacuous-pass guard)',
    edits: [[LIB, /(const IGNORED_INVOICE_EVENTS = new Set\(\[)[\s\S]*?(\]\);)/, '$1$2']],
    red: ['6b.'], onlyRed: true },

  { name: 'M12 route decides BEFORE it records the payment',
    edits: [[ROUTE, /^/, '// patchForEvent(\n']],
    red: ['6d.'], onlyRed: true },
];

const revert = () => execFileSync('git', ['-C', ROOT, 'checkout', '--', 'lib/lemonsqueezy.ts', 'app/api/lemonsqueezy/webhook/route.ts'], { windowsHide: true });
const key = (n) => { const t = n.split(' '); return t[0] === 'CONTROL:' ? `CONTROL:${t[1]}` : t[0]; };

let allGood = true;
for (const m of MUTATIONS) {
  let applied = true;
  const originals = new Map();
  for (const [file, from, to] of m.edits) {
    const src = originals.has(file) ? originals.get(file).cur : readFileSync(file, 'utf8');
    if (typeof from === 'string') {
      const n = src.split(from).length - 1;
      if (n !== 1) { console.log(`SKIP    ${m.name}\n        anchor occurs ${n}x (need exactly 1): ${JSON.stringify(from.slice(0, 60))}`); applied = false; break; }
    } else if (!from.test(src)) { console.log(`SKIP    ${m.name}\n        regex did not match`); applied = false; break; }
    originals.set(file, { cur: src.replace(from, to) });
    writeFileSync(file, originals.get(file).cur);
  }
  if (!applied) { revert(); allGood = false; continue; }

  let out = '', code = 0;
  try {
    out = execFileSync('node', ['--import', './qa/alias-register.mjs', '--test', TEST],
      { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  } catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status ?? 1; }
  revert();

  const failed = [...new Set([...out.matchAll(/^\u2716 (.+?) \(/gm)].map((x) => key(x[1])))].filter((k) => !k.includes('__tests__'));
  let ok;
  if (m.green) ok = code === 0 && failed.length === 0;
  else {
    const caught = m.red.filter((p) => failed.includes(p));
    ok = code !== 0 && caught.length === m.red.length && (!m.onlyRed || failed.length === m.red.length);
  }
  if (!ok) allGood = false;
  const want = m.green ? 'STAY GREEN' : `red: ${m.red.join(', ')}${m.onlyRed ? ' (ONLY these)' : ''}`;
  console.log(`${ok ? 'OK    ' : 'WRONG '}  ${m.name}\n        want ${want} | actually red: ${failed.length ? failed.join(', ') : '(none - suite stayed GREEN)'}`);
}
console.log(allGood ? '\nAll mutations behaved as designed.' : '\nA MUTATION DID NOT BEHAVE AS DESIGNED.');
