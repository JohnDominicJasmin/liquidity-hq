/* What a verified BoomFi event means for an account (#861, Phase 1c). PURE: no database, no network, no clock but the one passed in.
 *
 * WHAT BOOMFI DOCUMENTS, AND WHAT IT DOES NOT (read 2026-10-08 from docs.boomfi.xyz: webhooks/event-types, payments/subscriptions,
 * payments/cookbook-recurring, payments/paylink-features). The event NAMES: Plan.Created, Plan.Updated, Subscription.Created,
 * Subscription.Updated, Subscription.Canceled, Payment.Created, Payment.Updated, Invoice.Created, Invoice.Overdue. Field names that
 * "vary by type": id, org_id / org, status, amount, currency (strings), paid_amount (on-chain received, capped at amount), customer /
 * customer_id, reference, metadata, payment_method, crypto_transaction. Payment `status` "Succeeded" is "treated as paid".
 * NO EXAMPLE PAYLOAD IS PUBLISHED. Not documented, so NOT relied on here: where `customer_ident` (the account id /upgrade binds to the
 * link) or the payer's email comes back, any subscription status enum beyond "Active", any current-period / ends-at field, how a
 * payment names its subscription, and whether cancel takes effect now or at period end. The last time a payload shape was inferred a
 * successful payment revoked Pro (#1422), so every rule below that would need one of those fields is written to REFUSE, not guess:
 *
 *   - Money in = a Payment.Updated with status exactly "Succeeded" and a payment id. Nothing else ever grants.
 *   - Which plan = the AMOUNT paid ("amount", documented), by exact table. An amount that is no plan's price (the old $35 link, a test
 *     amount, a typo) is sent to review, never rounded to the nearest plan.
 *   - Until when = computed HERE from the payment moment, extending from the later of now and the stored end. No period field is read.
 *   - Which account = found by VALUE, not by path: any string in the body that is a UUID naming a user, plus any email-shaped string.
 *     More than one distinct UUID, or none, is review. The caller then requires the account's own email to equal an email in the body
 *     (payerOwnsAccount, as the Lemon Squeezy handler does): the id comes from a client-side URL the payer can edit.
 *   - Cancel, expiry and a failed pull change NOTHING. Owner rule: paid time is kept to its end, then Free. The existing backstop
 *     (lib/paidPeriod.ts) does the demotion; revoking on an event is how #1422 happened.
 * Anything refused is returned as { kind: 'review', reason } so the route can report it for a human. Never silently dropped. */

export type BoomfiPlan = 'monthly' | 'annual' | 'fortnightly';

/** The prices, in USD, and what one payment of each buys. $10 is the weekly crypto plan (BoomFi has no every-two-weeks interval, so the
 *  plan that /upgrade sells as "every 2 weeks" bills $10 a week); $20 is one two-week payment. Keep in sync with UPGRADE_PRICE_*. */
export const BOOMFI_PAYMENT_TABLE: ReadonlyArray<{ amount: number; plan: BoomfiPlan; add: { months?: number; days?: number } }> = [
  { amount: 49,  plan: 'monthly',     add: { months: 1 } },
  { amount: 490, plan: 'annual',      add: { months: 12 } },
  { amount: 20,  plan: 'fortnightly', add: { days: 14 } },
  { amount: 10,  plan: 'fortnightly', add: { days: 7 } },
];

export type BoomfiDecision =
  | { kind: 'grant'; plan: BoomfiPlan; add: { months?: number; days?: number }; paymentId: string; accountIds: string[]; payerEmails: string[]; customerId: string | null; subscriptionId: string | null }
  | { kind: 'ignore'; reason: string }
  | { kind: 'review'; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Every string in a body, with the key path it sat under (arrays flattened). Depth-limited so a hostile body cannot recurse forever. */
function* strings(v: unknown, path = '', depth = 0): Generator<[string, string]> {
  if (depth > 8) return;
  if (typeof v === 'string') yield [path, v];
  else if (Array.isArray(v)) for (const x of v) yield* strings(x, path, depth + 1);
  else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) yield* strings(x, path ? `${path}.${k}` : k, depth + 1);
}

/** UUIDs and emails found by value. Our own organisation id and the event's own id are not an account reference, so top-level
 *  `id`, `org_id` and `org` are skipped. */
export function findAccountReferences(event: Record<string, unknown>): { uuids: string[]; emails: string[] } {
  const uuids = new Set<string>(); const emails = new Set<string>();
  for (const [path, s] of strings(event)) {
    const top = path.split('.')[0];
    if (top === 'id' || top === 'org_id' || top === 'org') continue;
    const t = s.trim();
    if (UUID.test(t)) uuids.add(t.toLowerCase());
    else if (EMAIL.test(t)) emails.add(t.toLowerCase());
  }
  return { uuids: [...uuids], emails: [...emails] };
}

/** "49", "49.00" and 49 are the same price; "49.5", "", "NaN" and "1e2" are not a plan. Strings only: a documented string field that
 *  arrives as another type is not trusted. */
export function parseAmount(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d{1,9}(\.\d{1,8})?$/.test(v.trim())) return null;
  return Number(v.trim());
}

export function planForAmount(amount: number | null): { plan: BoomfiPlan; add: { months?: number; days?: number } } | null {
  if (amount === null) return null;
  const row = BOOMFI_PAYMENT_TABLE.find((r) => r.amount === amount);
  return row ? { plan: row.plan, add: row.add } : null;
}

/** `from` plus whole months, clamped to the month's last day (Jan 31 + 1 month = Feb 28/29, not Mar 3), then plus days. UTC. */
export function addPeriod(from: Date, add: { months?: number; days?: number }): Date {
  const d = new Date(from.getTime());
  if (add.months) {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + add.months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  if (add.days) d.setUTCDate(d.getUTCDate() + add.days);
  return d;
}

/** The new end of paid time after one payment: counted from the later of now and the stored end, so paying early never loses the days
 *  already paid for (renewal), and a lapsed account is counted from now. */
export function extendedPeriodEnd(storedEnd: string | null | undefined, now: Date, add: { months?: number; days?: number }): Date {
  const stored = storedEnd ? new Date(storedEnd).getTime() : NaN;
  const base = Number.isFinite(stored) && stored > now.getTime() ? new Date(stored) : now;
  return addPeriod(base, add);
}

export function decideBoomfiEvent(event: Record<string, unknown>): BoomfiDecision {
  const name = text(event.event);
  if (!name) return { kind: 'ignore', reason: 'no_event_name' };

  // A failed pull, a cancel, an expiry: nothing is revoked (owner rule - cancel keeps paid time to its end, then Free; the
  // time-based backstop in lib/paidPeriod.ts does the demotion).
  if (name === 'Invoice.Overdue') return { kind: 'ignore', reason: 'failed_pull_keeps_paid_time' };
  if (name === 'Subscription.Canceled') return { kind: 'ignore', reason: 'cancel_keeps_paid_time' };
  if (name !== 'Payment.Updated') return { kind: 'ignore', reason: 'not_a_payment_confirmation' };

  if (event.status !== 'Succeeded') return { kind: 'ignore', reason: 'payment_not_succeeded' };
  const paymentId = text(event.id);
  if (!paymentId) return { kind: 'review', reason: 'payment_has_no_id' };

  const amount = parseAmount(event.amount);
  const cur = text(event.currency);
  if (cur === null || cur.toUpperCase() !== 'USD') return { kind: 'review', reason: `currency_not_usd:${cur ?? '(absent)'}` };
  // paid_amount is what actually arrived on-chain, capped at amount. Less than the price is an underpayment, not a plan.
  if (event.paid_amount !== undefined) {
    const paid = parseAmount(event.paid_amount);
    if (paid === null || amount === null || paid < amount) return { kind: 'review', reason: `underpaid_or_unreadable:${String(event.paid_amount)}` };
  }
  const plan = planForAmount(amount);
  if (!plan) return { kind: 'review', reason: `amount_is_not_a_plan:${String(event.amount)}` };

  const { uuids, emails } = findAccountReferences(event);
  if (uuids.length === 0) return { kind: 'review', reason: 'no_account_reference' };
  if (uuids.length > 1) return { kind: 'review', reason: 'ambiguous_account_reference' };
  if (emails.length === 0) return { kind: 'review', reason: 'no_payer_email' };

  const customer = typeof event.customer === 'object' && event.customer !== null ? (event.customer as { id?: unknown }) : null;
  const sub = typeof event.subscription === 'object' && event.subscription !== null ? (event.subscription as { id?: unknown }) : null;
  return {
    kind: 'grant',
    plan: plan.plan,
    add: plan.add,
    paymentId,
    accountIds: uuids,
    payerEmails: emails,
    // Stored for support only. Where these live is undocumented, so they are read from the two obvious places and never decided on.
    customerId: text(event.customer_id) ?? text(customer?.id),
    subscriptionId: text(event.subscription_id) ?? text(sub?.id),
  };
}
