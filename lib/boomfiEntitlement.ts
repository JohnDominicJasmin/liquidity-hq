/* What a BoomFi event means for an account's plan. (#861, Phase 1b)
 *
 * NOTHING CALLS THIS YET, AND THAT IS THE POINT OF ITS SHAPE.
 *
 * The decision has two halves. One half needs a real BoomFi payload and cannot
 * be written without one: finding, in the body, which account the payment is
 * for, which subscription it belongs to, and when the paid period ends. BoomFi
 * publishes no example body, and guessing a payload's shape is how a successful
 * payment came to revoke Pro here (#1422). That half - the EXTRACTOR - is not
 * in this file and does not exist.
 *
 * The other half needs no payload at all: once those facts are known, what
 * should happen? That is policy, most of it already decided by the owner for
 * Lemon Squeezy, and it is what this file holds. It takes the facts as plain
 * values (BoomfiFacts), so it can be tested today against every case, and the
 * extractor written later only has to produce those values honestly.
 *
 * THE RULES, and where each comes from:
 *
 * 1. NO ACCOUNT, NO GRANT. The account id travels on the payment link as
 *    `customer_ident` (lib/checkout.ts). If it does not come back, is not an
 *    account id, or names an account that does not exist, the payment is
 *    UNMATCHED: nothing is granted, and it is reported for a person to settle.
 *    A payment must never be dropped silently - the buyer has paid.
 *
 * 2. THE ID SAYS WHO TO CREDIT, NOT WHO PAID. It is set in the buyer's browser.
 *    A payer whose checkout email differs from the account's is still credited
 *    to the account the link named - paying for another account harms nobody,
 *    and refusing a genuine buyer who typed a second email costs a sale and a
 *    support thread. The difference is returned as a note so it is visible.
 *    (Lemon Squeezy's handler refuses on a mismatch. This is a deliberate
 *    difference, flagged on #861 for the owner rather than settled here.)
 *
 * 3. A GRANT NEEDS AN END DATE. Pro with no period end never lapses
 *    (lib/paidPeriod.ts treats a missing date as "no demotion", for admin
 *    grants). So an active subscription whose paid-through date is missing or
 *    unreadable is REPORTED, not granted: a person grants it, rather than the
 *    code creating an account that stays Pro forever if the webhooks stop.
 *
 * 4. CANCELLED KEEPS WHAT WAS PAID FOR. Owner's decision (2026-08-08 for Lemon
 *    Squeezy, confirmed for cancel-a-plan 2026-09-26, applied to BoomFi by
 *    PM/DevOps 2026-09-30): a cancellation turns off renewal; access runs to
 *    the end of the paid period. With a readable end date, Pro holds while it
 *    is in the future. Without one, the stored role and date are left exactly
 *    as they are - never revoked on a guess, never extended on one.
 *
 * 5. OVERDUE CHANGES NOTHING, AND IS REPORTED. PM/DevOps' ruling for the
 *    owner, 2026-09-30 (#861): do not end access on the word alone. Nobody has
 *    seen what BoomFi's overdue means - how it collects a renewal is not
 *    documented, so it may not mean what a declined card means. An overdue
 *    event grants nothing and extends nothing; access still ends at the
 *    paid-through date already stored, through lib/paidPeriod.ts. The event is
 *    reported so a person sees it. Revisit once a real one has been recorded.
 *    (For Lemon Squeezy the owner's 2026-08-08 rule is the opposite: a failed
 *    payment ends access at once. That rule is NOT carried over by analogy.)
 *
 * 6. ONE ACTIVE PLAN PER ACCOUNT. Owner's rule, 2026-09-25 (#1396). An active
 *    BoomFi subscription arriving for an account that already holds a live plan
 *    on a DIFFERENT subscription (another BoomFi one, or Lemon Squeezy) is
 *    reported and not written: two live plans is a billing error to refund by
 *    hand, not something to overwrite. A non-active event for a different
 *    subscription is ignored, so an old subscription ending cannot disturb the
 *    live one (the #1429 defect).
 */
import { paidPeriodLapsed } from './paidPeriod.ts';

/** What the event says happened to the subscription. Produced by the extractor
 *  from a real payload; the names are ours, not BoomFi's. */
export type BoomfiState = 'active' | 'cancelled' | 'overdue' | 'ended';

/** The facts the decision needs, already read out of a verified event that has
 *  passed the organisation check. Every field may be missing. */
export interface BoomfiFacts {
  state: BoomfiState;
  /** `customer_ident` as it came back - expected to be our account id. */
  accountId: string | null;
  /** The email the payer typed at BoomFi's checkout. */
  payerEmail: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  /** End of the period already paid for, as an ISO timestamp. */
  paidThrough: string | null;
}

/** The account the id resolved to, or null when no such account exists. */
export interface BoomfiAccount {
  id: string;
  email: string | null;
}

/** The subscription row as stored, reduced to what the decision reads. */
export interface StoredPlan {
  role: 'free' | 'pro';
  /** 'boomfi', 'lemonsqueezy', or null for a row older than the column. */
  provider: string | null;
  /** The id of the subscription the row belongs to, whichever provider. */
  subscriptionId: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
}

/** What to write. `role` and `currentPeriodEnd` are OPTIONAL and their absence
 *  means "leave the stored value alone", as in lib/lemonsqueezy.ts. */
export interface BoomfiPatch {
  provider: 'boomfi';
  status: BoomfiState;
  subscriptionId: string;
  customerId: string | null;
  role?: 'free' | 'pro';
  currentPeriodEnd?: string | null;
}

export type BoomfiDecision =
  | { action: 'apply'; patch: BoomfiPatch; note?: 'payer_email_differs' }
  | { action: 'unmatched'; reason: string }   // paid, but no account to credit: a person settles it
  | { action: 'report'; reason: string }      // matched, but must not be written automatically
  | { action: 'ignore'; reason: string };     // nothing to do, and nothing wrong

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Is this string shaped like one of our account ids? Checked before any
 *  lookup, so a stray value is never sent to the database as an id. */
export function looksLikeAccountId(v: string | null | undefined): v is string {
  return typeof v === 'string' && UUID.test(v.trim());
}

function parseMs(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string' || iso.length === 0) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

const sameEmail = (a: string | null, b: string | null): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * PURE. The caller has verified the signature, checked the organisation,
 * produced `facts` from the body, looked the account up (`account`) and read
 * its stored row (`stored`, null when there is none).
 */
export function decideBoomfiEntitlement(
  facts: BoomfiFacts,
  account: BoomfiAccount | null,
  stored: StoredPlan | null,
  nowMs: number = Date.now(),
): BoomfiDecision {
  // ── Rule 1: no account, no grant ─────────────────────────────────────────
  if (!facts.accountId) {
    return { action: 'unmatched', reason: 'the event carries no account id (customer_ident did not come back)' };
  }
  if (!looksLikeAccountId(facts.accountId)) {
    return { action: 'unmatched', reason: 'the account id on the event is not shaped like one of ours' };
  }
  if (!account || account.id.toLowerCase() !== facts.accountId.trim().toLowerCase()) {
    return { action: 'unmatched', reason: 'the account id on the event names no account' };
  }

  // An event we cannot tie to a subscription cannot be weighed against the
  // stored one (rule 6), so it is never written.
  if (!facts.subscriptionId) {
    return { action: 'report', reason: 'the event carries no subscription id; not acting' };
  }

  // ── Rule 6: one active plan per account ──────────────────────────────────
  const storedSubId = stored?.subscriptionId || '';
  const sameSubscription = storedSubId !== ''
    && stored?.provider === 'boomfi'
    && storedSubId === facts.subscriptionId;
  const storedLive = !!stored
    && stored.role === 'pro'
    && storedSubId !== ''   // an admin grant has no subscription to protect
    && !paidPeriodLapsed('pro', stored.currentPeriodEnd, nowMs);

  if (storedLive && !sameSubscription) {
    if (facts.state === 'active') {
      // A resubscribe while the old one runs out its cancelled period takes over.
      if (stored!.status !== 'cancelled') {
        return { action: 'report', reason: 'a second active subscription while the stored one is still live (one active plan per account); not overwriting - refund by hand' };
      }
    } else {
      return { action: 'ignore', reason: 'event for a different, non-active subscription must not disturb the live one' };
    }
  }

  const base = {
    provider: 'boomfi' as const,
    status: facts.state,
    subscriptionId: facts.subscriptionId,
    customerId: facts.customerId,
  };
  const note = facts.payerEmail && account.email && !sameEmail(facts.payerEmail, account.email)
    ? { note: 'payer_email_differs' as const }   // rule 2: visible, not a refusal
    : {};
  const endMs = parseMs(facts.paidThrough);

  switch (facts.state) {
    case 'active': {
      // Rule 3: a grant needs an end date, and one that has not already passed.
      if (endMs === null) {
        return { action: 'report', reason: 'active subscription with no readable paid-through date; granting would create Pro that never lapses' };
      }
      if (endMs <= nowMs) {
        return { action: 'report', reason: 'active subscription whose paid-through date is already past; not granting' };
      }
      return { action: 'apply', patch: { ...base, role: 'pro', currentPeriodEnd: facts.paidThrough }, ...note };
    }
    case 'cancelled': {
      // Rule 4: keep what was paid for.
      if (endMs !== null) {
        return { action: 'apply', patch: { ...base, role: endMs > nowMs ? 'pro' : 'free', currentPeriodEnd: facts.paidThrough }, ...note };
      }
      // No date on the event: record the cancellation, leave role and date alone.
      return { action: 'apply', patch: { ...base }, ...note };
    }
    case 'overdue':
      // Rule 5: nothing is written. The stored paid-through date still ends access.
      return { action: 'report', reason: 'subscription reported overdue; nothing granted, extended or revoked - access ends at the stored paid-through date' };
    case 'ended':
      return { action: 'apply', patch: { ...base, role: 'free' }, ...note };
    default:
      return { action: 'report', reason: 'unrecognised subscription state; not acting' };
  }
}
