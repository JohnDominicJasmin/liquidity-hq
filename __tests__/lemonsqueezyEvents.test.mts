import test from 'node:test';
import assert from 'node:assert/strict';
import { patchForEvent } from '../lib/lemonsqueezy.ts';

/* The webhook decides who is a paying customer, and per qa/QA_TEST_PLAN.md it
 * has never processed a payload in any environment - payments are not live and
 * no real payload exists to test with. Three weeks from launch that made it the
 * least exercised thing in the product.
 *
 * These cover the DECISION. QA's signed-payload harness covers the route -
 * signature, replay guard, ownership check, the write. Neither replaces the
 * other, and only this half can run today. */

const ACTIVE = { status: 'active', customer_id: 42, renews_at: '2026-09-08T00:00:00Z' };

test('LemonSqueezy event -> subscription row', async (t) => {
  await t.test('an active subscription grants Pro', () => {
    const p = patchForEvent('subscription_created', ACTIVE, 'sub_1');
    assert.equal(p?.role, 'pro');
    assert.equal(p?.ls_subscription_id, 'sub_1');
    assert.equal(p?.ls_customer_id, '42');
    assert.equal(p?.current_period_end, '2026-09-08T00:00:00Z');
  });

  /* OWNER DECISION, 2026-08-08: immediate downgrade, no grace period.
     LemonSqueezy retries a failed renewal for days, so a declined card ends Pro
     on the FIRST failure and restores it if a retry succeeds. That flapping is
     the accepted cost of the decision - if this test ever reads as wrong, the
     decision changed, not the code. */
  await t.test('a failed payment ends access immediately, no grace period', () => {
    const p = patchForEvent('subscription_payment_failed', { status: 'failed' }, 'inv_9');
    assert.equal(p?.role, 'free');
  });

  /* The invoice payload's data.id is an INVOICE id. Writing it into
     ls_subscription_id would silently overwrite the link to the real
     subscription, and nothing downstream would look wrong until someone tried
     to reconcile a customer against LemonSqueezy. */
  await t.test('an invoice id is never written as the subscription id', () => {
    const p = patchForEvent('subscription_payment_failed', { status: 'failed' }, 'inv_9');
    assert.equal(p?.ls_subscription_id, undefined);
  });

  await t.test('an order id is never written as the subscription id either', () => {
    const p = patchForEvent('order_refunded', { status: 'refunded' }, 'order_7');
    assert.equal(p?.ls_subscription_id, undefined);
    assert.equal(p?.role, 'free');
  });

  /* ASSUMPTION, NOT A DECISION - the owner answered failed payments only.
     Refunding means the money went back, so the customer is not one. If that is
     wrong, this test is where it is written down and the fix is one line in
     ENDS_ACCESS. */
  await t.test('a refund ends access (stated assumption, not an owner decision)', () => {
    assert.equal(patchForEvent('subscription_payment_refunded', { status: 'refunded' })?.role, 'free');
  });

  /* past_due is what LemonSqueezy sets the SUBSCRIPTION to when a renewal
     fails, and it fires subscription_updated for it. So the downgrade has two
     independent routes. They agree, which is what makes it safe - if
     custom_data does not survive onto invoice events (unverified, payments are
     not live), this path still ends access. */
  await t.test('past_due via subscription_updated downgrades too', () => {
    assert.equal(patchForEvent('subscription_updated', { status: 'past_due' })?.role, 'free');
  });

  await t.test('expiry ends access', () => {
    assert.equal(patchForEvent('subscription_expired', { status: 'expired' })?.role, 'free');
  });

  /* Records today's behaviour, which issue #134 says is wrong: LemonSqueezy
     "cancelled" means auto-renew off, and the user keeps access until ends_at.
     Asserting it keeps the defect visible instead of letting it read as
     intended. When #134 is decided this test changes with the code. */
  await t.test('cancellation downgrades immediately - see #134, this is the defect', () => {
    assert.equal(patchForEvent('subscription_cancelled', { status: 'cancelled' })?.role, 'free');
  });

  /* null, not an empty patch. The caller skips the database write entirely on
     null; a patch would mean "write these columns", and an event we do not
     understand must not touch the row. */
  await t.test('an unknown event returns null so nothing is written', () => {
    assert.equal(patchForEvent('order_created', { status: 'paid' }, 'order_1'), null);
    assert.equal(patchForEvent('', {}), null);
  });

  await t.test('a missing status never becomes the string "undefined"', () => {
    assert.equal(patchForEvent('subscription_created', {}, 'sub_2')?.ls_status, '');
    // Falls back to the event name, which records WHY the row changed.
    assert.equal(patchForEvent('subscription_payment_failed', {})?.ls_status, 'payment_failed');
  });

  await t.test('a missing renewal date is null, not undefined', () => {
    assert.equal(patchForEvent('subscription_created', { status: 'active' }, 's')?.current_period_end, null);
  });

  /* ends_at is the fallback for a subscription with no renewal date - one that
     is cancelled but still running. Order matters: renews_at wins. */
  await t.test('ends_at is used when there is no renews_at', () => {
    const p = patchForEvent('subscription_updated', { status: 'active', ends_at: '2026-10-01T00:00:00Z' }, 's');
    assert.equal(p?.current_period_end, '2026-10-01T00:00:00Z');
  });
});
