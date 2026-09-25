import test from 'node:test';
import assert from 'node:assert/strict';
import { patchForEvent, type EventAttributes } from '../lib/lemonsqueezy.ts';

/* #1429 - CANCELLING A SUBSCRIPTION REVOKED PRO, A SIBLING OF #134 (cells A and D of the matrix).
 *
 * Observed on `qa`, one older test subscription cancelled at the end of its period while the
 * account was on Pro through a newer paid Monthly. Three deliveries within a second:
 *
 *   subscription_cancelled   -> record-only (owner, 2026-08-08): keeps Pro to ends_at
 *   subscription_updated     status "cancelled", ends_at in the future  -> role FREE   <- the defect
 *   subscription_updated     (a second one, 0.8s later)                -> role FREE
 *
 * Lemon Squeezy fires `subscription_updated` ALONGSIDE `subscription_cancelled`, and a cancelled
 * subscription keeps status `cancelled` through its whole grace period (the docs: "still technically
 * active and valid"). The owner's decision was implemented for one of the two events, and the other
 * applied `status === 'active' ? 'pro' : 'free'`. `subscription_updated` with status `cancelled`
 * appeared in NO test - the same shape as `payment_success` (#1422): every way of ending covered,
 * the event that arrives with it not.
 *
 * WHAT THIS FILE PINS, AND WHAT IT DELIBERATELY DOES NOT.
 *  - Cells A and D: the decision the fix implements, driven through an INJECTED clock so `ends_at`
 *    future / past / at-the-instant / absent / unreadable are all forceable with no real time.
 *  - The two edges the fix states are pinned as STATED BEHAVIOUR, not as verified-right policy:
 *    an absent or unreadable `ends_at` keeps the prior period (omits role and period end), and a
 *    past `ends_at` is free.
 *  - NOT cells B and C. The wrong-subscription overwrite (an event for a subscription other than the
 *    stored one replacing the id, status and period end) is Fix B, NOT MERGED. Writing a test for
 *    behaviour that does not exist would be a red-by-design test that breaks everyone's pre-push hook,
 *    and asserting today's overwrite would pin the defect. It is marked `todo` below so it shows in
 *    every run without asserting anything.
 *
 * Fixtures use neutral ids and dates; nothing here comes from a real purchase. */

const T = (iso: string) => Date.parse(iso);

// A fixed clock chosen so the REAL clock gives a DIFFERENT answer: "future" relative to 2020 is long
// past today. A function that ignored the injected clock would fail these, which is what proves the
// injection is honoured rather than merely accepted.
const NOW_EARLY = T('2020-01-01T00:00:00Z');
const NOW_LATE = T('2099-01-01T00:00:00Z');
const ENDS_2020_06 = '2020-06-01T00:00:00Z';   // future relative to NOW_EARLY, past relative to reality
const ENDS_2019_06 = '2019-06-01T00:00:00Z';   // past relative to NOW_EARLY

const cancelled = (endsAt: unknown, extra: EventAttributes = {}): EventAttributes =>
  ({ status: 'cancelled', customer_id: 42, ends_at: endsAt, renews_at: endsAt, ...extra });

/* The route does `upsert({ user_id, ...patch })`: a key the patch omits is untouched, a `null` patch
   writes nothing. Replaying through the same rule reproduces what the database ends up holding. */
type Ev = [name: string, attrs: EventAttributes, dataId?: string, nowMs?: number];
function replay(events: Ev[], start: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    role: 'free', ls_status: '', ls_subscription_id: '', ls_customer_id: '', current_period_end: null, ...start,
  };
  for (const [name, attrs, id, now] of events) {
    const patch = patchForEvent(name, attrs, id, now);
    if (patch) Object.assign(row, patch);
  }
  return row;
}

/* ── A. `subscription_updated` with status `cancelled`: the observed defect ─────── */

test('A1. cancelled with a FUTURE ends_at KEEPS Pro - the observed defect', () => {
  for (const name of ['subscription_updated', 'subscription_created']) {
    const p = patchForEvent(name, cancelled(ENDS_2020_06), 'sub_1', NOW_EARLY);
    assert.ok(p, `${name} returned null`);
    assert.equal(p.role, 'pro',
      `${name} with status cancelled and paid time remaining revoked Pro - the owner's 2026-08-08 decision, undone (#1429)`);
    assert.equal(p.ls_status, 'cancelled');
    assert.equal(p.ls_subscription_id, 'sub_1');
    assert.equal(p.ls_customer_id, '42');
    assert.equal(p.current_period_end, ENDS_2020_06, 'the end date is what drives the lapse backstop and must be kept');
  }
});

test('A2. the injected clock is HONOURED, not merely accepted', () => {
  /* The same payload reads Pro at one fixed instant and Free at another. Both instants are chosen
     so the REAL clock disagrees with at least one, so a function using Date.now() fails here. */
  assert.equal(patchForEvent('subscription_updated', cancelled(ENDS_2020_06), 'sub_1', NOW_EARLY)?.role, 'pro');
  assert.equal(patchForEvent('subscription_updated', cancelled(ENDS_2020_06), 'sub_1', NOW_LATE)?.role, 'free');
});

test('A3. cancelled with a PAST ends_at is FREE - the paid period is over (stated behaviour)', () => {
  const p = patchForEvent('subscription_updated', cancelled(ENDS_2019_06), 'sub_1', NOW_EARLY);
  assert.ok(p);
  assert.equal(p.role, 'free', 'a cancelled subscription whose paid time has passed still reads as Pro');
  assert.equal(p.current_period_end, ENDS_2019_06);
});

test('A4. the boundary: at exactly ends_at it is FREE, one millisecond earlier it is Pro (stated behaviour)', () => {
  /* Pinned so a change from `>` to `>=` is a decision someone makes, not an accident. The fix says
     "keep Pro while paid time remains", so the instant the period ends it is over. */
  const ends = T('2026-10-08T05:20:53Z');
  assert.equal(patchForEvent('subscription_updated', cancelled('2026-10-08T05:20:53Z'), 'sub_1', ends)?.role, 'free');
  assert.equal(patchForEvent('subscription_updated', cancelled('2026-10-08T05:20:53Z'), 'sub_1', ends - 1)?.role, 'pro');
});

test('A5. an ABSENT or UNREADABLE ends_at keeps the prior period: role AND current_period_end are omitted (stated behaviour)', () => {
  /* The fix does not invent a verdict it cannot support. Omitting both leaves the row on whatever the
     preceding `active` event set, so access is PRESERVED rather than revoked - and not granted forever,
     because the stored period end still drives the lapse backstop and `subscription_expired` still
     ends it. Pinned as STATED behaviour: whether this is the right policy is the owner's and Dev's. */
  const unreadable: unknown[] = [undefined, null, '', 'not a date', 12345, {}, []];
  for (const ends of unreadable) {
    const p = patchForEvent('subscription_updated', cancelled(ends, { renews_at: '2026-10-08T05:20:53Z' }), 'sub_1', NOW_EARLY);
    assert.ok(p, `ends_at=${JSON.stringify(ends)} returned null`);
    assert.ok(!('role' in p), `ends_at=${JSON.stringify(ends)} wrote a role (${p.role}) - it must be omitted`);
    assert.ok(!('current_period_end' in p), `ends_at=${JSON.stringify(ends)} wrote a period end - it must be omitted`);
    assert.equal(p.ls_status, 'cancelled', 'the status is still recorded');
  }
});

test('A5b. ...and the omission actually PRESERVES access on a real row', () => {
  const row = replay([
    ['subscription_created', { status: 'active', customer_id: 42, renews_at: '2020-03-01T00:00:00Z' }, 'sub_1', NOW_EARLY],
    ['subscription_updated', cancelled(undefined), 'sub_1', NOW_EARLY],
  ]);
  assert.equal(row.role, 'pro', 'an unreadable end date revoked a paying customer (the #134 class)');
  assert.equal(row.current_period_end, '2020-03-01T00:00:00Z', 'the earlier period end was wiped');
  assert.equal(row.ls_status, 'cancelled');
});

/* ── the same-subscription lifecycle, replayed as it actually arrives ──────────── */

test('A6. REPLAY: a subscription cancelled at period end keeps Pro to ends_at, then ends', () => {
  /* WHAT THIS DOES AND DOES NOT DISCRIMINATE - found by mutating it, not by reading it.
     It IS the guard for "the cancel sequence, in every arrival order, leaves Pro and the id", and it
     catches a broken subscription id or a revoked role. It does NOT prove the `active` path grants
     (the cancelled branch re-grants Pro by itself, so a broken `active` rule still ends on Pro - that is
     CONTROL 'plain ACTIVE update' and A5b), and its final period-end assertion is CONSISTENCY only: on
     the SAME subscription the earlier `created` already stored that date, so the cancelled events'
     own period-end write is redundant here. That write is asserted at the patch level, in A1 and A3. */
  const ENDS = '2020-03-01T00:00:00Z';
  const bought: Ev[] = [
    ['subscription_created', { status: 'active', customer_id: 42, renews_at: ENDS }, 'sub_1', NOW_EARLY],
    ['subscription_updated', { status: 'active', customer_id: 42, renews_at: ENDS }, 'sub_1', NOW_EARLY],
    ['subscription_payment_success', { status: 'paid' }, 'inv_1', NOW_EARLY],
  ];
  // the observed three deliveries around a cancellation: updated, cancelled, updated
  const cancel: Ev[] = [
    ['subscription_updated', cancelled(ENDS), 'sub_1', NOW_EARLY],
    ['subscription_cancelled', cancelled(ENDS), 'sub_1', NOW_EARLY],
    ['subscription_updated', cancelled(ENDS), 'sub_1', NOW_EARLY],
  ];
  const during = replay([...bought, ...cancel]);
  assert.equal(during.role, 'pro', 'cancelling revoked Pro before the paid period ended (#1429)');
  assert.equal(during.ls_status, 'cancelled');
  assert.equal(during.ls_subscription_id, 'sub_1');
  assert.equal(during.current_period_end, ENDS);

  // ...and in EVERY order the three arrive, since delivery order is not promised
  for (const perm of [[0, 1, 2], [1, 0, 2], [2, 1, 0], [1, 2, 0]]) {
    const r = replay([...bought, ...perm.map((i) => cancel[i])]);
    assert.equal(r.role, 'pro', `order ${perm.join(',')} revoked Pro`);
  }

  // the end of the period, by either of the two events that legitimately end it
  assert.equal(replay([...bought, ...cancel, ['subscription_expired', { status: 'expired' }, 'sub_1', NOW_LATE]]).role, 'free',
    'subscription_expired no longer ends a cancelled subscription');
  assert.equal(replay([...bought, ...cancel, ['subscription_updated', { status: 'expired', ends_at: ENDS, customer_id: 42 }, 'sub_1', NOW_LATE]]).role, 'free',
    'an updated event with status expired no longer ends access');
});

/* ── CONTROLS: every assertion above is a keep-Pro or omit; these must come back positive ─ */

test('CONTROL: a plain ACTIVE update still grants Pro', () => {
  const p = patchForEvent('subscription_updated', { status: 'active', customer_id: 42, renews_at: ENDS_2020_06 }, 'sub_1', NOW_EARLY);
  assert.equal(p?.role, 'pro');
  assert.equal(p?.current_period_end, ENDS_2020_06);
});

test('CONTROL: the default clock still works when none is injected', () => {
  /* Guards the `nowMs = Date.now()` default the ROUTE relies on - the injection must not have
     broken the production call path. Dates chosen so any real clock agrees. */
  assert.equal(patchForEvent('subscription_updated', cancelled('2099-01-01T00:00:00Z'), 'sub_1')?.role, 'pro');
  assert.equal(patchForEvent('subscription_updated', cancelled('2000-01-01T00:00:00Z'), 'sub_1')?.role, 'free');
});

/* ── D. the owner's other decisions must be exactly as they were ───────────────── */

test('D1. non-cancelled, non-active statuses on subscription_updated are FREE, as before (current behaviour, NOT a policy claim)', () => {
  /* Pinned as CURRENT behaviour. `past_due` and `paused` are unresolved policy (the owner's), and
     `on_trial` is not a state this product uses. `expired` and `unpaid` are correctly free. The point
     is that the fix removed exactly ONE status from this path and nothing else. */
  for (const status of ['past_due', 'unpaid', 'expired', 'paused', 'on_trial', '', 'something_new']) {
    const p = patchForEvent('subscription_updated', { status, customer_id: 42, renews_at: ENDS_2020_06, ends_at: ENDS_2020_06 }, 'sub_1', NOW_EARLY);
    assert.equal(p?.role, 'free', `status ${JSON.stringify(status)} no longer downgrades`);
  }
});

test('D2. `subscription_cancelled` stays RECORD-ONLY: it never writes a role (#134)', () => {
  for (const ends of [ENDS_2020_06, ENDS_2019_06, undefined]) {
    const p = patchForEvent('subscription_cancelled', cancelled(ends), 'sub_1', NOW_EARLY);
    assert.ok(p);
    assert.ok(!('role' in p), 'cancellation wrote a role - it must keep access until the period ends');
    assert.equal(p.ls_status, 'cancelled');
    assert.ok(!('ls_subscription_id' in p), 'a record-only event must not write the subscription id');
  }
  assert.equal(patchForEvent('subscription_cancelled', cancelled(ENDS_2020_06), 'sub_1', NOW_EARLY)?.current_period_end, ENDS_2020_06);
});

test('D3. a failed payment STILL ends access at once - the deliberately opposite decision (2026-08-08)', () => {
  const p = patchForEvent('subscription_payment_failed', { status: 'pending', customer_id: 42 }, 'inv_9', NOW_EARLY);
  assert.equal(p?.role, 'free');
  assert.ok(!('ls_subscription_id' in (p ?? {})), 'the invoice id must never be written as the subscription id');
});

test('D4. an event that is NOT handled writes nothing', () => {
  assert.equal(patchForEvent('subscription_payment_recovered', { status: 'active' }, 'inv_1', NOW_EARLY), null);
  assert.equal(patchForEvent('subscription_resumed', { status: 'active' }, 'sub_1', NOW_EARLY), null);
});

/* ── C. NOT WRITTEN, on purpose: the guard belongs to Fix B and Fix B is not merged ─── */

test.todo('cell C (Fix B, NOT merged): an event for a subscription OTHER than the stored one must not change role, ls_subscription_id, ls_status or current_period_end - today a cancelled OLD subscription still overwrites the id, the status and the period end, and only the role is now correct');
