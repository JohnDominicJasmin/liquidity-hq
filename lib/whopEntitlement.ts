/* What a verified Whop event means for an account (#1567, Phase 3). PURE: no database, no network, no clock; the only outside input is
 * the environment (the plan ids), passed in so a test can set it.
 *
 * TWO HALVES:
 *
 *   1. decideWhopPayment() - the RULES, written over a small normalised record (WhopPayment). They come from the accepted plan and the
 *      owner's rulings on #1567:
 *        - Only a PAID payment for a known plan, with a charged amount above zero, in USD, with a payer email, can grant.
 *        - Which plan = the Whop PLAN ID, by exact table read from WHOP_PLAN_ID_* (different per environment: the Whop sandbox on qa,
 *          the live account on prod). NOT the amount: a promo changes the amount and would send a real paying
 *          customer to review (BoomFi maps by amount; Whop does not).
 *        - The hidden $1 test plan is RECORD ONLY. It is not a Pro plan and never becomes one.
 *        - An unknown plan id is review, never rounded to the nearest plan.
 *        - Until when = computed here from the payment moment (extendedPeriodEnd). No Whop period field is read.
 *        - Membership events, a failed payment, a cancel, an expiry, a refund, a dispute: NOTHING IS REVOKED (owner rulings: all sales are
 *          final, paid time runs to its end, then lib/paidPeriod.ts demotes). A refund or dispute is reported for a person, never acted on.
 *        - $0 / 100% promo / hand-added members get no Pro (owner ruling): review.
 *
 *   2. readWhopPayment() - the FIELD PATHS. Written from Whop's OFFICIAL documentation (owner go-ahead 2026-10-20), NOT from a recorded
 *      body, because none existed when this was written. The last time this project acted on an inferred payload shape a successful
 *      payment revoked Pro (#1422), so the reader is DEFENSIVE: every field is type-checked, a missing or oddly typed field is null,
 *      and a null where a rule needs a value is REVIEW, never a default and never a crash. The documented sources:
 *        - webhook envelope:  https://docs.whop.com/developer/guides/webhooks.md  (id msg_..., type "resource.action", data, account_id or
 *          company_id = the biz_... id, timestamp). The Payment object inside `data` for payment.succeeded:
 *        - Payment object:    https://docs.whop.com/api-reference/payments/retrieve-payment.md  (id pay_..., status "paid", substatus
 *          "succeeded", total / usd_total as numbers, currency lowercase, user.email (needs the member:email:read permission, null
 *          without it), plan.id, company.id, billing_reason, refunded_amount).
 *      NOT in the docs, so NOT relied on: whether Payment amounts are dollars or cents (the code only asks "above zero", never "equals
 *      49"), a full example body for payment.succeeded, and the membership.* payloads (they never grant or revoke here, so their shape
 *      does not matter). The owner's $1 test purchase (hidden plan, record only) is the first REAL body: compare it with this reader.
 *
 * Anything refused is { kind: 'review', reason } so the route can report it for a human. Never silently dropped, never guessed. */

import { extendedPeriodEnd } from './boomfiEntitlement.ts';

export { extendedPeriodEnd };

export type WhopPlan = 'monthly' | 'annual' | 'fortnightly';

export type WhopPlanTable = Readonly<Record<string, { plan: WhopPlan; add: { months?: number; days?: number } }>>;

/** What ONE payment of each plan buys. */
const PLAN_PERIODS: Record<WhopPlan, { months?: number; days?: number }> = {
  monthly: { months: 1 },
  annual: { months: 12 },
  fortnightly: { days: 14 },
};

/** The hidden $1/month plan the owner made to record a real delivery (#1567). It is NOT a Pro plan and must never be a Pro plan id, in
 *  any environment: a payment on it is recorded and answered, and changes nothing. Another environment's record-only plan (the Whop
 *  sandbox's copy) is set with WHOP_TEST_PLAN_ID. */
export const WHOP_TEST_PLAN_ID = 'plan_Lt14d8fRCCBIa';

/** The plan ids that are record-only in this environment. */
export function whopTestPlanIds(env: Record<string, string | undefined> = process.env): string[] {
  const extra = (env.WHOP_TEST_PLAN_ID ?? '').trim();
  return extra ? [WHOP_TEST_PLAN_ID, extra] : [WHOP_TEST_PLAN_ID];
}

/** The Pro plans for THIS environment, from server-side settings (the ids in each checkout link): WHOP_PLAN_ID_MONTHLY / _ANNUAL /
 *  _FORTNIGHTLY. Not hardcoded, because the Whop sandbox (qa) and the live account (prod) have different ids. An unset plan is simply
 *  absent from the table, so its payments are unknown-plan REVIEW, never a grant. The table refuses to be ambiguous: an id given to
 *  two plans, or equal to a record-only test plan, is dropped from it. */
export function whopPlanTable(env: Record<string, string | undefined> = process.env): WhopPlanTable {
  const wanted: Array<[string, WhopPlan]> = [
    [(env.WHOP_PLAN_ID_MONTHLY ?? '').trim(), 'monthly'],
    [(env.WHOP_PLAN_ID_ANNUAL ?? '').trim(), 'annual'],
    [(env.WHOP_PLAN_ID_FORTNIGHTLY ?? '').trim(), 'fortnightly'],
  ];
  const testIds = new Set(whopTestPlanIds(env));
  const table: Record<string, { plan: WhopPlan; add: { months?: number; days?: number } }> = {};
  for (const [id, plan] of wanted) {
    if (!id || testIds.has(id)) continue;
    if (wanted.filter(([other]) => other === id).length > 1) continue;
    table[id] = { plan, add: PLAN_PERIODS[plan] };
  }
  return table;
}

/** What readWhopPayment() lifts out of a verified body. Every field is null when the body does not carry it: a missing field is a
 *  review, never a default. */
export interface WhopPayment {
  /** What the event IS, as far as access is concerned. 'other' = any event name this code does not know. */
  kind: 'payment_succeeded' | 'payment_failed' | 'membership' | 'refund' | 'dispute' | 'other';
  /** The event name as Whop sent it (stored as the row's `event`, and the key the replay check uses). */
  eventName: string | null;
  paymentId: string | null;
  planId: string | null;
  /** The amount actually charged, in major units (49, not 4900). */
  amount: number | null;
  currency: string | null;
  /** True only when the body says the money arrived (status "paid" and no contradicting substatus). Anything else is review. */
  paid: boolean | null;
  payerEmail: string | null;
  /** The company/business id the event belongs to, if the body carries one. */
  companyId: string | null;
}

export type WhopDecision =
  | { kind: 'grant'; plan: WhopPlan; add: { months?: number; days?: number }; paymentId: string; payerEmail: string; planId: string }
  | { kind: 'ignore'; reason: string }
  | { kind: 'review'; reason: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Whop event name to what it means for access. Unknown names are 'other' (recorded, not acted on). */
function kindForType(type: string | null): WhopPayment['kind'] {
  if (!type) return 'other';
  if (type === 'payment.succeeded') return 'payment_succeeded';
  if (type === 'payment.failed') return 'payment_failed';
  if (type.startsWith('membership.')) return 'membership';
  if (type.startsWith('refund.')) return 'refund';
  if (type.startsWith('dispute.') || type.startsWith('resolution.')) return 'dispute';
  return 'other';
}

/** Lifts the fields out of a verified body, per the documented shapes in the header. NEVER THROWS: a body of any other shape yields
 *  nulls, which the rules turn into review. Returns null only when the body has no event type at all. */
export function readWhopPayment(event: Record<string, unknown>): WhopPayment | null {
  try {
    const type = str(event.type);
    if (!type) return null;
    const kind = kindForType(type);
    const data = obj(event.data);
    const user = obj(data?.user);
    const plan = obj(data?.plan);
    const company = obj(data?.company);

    // The amount: usd_total is documented as the total in USD, so it needs no currency question. Otherwise total counts only when the
    // payment's own currency is usd. Dollars vs cents is not documented, and nothing here depends on it (only "above zero" is asked).
    const usdTotal = num(data?.usd_total);
    const currencyRaw = str(data?.currency);
    const total = num(data?.total);
    const amount = usdTotal !== null ? usdTotal : (currencyRaw && currencyRaw.toLowerCase() === 'usd' ? total : null);
    const currency = usdTotal !== null ? 'USD' : currencyRaw;

    // "paid" is the documented status of a succeeded payment. A substatus that says refunded/disputed/failed contradicts it.
    const status = str(data?.status);
    const substatus = str(data?.substatus);
    const contradicted = substatus !== null && substatus !== 'succeeded';
    const paid = status === null ? null : status === 'paid' && !contradicted;

    return {
      kind,
      eventName: type,
      paymentId: str(data?.id),
      planId: str(plan?.id),
      amount,
      currency,
      paid,
      payerEmail: str(user?.email),
      companyId: str(company?.id) ?? str(event.account_id) ?? str(event.company_id),
    };
  } catch {
    return null;
  }
}

export function decideWhopPayment(p: WhopPayment, env: Record<string, string | undefined> = process.env): WhopDecision {
  // Access never moves on these. A refund or dispute is reported so a person sees it (owner: all sales final, never revoke).
  if (p.kind === 'refund' || p.kind === 'dispute') return { kind: 'review', reason: `${p.kind}_flagged_not_revoked` };
  if (p.kind === 'payment_failed') return { kind: 'ignore', reason: 'failed_payment_keeps_paid_time' };
  if (p.kind === 'membership') return { kind: 'ignore', reason: 'membership_event_never_grants_or_revokes' };
  if (p.kind !== 'payment_succeeded') return { kind: 'ignore', reason: 'not_a_payment_confirmation' };

  if (p.planId !== null && whopTestPlanIds(env).includes(p.planId)) return { kind: 'ignore', reason: 'test_plan_record_only' };
  // "payment.succeeded" whose own body does not say paid (or says refunded / disputed) is not money in.
  if (p.paid !== true) return { kind: 'review', reason: 'payment_not_confirmed_paid' };
  if (!p.paymentId) return { kind: 'review', reason: 'payment_has_no_id' };
  if (!p.planId) return { kind: 'review', reason: 'payment_has_no_plan' };
  const table = whopPlanTable(env);
  const row = Object.prototype.hasOwnProperty.call(table, p.planId) ? table[p.planId] : undefined;
  if (!row) return { kind: 'review', reason: `unknown_plan:${p.planId}` };

  // Money in is what grants. $0 (a 100% promo, a comp, a hand-added member) is the owner's case to decide.
  if (p.amount === null || !Number.isFinite(p.amount)) return { kind: 'review', reason: 'payment_has_no_amount' };
  if (p.amount <= 0) return { kind: 'review', reason: 'zero_amount_needs_owner' };
  if (p.currency === null || p.currency.trim().toUpperCase() !== 'USD') return { kind: 'review', reason: `currency_not_usd:${p.currency ?? '(absent)'}` };

  const email = (p.payerEmail ?? '').trim().toLowerCase();
  if (!email || !EMAIL.test(email)) return { kind: 'review', reason: 'no_payer_email' };

  return { kind: 'grant', plan: row.plan, add: row.add, paymentId: p.paymentId, payerEmail: email, planId: p.planId };
}

/** The whole decision for a verified body. A body the reader cannot read is review, so an unmapped reader can never grant. */
export function decideWhopEvent(
  event: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
  read: (e: Record<string, unknown>) => WhopPayment | null = readWhopPayment,
): WhopDecision {
  const payment = read(event);
  if (!payment) return { kind: 'review', reason: 'payload_shape_not_mapped' };
  return decideWhopPayment(payment, env);
}

/** The optional company check. Unset = not checked (the plan-id table and the signature already confine this to our plans and our
 *  endpoint); set = the body's company id must equal it, and a body with no company id fails it. */
export function whopCompanyMatches(payment: Pick<WhopPayment, 'companyId'>, expected: string | undefined): boolean {
  const want = (expected ?? '').trim();
  if (!want) return true;
  return payment.companyId !== null && payment.companyId.trim() === want;
}
