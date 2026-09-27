/* The time-based backstop on a PAID entitlement (#373).
 *
 * Lives in its own module rather than inside lib/entitlements.ts because that
 * file imports `@supabase/supabase-js` and the `@/lib` path alias, neither of
 * which the unit-test runner can resolve - so anything defined there is
 * untestable without a bundler. Third time this week that the logic which
 * decides something important could not be tested where it sat
 * (see lib/searchTriggers.ts, lib/perpSpot.ts#perpNoticeTone).
 *
 * Pure, dependency-free, and the only thing standing between a missed webhook
 * and an account that keeps Pro forever.
 */

export type PaidRole = 'free' | 'pro';

/* How long a paid period may be lapsed before the backstop demotes.
 *
 * NOT a policy about giving away access - it is slack for a LATE RENEWAL. On
 * renewal `current_period_end` moves forward when LemonSqueezy sends
 * `subscription_updated` with the new `renews_at` (lib/lemonsqueezy.ts's
 * SUBSCRIPTION_EVENTS branch writes it); if that event is retried or delayed, a
 * zero-grace check would flip a paying customer to free mid-subscription.
 * Wrongly demoting someone who has paid is far worse than 48 extra hours for
 * someone who has not.
 *
 * WHICH EVENT MOVES THE DATE (#1422). It is `subscription_updated`, NOT
 * `subscription_payment_success`. This comment used to name "a payment event",
 * and that was wrong twice over: the payment_success payload is an invoice with
 * no `renews_at`/`ends_at`, so it never moved this date forward - before #1422
 * it wrote null, WIPING it - and it is now ignored entirely. So this backstop
 * depends on `subscription_updated` firing on RENEWAL, which is observed on a
 * first payment but UNVERIFIED for renewals (the test subscription has not
 * renewed). If it does not fire, a paying subscriber is demoted 48h after their
 * period ends - the grace below is the buffer, and #1422 tracks verifying it at
 * the first real renewal.
 *
 * The number is mine, not the owner's, and #311 established that a threshold we
 * invent is one nobody can verify - so it is named, exported and tested rather
 * than inlined, and flagged on #373 for them to set. */
export const PAID_GRACE_MS = 48 * 60 * 60 * 1000;

/**
 * True when a paid period has lapsed far enough to stop granting Pro.
 *
 * FAILS TOWARDS ACCESS ON PURPOSE. It demotes only when there is a real, past
 * timestamp to demote against:
 *
 *   null / absent   NO demotion - lifetime grants, admin-set Pro and every row
 *                   written before this column existed have no period. Measured
 *                   before writing this: the only `pro` row on the dev project
 *                   has current_period_end NULL, so treating null as expired
 *                   would have locked out QA's pinned Pro fixture and broken
 *                   entitlements.spec.ts.
 *   unparseable     NO demotion - NaN comparisons are false anyway; the explicit
 *                   isFinite check says so rather than relying on it.
 *   in the future   NO demotion.
 *   past + grace    demote.
 */
export function paidPeriodLapsed(
  role: PaidRole,
  currentPeriodEnd: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (role !== 'pro' || !currentPeriodEnd) return false;
  const end = new Date(currentPeriodEnd).getTime();
  if (!Number.isFinite(end)) return false;
  return end + PAID_GRACE_MS < nowMs;
}
