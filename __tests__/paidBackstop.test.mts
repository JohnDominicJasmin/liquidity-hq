/* #373 - the time-based backstop on a PAID entitlement.
 *
 * Trial expiry was already time-enforced; paid expiry was event-enforced, so a
 * missed `subscription_expired` webhook granted Pro forever. These pin both
 * directions, and the "must NOT demote" cases matter more than the demoting
 * one: wrongly demoting someone who has paid is the expensive failure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paidPeriodLapsed, PAID_GRACE_MS } from '../lib/paidPeriod.ts';

const NOW = Date.UTC(2026, 7, 13, 12, 0, 0);
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();
const DAY = 86_400_000;

/* ── 1. what the issue asked for ─────────────────────────────────────────── */

test('a paid period long past demotes to free', () => {
  assert.equal(paidPeriodLapsed('pro', iso(-30 * DAY), NOW), true);
});

test('the grace window is respected on both sides of its edge', () => {
  // Just inside grace - still Pro. A renewal webhook is allowed to be late.
  assert.equal(paidPeriodLapsed('pro', iso(-PAID_GRACE_MS + 60_000), NOW), false);
  // Just outside - demoted.
  assert.equal(paidPeriodLapsed('pro', iso(-PAID_GRACE_MS - 60_000), NOW), true);
});

/* ── 2. every way it must NOT demote ─────────────────────────────────────── */

test('NULL period never demotes - this is the one that would break production', () => {
  // Measured before the code was written: the only `pro` row on the dev project
  // has current_period_end NULL. Treating null as expired would have locked out
  // QA's pinned Pro fixture and every admin-granted or legacy Pro account.
  assert.equal(paidPeriodLapsed('pro', null, NOW), false);
  assert.equal(paidPeriodLapsed('pro', undefined, NOW), false);
  assert.equal(paidPeriodLapsed('pro', '', NOW), false);
});

test('an unparseable timestamp never demotes', () => {
  // NaN comparisons are false regardless, but a future refactor could invert
  // the condition and turn "we cannot read this date" into "revoke access".
  assert.equal(paidPeriodLapsed('pro', 'not-a-date', NOW), false);
});

test('a period in the future never demotes', () => {
  assert.equal(paidPeriodLapsed('pro', iso(30 * DAY), NOW), false);
});

test('a free account is never touched by this check', () => {
  // It has nothing to demote FROM, and a stale period on a free row must not
  // become an input to anything.
  assert.equal(paidPeriodLapsed('free', iso(-365 * DAY), NOW), false);
});

/* ── 3. control ──────────────────────────────────────────────────────────── */

test('CONTROL: the function can return both values', () => {
  // Without this, every assertion above passes against `() => false`, which is
  // exactly the shape of a backstop that silently does nothing.
  const results = new Set([
    paidPeriodLapsed('pro', iso(-30 * DAY), NOW),
    paidPeriodLapsed('pro', iso(30 * DAY), NOW),
  ]);
  assert.equal(results.size, 2, 'the backstop never demotes - it is not a backstop');
  assert.ok(PAID_GRACE_MS > 0, 'sanity: the grace window is a real duration');
});
