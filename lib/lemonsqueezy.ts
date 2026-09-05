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

/** The columns an event implies. `user_id` and `updated_at` are the caller's.
 *
 *  `role` is OPTIONAL, and its absence is meaningful: it means "record what
 *  happened, do not change entitlement". Omitting a column from a Supabase
 *  upsert leaves it out of the ON CONFLICT update set, so an existing row keeps
 *  its role. (A row that does not exist gets the column default, `'free'` -
 *  which is the right answer for someone with no subscription row anyway.) */
export interface SubscriptionPatch {
  role?: SubscriptionRole;
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

/* TWO OWNER DECISIONS, DELIBERATELY OPPOSITE. Both dated 2026-08-08.
 *
 *   subscription_payment_failed  -> they did NOT pay -> end access immediately
 *   subscription_cancelled       -> they DID pay     -> keep access to ends_at
 *
 * The two branches look interchangeable and the second used to share a branch
 * with `subscription_expired`, which is exactly how issue #134 happened. If you
 * are about to merge them back together, this comment is why not.
 *
 * Events that end access immediately:
 *
 * `subscription_payment_failed` - LemonSqueezy retries a failed renewal for
 * several days before giving up, so a declining card loses Pro on the FIRST
 * failure and regains it if a retry succeeds. That flapping is the accepted
 * cost of "no grace period", not an oversight.
 *
 * The refund events are here under a STATED ASSUMPTION rather than a decision:
 * the money has been returned, so the customer is not one. One line to reverse,
 * and the tests name it explicitly.
 *
 * `subscription_expired` is the genuine end of a paid period - and it is the
 * ONLY event that ends a cancelled subscription. Verified against LemonSqueezy's
 * documentation 2026-08-08: a cancelled subscription stays valid on a grace
 * period until `ends_at`, then expires and fires this event. So removing
 * `subscription_cancelled` from this set does not strand anyone as `pro` -
 * that was the risk QA raised on #134, and it is the fact the whole fix rests
 * on. */
const ENDS_ACCESS = new Set([
  'subscription_payment_failed',
  'subscription_payment_refunded',
  'order_refunded',
  'subscription_expired',
]);

/* Events worth RECORDING that must not change entitlement.
 *
 * Cancellation in LemonSqueezy means auto-renew was turned off. The user has
 * paid through `ends_at` and keeps access until then. Downgrading here took
 * back a period they had already bought (#134).
 *
 * It is not simply ignored, because the row should carry `ls_status:
 * 'cancelled'` and the date access actually ends - that is what support and
 * `/ops` read, and dropping the event would leave a cancelled subscription
 * indistinguishable from an active one until it expired. */
const RECORD_ONLY = new Set([
  'subscription_cancelled',
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

  if (RECORD_ONLY.has(eventName)) {
    // No `role`. The user keeps what they have until `subscription_expired`.
    return {
      ls_status: status || eventName.replace('subscription_', ''),
      // ends_at is when access actually stops. renews_at is null on a cancelled
      // subscription - there is no renewal - so this is the only date left.
      current_period_end: pickDate(attrs.ends_at) ?? null,
    };
  }

  return null;
}

function pickDate(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/* ── The two gates in front of patchForEvent ──────────────────────────────────
 *
 * This file's header says the route's harness "proves the route verifies,
 * dedupes and writes; this proves the decision itself. Different halves." Two
 * of those three are pure and were only reachable through a live endpoint with
 * a real secret and a real database - so they had no tests at all, while the
 * decision they guard had eleven.
 *
 * Verification and ownership move here. Dedup and the write stay in the route:
 * both need the database and neither can be honestly faked.
 */

import crypto from 'crypto';

/** Does this body carry LemonSqueezy's HMAC for our secret?
 *
 *  FAILS CLOSED IN EVERY DIRECTION, and each guard is a real case rather than
 *  defensive noise:
 *
 *  - **No secret configured** returns false. An unset env var must not become
 *    an open endpoint - on a public repo that is the difference between a
 *    misconfiguration and anyone being able to grant themselves Pro.
 *  - **`timingSafeEqual` throws on length mismatch**, which a wrong-length or
 *    non-hex signature produces. Caught, not propagated: a 500 tells an
 *    attacker their input reached further than a 401 does, and LemonSqueezy
 *    RETRIES a 500.
 *  - **Constant-time compare**, not `===`. The digest is derived from
 *    attacker-supplied bytes, so an early-exit comparison leaks how much of a
 *    guessed prefix was right.
 *
 *  Buffer.from(x, 'hex') silently drops invalid characters rather than
 *  throwing, so a signature of "zz" becomes an empty buffer and the length
 *  check is what rejects it. That is why the try/catch is load-bearing and not
 *  belt-and-braces. */
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(digest, 'hex'));
  } catch {
    return false;
  }
}

/** Does the payer own the account the checkout named?
 *
 *  THE SIGNATURE PROVES LEMONSQUEEZY SENT THIS. IT NEVER PROVES THE PAYER OWNS
 *  THE ACCOUNT THEY NAMED. `custom_data.user_id` is written into a CLIENT-SIDE
 *  checkout URL by lib/checkout.ts, so the payer chooses it: edit the id in
 *  your own browser, make one genuine purchase, and Pro lands on any account
 *  you like. This comparison is the only thing between that and a working
 *  attack.
 *
 *  Empty on either side is a refusal, not a pass. An account with no email and
 *  a payer with no email are not "the same"; that is the shape where a missing
 *  lookup silently authorises everything. */
export function payerOwnsAccount(payerEmail: string | null | undefined, accountEmail: string | null | undefined): boolean {
  const payer = String(payerEmail ?? '').trim().toLowerCase();
  const account = String(accountEmail ?? '').trim().toLowerCase();
  if (!payer || !account) return false;
  return payer === account;
}
