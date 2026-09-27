/* Pure state -> view choice for the settings Subscription panel (#1396).
 *
 * Pulled out of app/settings/page.tsx so QA can test the branch table without a
 * browser (QA #1435): the panel previously showed a FREE user who still carried
 * a stale subscription id - a failed payment or an expired subscription that left
 * `role` free - "Pro plan / Active", because that case fell through to the last
 * JSX branch. The rule is decided here, once, and tested.
 *
 * Dependency-free and clock-injectable, like lib/paidPeriod.ts. */

export interface SubPanelInput {
  role: string;
  lsStatus: string | null;
  currentPeriodEnd: string | null;
  hasSubscription: boolean;
  /** Server-computed (GET /api/subscription): pro && has id && not cancelled &&
   *  the server can actually call LS. */
  canCancel: boolean;
}

export type SubPanelView =
  | { kind: 'hidden' }                             // nothing to show (free/trial/expired-with-stale-id)
  | { kind: 'cancellable'; untilDate: string | null } // pro, active, LS-backed: offer Cancel; untilDate for the confirm copy
  | { kind: 'cancelled'; untilDate: string | null } // cancelled: access until untilDate (null if past/unknown)
  | { kind: 'managed' }                            // pro with no LS subscription (admin/pre-column grant)
  | { kind: 'active' };                            // pro, LS-backed, but not cancellable (e.g. no API key)

/** A date string only when it is parseable AND in the future - never a past
 *  "access until <yesterday>" (QA #1435). */
export function futureDateOrNull(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t > nowMs ? iso : null;
}

export function subscriptionPanelView(sub: SubPanelInput, nowMs: number = Date.now()): SubPanelView {
  // No live Pro entitlement -> show nothing, even if a stale subscription id
  // lingers from a failed payment or an expired/cancelled-and-ended subscription.
  // Checked BEFORE 'cancelled' (QA #1435 S6): a FREE user whose cancelled sub has
  // already run out must be hidden, not shown "access continues until your period
  // ends". A pro-cancelled-in-grace user is still role 'pro' (Fix A), so they pass
  // this and reach the cancelled branch below.
  if (sub.role !== 'pro') return { kind: 'hidden' };
  // Cancelled but still in grace (role is pro) -> access-until.
  if (sub.lsStatus === 'cancelled') {
    return { kind: 'cancelled', untilDate: futureDateOrNull(sub.currentPeriodEnd, nowMs) };
  }
  // Pro but nothing at LS to cancel -> admin / pre-column grant.
  if (!sub.hasSubscription) return { kind: 'managed' };
  // Pro + LS-backed + cancellable. Carry the (future-only) period end so the
  // cancel-confirm copy can name the real "access until" date, same rule and
  // formatting as the cancelled branch above (owner, 2026-09-27).
  if (sub.canCancel) return { kind: 'cancellable', untilDate: futureDateOrNull(sub.currentPeriodEnd, nowMs) };
  // Pro + LS-backed but not cancellable (server has no API key) -> status, no
  // button; the route would answer 'unavailable'.
  return { kind: 'active' };
}
