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
 * renewal LemonSqueezy sends a payment event and `current_period_end` moves
 * forward; if that event is retried or delayed, a zero-grace check would flip a
 * paying customer to free mid-subscription. Wrongly demoting someone who has
 * paid is far worse than 48 extra hours for someone who has not.
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
