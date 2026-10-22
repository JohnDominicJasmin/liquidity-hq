const fs = require('fs');
const SP = 'C:/Users/Dominic/AppData/Local/Temp/claude/C--Users-Dominic-Documents-VS-code-liquidity-hq-qa-liquidity-hq/a64439a2-d725-4529-aa87-8c1c2203fbaf/scratchpad';
const T = '__tests__/lemonsqueezyOneActivePlan.test.mts';
let s = fs.readFileSync(T, 'utf8');
const rep = (from, to) => { if (s.split(from).length !== 2) throw new Error('anchor not unique: ' + from.slice(0, 70)); s = s.replace(from, () => to); };

rep(`  { name: 'pro, cancelled and PAST its end by more than the backstop',`,
`  { name: 'free, access ended by a failed payment (the id and a FUTURE period end are kept)', stored: row({ role: 'free', ls_status: 'past_due', current_period_end: iso(NOW + 10 * DAY) }), want: ALL('apply') },
  { name: 'pro, cancelled and PAST its end by more than the backstop',`);

rep(`test('R5. RULE-BASED, never observed: a second ACTIVE subscription`,
`test('R15. after a FAILED PAYMENT ended access (role free, id and period end kept), a new subscription takes over', async () => {
  /* The natural sequence: the card fails, then the customer subscribes again. payment_failed
     writes only role and status, so the row keeps the old id and a period end in the FUTURE.
     Treated as "live" that row would refuse the re-subscription: the customer pays and the
     purchase is reported and dropped. Only the role check tells the two apart. */
  resetDb();
  seed();
  const failed = await deliver('subscription_payment_failed', 'INVOICE_7', { subscription_id: 'SUB_MONTHLY', status: 'paid' });
  assert.deepEqual(failed.body, { received: true });
  assert.equal(now()?.role, 'free', 'precondition: the failed payment ended access');
  assert.equal(now()?.current_period_end, MONTHLY.current_period_end, 'precondition: the period end is still in the future');
  const res = await deliver('subscription_created', 'SUB_RESUBSCRIBED', { status: 'active', renews_at: '2100-01-01T00:00:00.000000Z' });
  assert.deepEqual(res.body, { received: true });
  const r = now()!;
  assert.equal(r.ls_subscription_id, 'SUB_RESUBSCRIBED');
  assert.equal(r.role, 'pro');
});

test('R5. RULE-BASED, never observed: a second ACTIVE subscription`);
fs.writeFileSync(T, s);

const M = SP + '/mutate-1432.mjs';
let m = fs.readFileSync(M, 'utf8');
const mrep = (from, to) => { if (m.split(from).length !== 2) throw new Error('mut anchor: ' + from.slice(0, 70)); m = m.replace(from, () => to); };
mrep(`to: '    && true', red: ['C1.'] }`, `to: '    && true', red: ['C1.', 'R15.'] }`);
fs.writeFileSync(M, m);
console.log('ok');
