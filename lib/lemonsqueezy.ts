/* What a LemonSqueezy webhook event means for a user's subscription row.
 *
 * Pulled out of the route handler because of the reason this file exists at all:
 * per qa/QA_TEST_PLAN.md the webhook "has never been tested, payments aren't
 * live, no real webhook payload exists to test with". The 114 lines that decide
 * who is a paying customer had never run against a payload in ANY environment.
 *
 * A pure function can be tested today, with no database, no signature, and no
 * LemonSqueezy account. That does not replace QA's signed-payload harness - the
 * harness proves the route verifies, dedupes and writes; this proves the
 * decision itself. Different halves.
 */

export type SubscriptionRole = 'pro' | 'free';

/** The columns an event implies. `user_id` and `updated_at` are the caller's. */
export interface SubscriptionPatch {
  role: SubscriptionRole;
  ls_status: string;
  ls_subscription_id?: string;
  ls_customer_id?: string;
  current_period_end?: string | null;
}

/** The subset of a payload's `data.attributes` this decision reads. */
export interface EventAttributes {
  status?: unknown;
  customer_id?: unknown;
  renews_at?: unknown;
  ends_at?: unknown;
}

/* Events whose payload `data` IS the subscription, so its id is the
   subscription id and `status` is the subscription's status. */
const SUBSCRIPTION_EVENTS = new Set([
  'subscription_created',
  'subscription_updated',
  'subscription_payment_success',
]);

/* Events that end access immediately.
 *
 * `subscription_payment_failed` is here by an owner decision on 2026-08-08:
 * immediate downgrade, no grace period. LemonSqueezy retries a failed renewal
 * for several days before giving up, so a user whose card declines loses Pro on
 * the first failure and regains it if a retry succeeds. That flapping is the
 * accepted cost of the decision, not an oversight.
 *
 * The refund events are here under a STATED ASSUMPTION rather than a decision:
 * the money has been returned, so the customer is not one. Reverse this if the
 * owner disagrees - it is one line and the tests name it explicitly.
 *
 * `subscription_expired` is the genuine end of a paid period.
 *
 * `subscription_cancelled` is NOT here and its presence in the same branch as
 * `expired` in the route is a defect - see issue #134. Cancellation means
 * auto-renew off, not access ended, and downgrading on it takes back a period
 * the user has already paid for. Left alone deliberately: fixing it needs
 * getEntitlement() to end access at current_period_end, which is not this
 * change. */
const ENDS_ACCESS = new Set([
  'subscription_payment_failed',
  'subscription_payment_refunded',
  'order_refunded',
  'subscription_cancelled',
  'subscription_expired',
]);

/**
 * The row change an event implies, or `null` for an event we do not act on.
 *
 * Returning null rather than a no-op patch matters: the caller must be able to
 * tell "this event means nothing to us" from "this event means stay as you
 * are", because only the first should skip the write entirely.
 *
 * @param dataId `event.data.id`. Only written as `ls_subscription_id` for the
 *   events whose data IS a subscription. On `subscription_payment_failed` the
 *   payload is a subscription INVOICE and on `order_refunded` it is an ORDER,
 *   so `data.id` is an invoice/order id - writing it into `ls_subscription_id`
 *   would silently corrupt the link to the real subscription.
 */
export function patchForEvent(
  eventName: string,
  attrs: EventAttributes = {},
  dataId?: string,
): SubscriptionPatch | null {
  const status = typeof attrs.status === 'string' ? attrs.status : '';

  if (SUBSCRIPTION_EVENTS.has(eventName)) {
    return {
      // Any status other than 'active' means no Pro. LemonSqueezy uses
      // 'past_due' the moment a renewal fails, so this path can downgrade too -
      // which is consistent with the decision, not a second opinion on it.
      role:               status === 'active' ? 'pro' : 'free',
      ls_status:          status,
      ls_subscription_id: dataId ?? '',
      ls_customer_id:     attrs.customer_id == null ? '' : String(attrs.customer_id),
      current_period_end: pickDate(attrs.renews_at) ?? pickDate(attrs.ends_at) ?? null,
    };
  }

  if (ENDS_ACCESS.has(eventName)) {
    return {
      role: 'free',
      // An invoice/order payload's `status` describes the invoice ('failed',
      // 'refunded'), not the subscription - so fall back to the event name,
      // which is the more truthful record of why the row changed.
      ls_status: status || eventName.replace('subscription_', ''),
    };
  }

  return null;
}

function pickDate(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
