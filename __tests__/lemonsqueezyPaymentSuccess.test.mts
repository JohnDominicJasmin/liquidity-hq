import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchForEvent, type EventAttributes } from '../lib/lemonsqueezy.ts';

/* #1422 - PAYING FOR PRO REVOKED PRO.
 *
 * Observed on a real test-mode purchase on `qa`, twice, three webhooks one second apart:
 *
 *   subscription_created          status active -> role pro
 *   subscription_updated          status active -> role pro
 *   subscription_payment_success  status paid   -> role FREE
 *
 * `subscription_payment_success` carries a subscription INVOICE, whose status is `paid`,
 * and the role rule was `status === 'active' ? 'pro' : 'free'`. Every successful payment
 * downgraded the payer, on the success path of every purchase and every renewal, while
 * every webhook returned 200 and the delivery log stayed green.
 *
 * WHY THIS FILE EXISTS AT ALL. `subscription_payment_success` appeared in ZERO tests.
 * Every way a subscription can END was covered - created 15, expired 8, cancelled 6,
 * payment_failed 5 - and the one event on the revenue path had none. A green suite over an
 * untested path is indistinguishable from a green suite over a tested one, so "the fix broke
 * nothing" was never evidence of anything: nothing was watching.
 *
 * THE FIX'S SHAPE, AND WHAT IT MEANS FOR THESE TESTS. The event moved out of
 * SUBSCRIPTION_EVENTS into IGNORED_INVOICE_EVENTS, checked FIRST. Consequence worth knowing
 * before reading the mutation results: deleting the event from the ignored set on its own
 * changes NOTHING observable - it falls through to `null` anyway, being in no other set. The
 * real regression is putting it back into SUBSCRIPTION_EVENTS with the ordering broken. So the
 * ordering is asserted separately, against source, because no input can reveal it while the
 * sets are disjoint.
 *
 * Fixtures use neutral ids (`sub_1`, `inv_1`) - nothing here comes from a real purchase. */

const R1 = '2026-10-24T05:21:00Z';
const R2 = '2026-11-24T05:21:00Z';
const ACTIVE = { status: 'active', customer_id: 42, renews_at: R1 };

type Ev = [name: string, attrs: EventAttributes, dataId?: string];

/** The route does `upsert({ user_id, ...patch })`, so a column the patch omits is untouched
 *  and a `null` patch writes nothing. Replaying through that same rule reproduces what the
 *  database ends up holding, which is the thing the buyer actually sees. */
function replay(events: Ev[]): Record<string, unknown> {
  const row: Record<string, unknown> = {
    role: 'free', ls_status: '', ls_subscription_id: '', ls_customer_id: '', current_period_end: null,
  };
  for (const [name, attrs, id] of events) {
    const patch = patchForEvent(name, attrs, id);
    if (patch) Object.assign(row, patch);
  }
  return row;
}

/* ── 1. THE REGRESSION: the observed sequence must end on Pro ─────────────────── */

test('1. REPLAY of the observed purchase: created -> updated -> payment_success ends on PRO', () => {
  const row = replay([
    ['subscription_created', ACTIVE, 'sub_1'],
    ['subscription_updated', ACTIVE, 'sub_1'],
    ['subscription_payment_success', { status: 'paid', customer_id: 42 }, 'inv_1'],
  ]);
  assert.equal(row.role, 'pro',
    'the payer ended on FREE - a successful payment revoked the plan it was paying for (#1422)');
  assert.equal(row.ls_status, 'active',
    "`paid` is an invoice status and must never be stored as the subscription's status");
  assert.equal(row.ls_subscription_id, 'sub_1',
    'the INVOICE id overwrote the subscription id - every later lookup, including cancel (#1396), would target the wrong object');
  assert.equal(row.current_period_end, R1,
    'the renewal date was wiped - an invoice carries no renews_at, so `?? null` erased it');
});

test('1b. the same sequence, but the invoice arrives FIRST (deliveries are not ordered)', () => {
  /* LemonSqueezy does not promise delivery order, and the observed three landed within one
     second. If the invoice event can land before the subscription ones, the outcome must not
     depend on it: an ignored event is order-independent by construction. */
  const row = replay([
    ['subscription_payment_success', { status: 'paid' }, 'inv_1'],
    ['subscription_created', ACTIVE, 'sub_1'],
    ['subscription_updated', ACTIVE, 'sub_1'],
  ]);
  assert.equal(row.role, 'pro');
  assert.equal(row.ls_subscription_id, 'sub_1');
});

/* ── 2. the event itself, across every input a delivery could carry ────────────── */

test('2. payment_success writes NOTHING - status `paid`', () => {
  assert.equal(patchForEvent('subscription_payment_success', { status: 'paid' }, 'inv_1'), null);
});

test("2b. ...and NOT because of the string `paid` - status `active` is ignored too", () => {
  /* Guards against a "fix" that special-cases the observed value. The bug was never that
     `paid` is unusual; it is that this event's status describes an invoice, whatever it says. */
  assert.equal(patchForEvent('subscription_payment_success', { status: 'active' }, 'inv_1'), null);
});

test('2c. an invoice with an unexpected shape cannot fall through to a role write', () => {
  const shapes: Array<EventAttributes | undefined> = [
    undefined, {}, { status: undefined }, { status: null }, { status: '' }, { status: 42 },
    { status: {} }, { status: [] }, { status: 'refunded' }, { status: 'failed' },
    { status: 'on_trial' }, { status: 'past_due' },
  ];
  for (const attrs of shapes) {
    for (const id of [undefined, '', 'inv_1', 'sub_1']) {
      assert.equal(patchForEvent('subscription_payment_success', attrs, id), null,
        `payment_success produced a patch for attrs=${JSON.stringify(attrs)} id=${JSON.stringify(id)}`);
    }
  }
});

test('2d. no patch from this event can carry a subscription id or a role, by construction', () => {
  /* Named explicitly because `ls_subscription_id` is what #1396 (cancel) will read: an
     invoice id stored there is silent until the day someone tries to cancel. */
  const p = patchForEvent('subscription_payment_success', { status: 'paid', customer_id: 42, renews_at: R2 }, 'inv_1');
  assert.equal(p, null);
  assert.ok(!p || !('ls_subscription_id' in p));
  assert.ok(!p || !('role' in p));
});

/* ── 3. THE CONTROLS: the events that DO grant must still grant ───────────────── */

test('CONTROL: created and updated with status `active` still grant Pro, with every field', () => {
  /* Every assertion above is "returns null", which a function that returned null for
     EVERYTHING would satisfy. These are what must come back positive. */
  for (const name of ['subscription_created', 'subscription_updated']) {
    const p = patchForEvent(name, ACTIVE, 'sub_1');
    assert.ok(p, `${name} returned null - the fix has broken the events that grant`);
    assert.equal(p.role, 'pro', `${name} no longer grants Pro`);
    assert.equal(p.ls_status, 'active');
    assert.equal(p.ls_subscription_id, 'sub_1');
    assert.equal(p.ls_customer_id, '42');
    assert.equal(p.current_period_end, R1);
  }
});

test('CONTROL: a subscription_updated that is NOT active still downgrades (policy unchanged)', () => {
  // `past_due` arrives via subscription_updated the moment a renewal fails. The fix removed
  // one event from this path; it must not have weakened the path for the others.
  assert.equal(patchForEvent('subscription_updated', { status: 'past_due', customer_id: 42 }, 'sub_1')?.role, 'free');
  assert.equal(patchForEvent('subscription_updated', { status: 'expired', customer_id: 42 }, 'sub_1')?.role, 'free');
});

/* ── 4. renewal: the next cycle must leave the buyer on Pro with an advanced date ─ */

test('4. a SECOND cycle keeps Pro and advances the period', () => {
  /* Stated assumption, NOT verified: that LemonSqueezy sends `subscription_updated` on a
     RENEWAL carrying the new `renews_at`. The purchase proves it only for a FIRST payment.
     If it does not hold, current_period_end stops advancing and `paidPeriodLapsed`'s 48-hour
     backstop demotes a paying subscriber two days after their old period ends. This test
     shows the decision function handles that sequence correctly IF the event arrives; it
     cannot show that it does. Needs LS documentation or an observed renewal. */
  const row = replay([
    ['subscription_created', ACTIVE, 'sub_1'],
    ['subscription_updated', ACTIVE, 'sub_1'],
    ['subscription_payment_success', { status: 'paid' }, 'inv_1'],
    ['subscription_updated', { ...ACTIVE, renews_at: R2 }, 'sub_1'],
    ['subscription_payment_success', { status: 'paid' }, 'inv_2'],
  ]);
  assert.equal(row.role, 'pro');
  assert.equal(row.current_period_end, R2, 'the renewal date did not advance');
  assert.equal(row.ls_subscription_id, 'sub_1');
});

/* ── 5. the owner's two downgrade decisions must be exactly as they were ─────────── */

test('5. OWNER DECISIONS INTACT: payment_failed ends access now, cancelled keeps it to ends_at', () => {
  /* The fix must not become a second opinion on policy. These two are deliberately opposite
     (2026-08-08): they did NOT pay -> end immediately; they DID pay -> keep access to ends_at. */
  const paid = replay([['subscription_created', ACTIVE, 'sub_1']]);
  assert.equal(paid.role, 'pro');

  const failed = replay([['subscription_created', ACTIVE, 'sub_1'], ['subscription_payment_failed', { status: 'failed' }, 'inv_9']]);
  assert.equal(failed.role, 'free', 'a failed payment no longer ends access immediately');
  assert.equal(failed.ls_subscription_id, 'sub_1', 'the failed invoice overwrote the subscription id');

  const cancelled = patchForEvent('subscription_cancelled', { status: 'cancelled', ends_at: R2 }, 'sub_1');
  assert.ok(cancelled);
  assert.ok(!('role' in cancelled), 'cancellation now writes a role - it must keep access until expiry (#134)');
  assert.equal(cancelled.current_period_end, R2);

  const kept = replay([['subscription_created', ACTIVE, 'sub_1'], ['subscription_cancelled', { status: 'cancelled', ends_at: R2 }, 'sub_1']]);
  assert.equal(kept.role, 'pro', 'a cancelled subscription lost access before its period ended');

  const expired = replay([['subscription_created', ACTIVE, 'sub_1'], ['subscription_expired', { status: 'expired' }, 'sub_1']]);
  assert.equal(expired.role, 'free', 'expiry no longer ends access');
});

/* ── 6. STRUCTURAL: the invariant, asserted over the SET rather than the instance ─ */

const LIB = readFileSync(new URL('../lib/lemonsqueezy.ts', import.meta.url), 'utf8');
const ROUTE = readFileSync(new URL('../app/api/lemonsqueezy/webhook/route.ts', import.meta.url), 'utf8');

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Members of IGNORED_INVOICE_EVENTS, read from source because the set is module-private.
 *  WEAKER than an import and labelled so: if it is ever exported, replace this. */
function ignoredMembers(): string[] {
  const m = strip(LIB).match(/IGNORED_INVOICE_EVENTS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  return m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]) : [];
}

test('6. NO ignored invoice event can produce ANY patch, for any input', () => {
  /* Asserted over the set, so a SECOND invoice event added later is covered without anyone
     remembering to add a test - which is how the first one got through untested. */
  const members = ignoredMembers();
  const statuses: unknown[] = [undefined, null, '', 'paid', 'active', 'on_trial', 'past_due', 'cancelled', 'expired', 'failed', 42, {}, []];
  for (const name of members) {
    for (const status of statuses) {
      for (const extra of [{}, { renews_at: R2 }, { ends_at: R2 }, { customer_id: 42 }]) {
        for (const id of [undefined, '', 'inv_1', 'sub_1']) {
          const attrs = { status, ...extra } as EventAttributes;
          assert.equal(patchForEvent(name, attrs, id), null,
            `${name} produced a patch for ${JSON.stringify(attrs)} id=${JSON.stringify(id)} - an ignored invoice event must write nothing`);
        }
      }
    }
  }
});

test('6b. CONTROL: the source parse found the set, and it contains the event that caused #1422', () => {
  /* Without this, test 6 passes vacuously if the parse returns [] - a renamed constant, a
     changed literal, a comment in the wrong place. The failure it prevents is the same one
     this whole file exists for: a check that never looked, reporting clean. */
  const members = ignoredMembers();
  assert.ok(members.length >= 1, 'no members parsed - test 6 asserted over an EMPTY set');
  assert.ok(members.includes('subscription_payment_success'),
    'subscription_payment_success is no longer in IGNORED_INVOICE_EVENTS');
});

test('6c. ORDERING: the ignore check runs BEFORE any branch that can write a role', () => {
  /* The structural half. While the sets are disjoint no input can reveal the order, so it is
     asserted against source. This is what makes "a successful payment cannot reach a role
     write, whatever a later edit does to the sets below" true rather than aspirational: put
     the event back into SUBSCRIPTION_EVENTS and this ordering is all that still protects it. */
  const body = strip(LIB).split(/export function patchForEvent\(/)[1] ?? '';
  const ignored = body.indexOf('IGNORED_INVOICE_EVENTS.has(');
  const branches = ['SUBSCRIPTION_EVENTS.has(', 'ENDS_ACCESS.has(', 'RECORD_ONLY.has('].map((b) => [b, body.indexOf(b)] as const);
  assert.ok(ignored >= 0, 'patchForEvent no longer consults IGNORED_INVOICE_EVENTS');
  for (const [name, at] of branches) {
    assert.ok(at >= 0, `${name} not found - the branch structure changed, re-read this test`);
    assert.ok(ignored < at, `the ignore check now runs AFTER ${name} - a successful payment can reach a role write again`);
  }
});

test('6d. the payment is still RECORDED: the route writes the event row before consulting the decision', () => {
  /* Ignoring the event must not lose the record that a payment happened. The route inserts
     into lhq_ls_webhook_events (the replay guard) BEFORE calling patchForEvent, so a null
     patch still leaves evidence. Source assertion - the route itself needs a database. */
  const route = strip(ROUTE);
  const recorded = route.indexOf('T.ls_webhook_events');
  const decided = route.indexOf('patchForEvent(');
  assert.ok(recorded >= 0 && decided >= 0, 'route structure changed, re-read this test');
  assert.ok(recorded < decided, 'the decision now runs before the payment is recorded - an ignored payment would leave no trace');
});
