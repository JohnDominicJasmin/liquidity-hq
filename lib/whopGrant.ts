import crypto from 'crypto';
import type { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { decideWhopEvent, decideWhopMembership, extendedPeriodEnd, readWhopMembership, readWhopPayment, whopCompanyMatches } from '@/lib/whopEntitlement';
import { payerOwnsAccount } from '@/lib/lemonsqueezy';
import { apiError } from '@/lib/apiError';

/* The two things the Whop webhook and the sign-up claim both do, in one place so they cannot drift (#1567, recovery for a payer with no
 * account yet).
 *
 *   grantToAccount()  writes Pro for one ACCOUNT from one decided payment. Everything the route used to do after it had found the account:
 *                     the admin-grant refusal, the later-of(stored end, now) extension, the optional `plan` column.
 *   a PENDING CLAIM   is what the webhook leaves behind when a PAID payment for one of our plans could not be given to an account yet (no
 *                     account for that email, or the account's email is not confirmed). It is one small row in whop_webhook_events (event
 *                     'lhq.pending_claim', key = a hash of the PAYMENT ID, so a payment has at most one) that points at the stored delivery.
 *                     When that email later signs up or signs in, claimPendingForAccount() re-decides the stored delivery with the SAME rules
 *                     and grants. No manual step, no new table, no migration.
 *
 * WHY IT CANNOT DOUBLE-GRANT. A claim is taken by DELETING its pending row, and a delete removes the row for exactly one caller, so two
 * tabs, two sign-ins or a retry race to a single winner. If the grant then fails or is refused, the winner puts the row back, so nothing is
 * lost. A later re-delivery of the same payment with different bytes is still answered `payment_already_counted` by the webhook (the
 * earliest recorded row for that payment id is the original one), whether or not this claim has run. And the claim only ever touches the
 * account whose CONFIRMED email equals the payer's email.
 *
 * #1630 GO-LIVE 3 ADDS TWO MORE SMALL ROWS, the same pattern (same table, no migration):
 *   an APPLIED MARKER  (event 'lhq.applied', key = a hash of the PAYMENT ID) is written BEFORE every grant, by every path (webhook, sign-up
 *                      claim, hourly retry). Its primary key makes "this payment has been applied" a database fact that exactly one writer can
 *                      establish, so ONE PAYMENT CAN NEVER GRANT TWICE, whichever path runs, however often, in whatever order. If the grant then
 *                      fails or is refused, the marker is removed again so the payment is not lost.
 *   a RETRY ROW        (event 'lhq.retry', key = a hash of the PAYMENT ID) is left when a paid delivery is refused for a SETTINGS reason
 *                      (unknown plan id, no payer email, company mismatch): a reason a fixed setting can change, which a Whop retry never will
 *                      (the webhook answered 200). The hourly job (app/api/econ-calendar/ingest) re-runs the stored delivery through the SAME
 *                      pipeline for 7 days (retryRefusedWhopDeliveries). Automatic: no person presses anything (owner rule). */

type Admin = ReturnType<typeof getSupabaseAdmin>;

export const WHOP_APPLIED_EVENT = 'lhq.applied';
export const WHOP_RETRY_EVENT = 'lhq.retry';
/** How long a settings-refused delivery is retried before it is given up and reported. */
export const WHOP_RETRY_DAYS = 7;
const RETRY_BATCH = 25;

export function appliedHash(paymentId: string): string {
  return crypto.createHash('sha256').update(`whop-applied:${paymentId}`).digest('hex');
}
export function retryHash(paymentId: string): string {
  return crypto.createHash('sha256').update(`whop-retry:${paymentId}`).digest('hex');
}

/** A refusal that a fixed SETTING can turn into a grant: the plan id table (WHOP_PLAN_ID_*), the company id (WHOP_COMPANY_ID), or the payer
 *  email (Whop's member:email:read permission; see the PR: a STORED body that lacks the email cannot gain it on a retry). */
export function isSettingsRefusal(reason: string): boolean {
  return reason.startsWith('unknown_plan:') || reason === 'no_payer_email' || reason === 'company_does_not_match';
}

/* THE MEMBERSHIP LINK (#1630 Step 1, the cancel flow). ONE MORE SMALL ROW, the same pattern as the three above: same table, no
 * migration, primary key = a hash of the MEMBERSHIP id.
 *
 * It exists because a cancellation arrives as `membership.updated`, which names the MEMBERSHIP and nothing else - not the payment, not
 * the account, and the email in it is a Whop profile address that need not be the LiquidityHQ one. Without a recorded link there is
 * nothing to attach a cancellation to, so the state path matches on this row's key and never on an email. That also keeps the whole
 * cancel path clear of Whop's `member:email:read` permission, which the GRANT path depends on and which has already produced refusals.
 *
 * The row's body carries { account_id, plan, cancel_at_period_end, canceled_at }. It is written at grant time, and the cancel fields
 * are set and CLEARED by membership.updated. Nothing in it decides access.
 *
 * A payment whose body carried no membership id simply has no row: the cancel state is then unavailable for that account and the
 * Settings panel falls back to the provider-managed view, which still links out to Whop. Degraded, never wrong. */
export const WHOP_MEMBERSHIP_EVENT = 'lhq.membership';

export function membershipHash(membershipId: string): string {
  return crypto.createHash('sha256').update(`whop-membership:${membershipId}`).digest('hex');
}

export interface MembershipLinkBody { account_id: string; plan?: string | null; cancel_at_period_end?: boolean; canceled_at?: string | null }

/** Links a membership to the account it granted Pro to. Best effort: a failure here costs the cancel STATE, never the grant, so it is
 *  swallowed by the caller. A second payment on the same membership (a renewal) is a harmless duplicate key. */
export async function recordMembershipLink(sb: Admin, i: { membershipId: string; accountId: string; plan?: string | null }): Promise<{ ok: boolean; error?: unknown }> {
  const body: MembershipLinkBody = { account_id: i.accountId, plan: i.plan ?? null, cancel_at_period_end: false, canceled_at: null };
  const { error } = await sb.from(T.whop_webhook_events).insert({
    payload_hash: membershipHash(i.membershipId),
    webhook_id: null,
    event: WHOP_MEMBERSHIP_EVENT,
    resource_id: i.membershipId,
    body,
  });
  if (error && error.code !== '23505') return { ok: false, error };
  return { ok: true };
}

export type MembershipOutcome =
  | { kind: 'recorded'; membershipId: string; cancelAtPeriodEnd: boolean }
  | { kind: 'ignored'; reason: string }
  | { kind: 'review'; reason: string; membershipId: string | null }
  | { kind: 'error'; what: string; err: unknown };

/** A verified `membership.*` event, applied to the CANCEL STATE and to nothing else.
 *
 *  It writes no role, moves no period end, grants nothing and revokes nothing - `decideWhopPayment` still answers
 *  `membership_event_never_grants_or_revokes` for the access question, unchanged. The only write is to this membership's own link row.
 *
 *  Both directions: `cancel_at_period_end` true records "will not renew", false CLEARS it. The clearing path is what keeps a
 *  cancellation from being permanent - a customer who cancels and resubscribes would otherwise buy a period that then ends with no
 *  grace, because the flag the demotion reads would still be set. */
export async function applyWhopMembershipEvent(
  sb: Admin,
  i: { event: Record<string, unknown> },
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): Promise<MembershipOutcome> {
  const decision = decideWhopMembership(i.event);
  if (decision.kind === 'ignore') return { kind: 'ignored', reason: decision.reason };
  if (decision.kind === 'review') return { kind: 'review', reason: decision.reason, membershipId: null };

  const state = readWhopMembership(i.event);
  if (state && !whopCompanyMatches({ companyId: state.companyId }, env.WHOP_COMPANY_ID)) {
    return { kind: 'review', reason: 'company_does_not_match', membershipId: decision.membershipId };
  }

  const key = membershipHash(decision.membershipId);
  const { data: link, error: readErr } = await sb.from(T.whop_webhook_events).select('body').eq('payload_hash', key).maybeSingle();
  if (readErr) return { kind: 'error', what: 'membership link read', err: readErr };
  // No link: this membership never granted Pro here (a payment before Step 1 shipped, a body with no membership id, or somebody else's
  // membership entirely). The delivery is already recorded; there is nothing to attach and nothing to guess at.
  if (!link || typeof link.body !== 'object' || link.body === null) return { kind: 'ignored', reason: 'membership_not_linked_to_an_account' };

  const current = link.body as MembershipLinkBody;
  const cancelled = decision.kind === 'cancelled';
  const next: MembershipLinkBody = {
    ...current,
    cancel_at_period_end: cancelled,
    canceled_at: cancelled ? (decision.canceledAt ?? now.toISOString()) : null,
  };
  const { error: writeErr } = await sb.from(T.whop_webhook_events).update({ body: next }).eq('payload_hash', key);
  if (writeErr) return { kind: 'error', what: 'membership cancel-state write', err: writeErr };
  return { kind: 'recorded', membershipId: decision.membershipId, cancelAtPeriodEnd: cancelled };
}

/** The cancel state for one ACCOUNT, for the Settings panel. Null when this account has no linked Whop membership, which is every
 *  account that paid before Step 1 shipped - the panel then shows the provider-managed view rather than inventing a state.
 *
 *  THE NEWEST LINK WINS, AND THE ORDERING IS THE WHOLE CORRECTNESS OF THIS FUNCTION. One account can hold SEVERAL link rows: the key
 *  is a hash of the MEMBERSHIP id, so somebody who cancels and later buys again has one row per membership. The clearing path only
 *  touches the row its own event names, so the old membership's row keeps `cancel_at_period_end: true` for ever - correctly, it was
 *  cancelled. Without an order this read could return that row and tell a RENEWING, PAYING customer that their access ends on a date.
 *  Their access would be fine (that comes from `current_period_end`); the product would simply be lying to them, which is the same
 *  class of defect as the "Managed by support" panel this work exists to replace.
 *
 *  `received_at` is written at GRANT time, so the newest link row is the membership that paid most recently - the best available
 *  signal for "the live one", since no membership carries its own period here. `payload_hash` breaks a tie deterministically, the
 *  same pair applyWhopDelivery uses to pick the earliest delivery for a payment. */
export async function membershipStateForAccount(sb: Admin, accountId: string): Promise<{ cancelAtPeriodEnd: boolean; canceledAt: string | null } | null> {
  const { data, error } = await sb
    .from(T.whop_webhook_events)
    .select('body')
    .eq('event', WHOP_MEMBERSHIP_EVENT)
    .eq('body->>account_id', accountId)
    .order('received_at', { ascending: false })
    .order('payload_hash', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || typeof data.body !== 'object' || data.body === null) return null;
  const b = data.body as MembershipLinkBody;
  return { cancelAtPeriodEnd: b.cancel_at_period_end === true, canceledAt: typeof b.canceled_at === 'string' ? b.canceled_at : null };
}

export const WHOP_PENDING_CLAIM_EVENT = 'lhq.pending_claim';

/** One pending claim per payment id. The key is the table's primary key, so a second insert for the same payment is a harmless duplicate. */
export function pendingClaimHash(paymentId: string): string {
  return crypto.createHash('sha256').update(`whop-pending-claim:${paymentId}`).digest('hex');
}

/** Leaves a pending claim for a paid payment that could not be given to an account yet. Best effort: the delivery itself is already
 *  recorded, so a failure here is reported and swallowed, never turned into a failed webhook. */
export async function recordPendingClaim(sb: Admin, i: { paymentId: string; deliveryHash: string; payerEmail: string; reason: string }): Promise<{ ok: boolean; error?: unknown }> {
  const { error } = await sb.from(T.whop_webhook_events).insert({
    payload_hash: pendingClaimHash(i.paymentId),
    webhook_id: null,
    event: WHOP_PENDING_CLAIM_EVENT,
    resource_id: i.paymentId,
    body: { delivery_hash: i.deliveryHash, payer_email: i.payerEmail.trim().toLowerCase(), reason: i.reason },
  });
  if (error && error.code !== '23505') return { ok: false, error };
  return { ok: true };
}

export type GrantResult =
  | { kind: 'granted'; plan: string; periodEnd: Date }
  | { kind: 'review'; reason: string }
  | { kind: 'error'; what: string; err: unknown };

/** Pro for one account from one decided payment. */
export async function grantToAccount(sb: Admin, accountId: string, d: { plan: string; add: { months?: number; days?: number } }, now: Date = new Date()): Promise<GrantResult> {
  const { data: stored, error: storedErr } = await sb
    .from(T.user_subscriptions)
    .select('role, current_period_end, billing_provider')
    .eq('user_id', accountId)
    .maybeSingle();
  if (storedErr) return { kind: 'error', what: 'stored-subscription read', err: storedErr };
  // An admin grant (Pro with no end date, no processor) is not time-limited. A payment must not turn it into one.
  if (stored?.role === 'pro' && !stored.current_period_end && !stored.billing_provider) return { kind: 'review', reason: 'account_has_admin_grant' };

  // Counted from the later of now and the stored end: a renewal never loses days already paid for, and a lapsed account counts from now.
  // An end date that is already later than this one is therefore never shortened.
  const periodEnd = extendedPeriodEnd(stored?.current_period_end as string | null | undefined, now, d.add);
  const row = {
    user_id: accountId,
    role: 'pro',
    current_period_end: periodEnd.toISOString(),
    billing_provider: 'whop',
    updated_at: now.toISOString(),
  };
  let { error: writeErr } = await sb.from(T.user_subscriptions).upsert({ ...row, plan: d.plan }, { onConflict: 'user_id' });
  // `plan` is the one OPTIONAL column (migration 20261001h). If the database does not have it yet, the grant must still succeed with the
  // plan simply not recorded - "paid and not Pro" is the failure to avoid. Only a complaint about THAT column triggers the retry.
  if (writeErr && /plan/.test(writeErr.message ?? '') && /column|PGRST204|schema cache/i.test(`${writeErr.code ?? ''} ${writeErr.message ?? ''}`)) {
    ({ error: writeErr } = await sb.from(T.user_subscriptions).upsert(row, { onConflict: 'user_id' }));
  }
  if (writeErr) return { kind: 'error', what: 'subscription write', err: writeErr };
  return { kind: 'granted', plan: d.plan, periodEnd };
}

/** grantToAccount behind the APPLIED MARKER: the marker is written first, and only the writer that creates it may grant. A duplicate means
 *  this payment was already applied (by any path); nothing is written. If the grant does not happen, the marker is removed again. */
export async function grantOnce(sb: Admin, paymentId: string, accountId: string, d: { plan: string; add: { months?: number; days?: number }; membershipId?: string | null }, now: Date = new Date()): Promise<GrantResult | { kind: 'already_applied' }> {
  const marker = appliedHash(paymentId);
  const { error: lockErr } = await sb.from(T.whop_webhook_events).insert({
    payload_hash: marker,
    webhook_id: null,
    event: WHOP_APPLIED_EVENT,
    resource_id: paymentId,
    body: { account_id: accountId, plan: d.plan, applied_at: now.toISOString() },
  });
  if (lockErr) {
    if (lockErr.code === '23505') return { kind: 'already_applied' };
    return { kind: 'error', what: 'applied-marker write', err: lockErr };
  }
  const res = await grantToAccount(sb, accountId, d, now);
  if (res.kind !== 'granted') {
    const { error: unlockErr } = await sb.from(T.whop_webhook_events).delete().eq('payload_hash', marker);
    /* QA on #1643: if this delete fails too, the marker stays and every later attempt (a Whop retry, the hourly retry, the sign-up claim) is
       answered "already applied" while the buyer has no Pro. That cannot fix itself, so it is reported for a person with the payment id. */
    if (unlockErr) apiError('whop/grant', new Error(`NEEDS MANUAL REVIEW: payment ${paymentId} was NOT granted (${res.kind}) and its applied marker could not be removed - every retry will now say "already applied". Delete the lhq.applied row for this payment after checking: ${unlockErr.message}`));
    return res;
  }
  /* The membership link (#1630 Step 1), written only after a grant actually happened and only for a body that carried a membership id.
     Best effort BY DESIGN: this row buys the cancel STATE, and a paid customer with no cancel state is a worse product than a paid
     customer with one - but a paid customer with no PRO is the failure that matters, and that has already succeeded by this line. So a
     failure here is reported and swallowed; it never turns a successful grant into an error. */
  if (d.membershipId) {
    const link = await recordMembershipLink(sb, { membershipId: d.membershipId, accountId, plan: d.plan });
    if (!link.ok) apiError('whop/grant', new Error(`payment ${paymentId} granted, but its membership ${d.membershipId} could not be linked - the cancel state will be unavailable for this account: ${(link.error as { message?: string })?.message ?? String(link.error)}`));
  }
  return res;
}

export type ApplyOutcome =
  | { kind: 'granted'; plan: string; periodEnd: Date }
  | { kind: 'ignored'; reason: string }
  | { kind: 'review'; reason: string; paymentId: string | null; claimError?: unknown }
  | { kind: 'error'; what: string; err: unknown };

/** Everything after a delivery is RECORDED, in one place for the webhook and the hourly retry, so the two can never apply different rules.
 *  The order of reads and writes is the webhook's own, unchanged: decision, company, earliest delivery for this payment, account by email,
 *  account read, email match, confirmed email, then the grant behind the applied marker. Returns what happened; the caller answers and reports. */
export async function applyWhopDelivery(
  sb: Admin,
  i: { event: Record<string, unknown>; payloadHash: string; eventName: string | null },
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): Promise<ApplyOutcome> {
  const payment = readWhopPayment(i.event);
  const decision = decideWhopEvent(i.event, env, () => payment);
  if (decision.kind === 'ignore') return { kind: 'ignored', reason: decision.reason };
  if (decision.kind === 'review') return { kind: 'review', reason: decision.reason, paymentId: payment?.paymentId ?? null };

  const paymentId = decision.paymentId;
  if (payment && !whopCompanyMatches(payment, env.WHOP_COMPANY_ID)) return { kind: 'review', reason: 'company_does_not_match', paymentId };

  // One payment is counted once, even if Whop sends it again with a different body: the EARLIEST recorded row for this payment id and event is
  // the one that may grant; every other is a repeat. Two deliveries racing agree on which is earliest.
  const { data: earliest, error: earliestErr } = await sb
    .from(T.whop_webhook_events)
    .select('payload_hash')
    .eq('event', i.eventName ?? '').eq('resource_id', paymentId)
    .order('received_at', { ascending: true }).order('payload_hash', { ascending: true })
    .limit(1).maybeSingle();
  if (earliestErr) return { kind: 'error', what: 'earliest-payment read', err: earliestErr };
  if (earliest && earliest.payload_hash !== i.payloadHash) return { kind: 'ignored', reason: 'payment_already_counted' };

  // Same prefix switch as lib/tables.ts: the function that exists on prod is not the one that exists on dev (qa uses the dev database).
  const fn = process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_user_id_by_email' : 'lhq_user_id_by_email';
  const { data: accountId, error: idErr } = await sb.rpc(fn, { p_email: decision.payerEmail });
  if (idErr) return { kind: 'error', what: 'account lookup by email', err: idErr };
  if (typeof accountId !== 'string' || !accountId) {
    // Paid, for one of our plans, and nobody to give it to YET: leave a pending claim (claimed at sign-up / sign-in by the same rules).
    const r = await recordPendingClaim(sb, { paymentId, deliveryHash: i.payloadHash, payerEmail: decision.payerEmail, reason: 'no_account_for_payer_email' });
    return { kind: 'review', reason: 'no_account_for_payer_email', paymentId, claimError: r.ok ? undefined : r.error };
  }

  const { data: acct, error: acctErr } = await sb.auth.admin.getUserById(accountId);
  if (acctErr && !/not found/i.test(acctErr.message ?? '')) return { kind: 'error', what: 'account read', err: acctErr };
  if (!acct?.user) return { kind: 'review', reason: 'account_not_found', paymentId };
  if (!payerOwnsAccount(decision.payerEmail, acct.user.email)) return { kind: 'review', reason: 'payer_email_does_not_match_account', paymentId };
  // Only a confirmed address can receive a payment's Pro (an unconfirmed sign-up could be someone squatting the address).
  if (!acct.user.email_confirmed_at) {
    const r = await recordPendingClaim(sb, { paymentId, deliveryHash: i.payloadHash, payerEmail: decision.payerEmail, reason: 'account_email_not_confirmed' });
    return { kind: 'review', reason: 'account_email_not_confirmed', paymentId, claimError: r.ok ? undefined : r.error };
  }

  const res = await grantOnce(sb, paymentId, accountId, decision, now);
  if (res.kind === 'granted') return { kind: 'granted', plan: res.plan, periodEnd: res.periodEnd };
  if (res.kind === 'already_applied') return { kind: 'ignored', reason: 'payment_already_applied' };
  if (res.kind === 'review') return { kind: 'review', reason: res.reason, paymentId };
  return { kind: 'error', what: res.what, err: res.err };
}

/** Leaves (or keeps) the retry row for a paid delivery refused for a settings reason. Best effort, like a pending claim: the delivery itself is
 *  already recorded. A second refusal of the same payment is a harmless duplicate. */
export async function recordRetry(sb: Admin, i: { paymentId: string; deliveryHash: string; reason: string; firstRefusedAt?: string; attempts?: number }, now: Date = new Date()): Promise<{ ok: boolean; error?: unknown }> {
  const { error } = await sb.from(T.whop_webhook_events).insert({
    payload_hash: retryHash(i.paymentId),
    webhook_id: null,
    event: WHOP_RETRY_EVENT,
    resource_id: i.paymentId,
    body: { delivery_hash: i.deliveryHash, reason: i.reason, first_refused_at: i.firstRefusedAt ?? now.toISOString(), attempts: i.attempts ?? 0, last_tried_at: i.attempts ? now.toISOString() : null },
  });
  if (error && error.code !== '23505') return { ok: false, error };
  return { ok: true };
}

export interface RetrySummary {
  checked: number; granted: number; stillRefused: number; gaveUp: number; handedOff: number; errors: number;
  /** One line per payment that needs a person (handed off, given up) or failed. Payment ids and reasons only: never an email. */
  notes: string[];
}

/** The hourly retry (#1630 GO-LIVE 3). Each retry row is TAKEN by deleting it (one winner if two runs overlap), the stored delivery is run
 *  through applyWhopDelivery, and then:
 *    granted                              done (the row stays deleted)
 *    refused again for a settings reason  the row is put back with attempts + 1, until WHOP_RETRY_DAYS after the first refusal
 *    refused for any other reason         handed off: reported, not retried (e.g. no account yet: the pending claim takes it from here)
 *    a read or write failed               the row is put back unchanged, so the next hour tries again
 *  Past WHOP_RETRY_DAYS the row is dropped and reported ("gave up"). */
export async function retryRefusedWhopDeliveries(sb: Admin, env: Record<string, string | undefined> = process.env, now: Date = new Date()): Promise<RetrySummary> {
  const out: RetrySummary = { checked: 0, granted: 0, stillRefused: 0, gaveUp: 0, handedOff: 0, errors: 0, notes: [] };
  const { data: rows, error } = await sb
    .from(T.whop_webhook_events)
    .select('payload_hash, resource_id, body, received_at')
    .eq('event', WHOP_RETRY_EVENT)
    .order('received_at', { ascending: true })
    .limit(RETRY_BATCH);
  if (error) { out.errors++; out.notes.push('retry list read failed'); return out; }

  for (const row of rows ?? []) {
    out.checked++;
    const hash = String(row.payload_hash);
    const paymentId = typeof row.resource_id === 'string' ? row.resource_id : '';
    const rb = (typeof row.body === 'object' && row.body !== null ? row.body : {}) as { delivery_hash?: unknown; reason?: unknown; first_refused_at?: unknown; attempts?: unknown };
    const deliveryHash = typeof rb.delivery_hash === 'string' ? rb.delivery_hash : '';
    const firstRefusedAt = typeof rb.first_refused_at === 'string' ? rb.first_refused_at : String(row.received_at ?? now.toISOString());
    const attempts = typeof rb.attempts === 'number' && Number.isFinite(rb.attempts) ? rb.attempts : 0;
    const lastReason = typeof rb.reason === 'string' ? rb.reason : 'unknown';

    // Take the row. Only the run whose delete removes it goes on.
    const { data: removed, error: delErr } = await sb.from(T.whop_webhook_events).delete().eq('payload_hash', hash).select('payload_hash');
    if (delErr) { out.errors++; out.notes.push(`payment ${paymentId}: retry row could not be taken`); continue; }
    if (!removed || removed.length === 0) continue;
    const putBack = (reason: string, nextAttempts: number) =>
      paymentId && deliveryHash ? recordRetry(sb, { paymentId, deliveryHash, reason, firstRefusedAt, attempts: nextAttempts }, now) : Promise.resolve({ ok: false });

    const first = Date.parse(firstRefusedAt);
    if (Number.isFinite(first) && now.getTime() - first > WHOP_RETRY_DAYS * 86_400_000) {
      out.gaveUp++; out.notes.push(`payment ${paymentId}: gave up after ${WHOP_RETRY_DAYS} days, still ${lastReason}`);
      continue;
    }
    if (!paymentId || !deliveryHash) { out.errors++; out.notes.push(`payment ${paymentId || '(none)'}: retry row has no delivery`); continue; }

    const { data: delivery, error: readErr } = await sb.from(T.whop_webhook_events).select('payload_hash, event, body').eq('payload_hash', deliveryHash).maybeSingle();
    if (readErr) { await putBack(lastReason, attempts); out.errors++; out.notes.push(`payment ${paymentId}: stored delivery read failed`); continue; }
    if (!delivery || typeof delivery.body !== 'object' || delivery.body === null) { out.errors++; out.notes.push(`payment ${paymentId}: stored delivery missing`); continue; }

    const outcome = await applyWhopDelivery(sb, { event: delivery.body as Record<string, unknown>, payloadHash: String(delivery.payload_hash), eventName: typeof delivery.event === 'string' ? delivery.event : null }, env, now);
    if (outcome.kind === 'granted') { out.granted++; out.notes.push(`payment ${paymentId}: granted ${outcome.plan} on retry ${attempts + 1}`); continue; }
    if (outcome.kind === 'error') { await putBack(lastReason, attempts); out.errors++; out.notes.push(`payment ${paymentId}: ${outcome.what} failed, will retry`); continue; }
    if (outcome.kind === 'review' && isSettingsRefusal(outcome.reason)) { await putBack(outcome.reason, attempts + 1); out.stillRefused++; continue; }
    out.handedOff++;
    out.notes.push(`payment ${paymentId}: ${outcome.kind === 'review' ? 'needs review, ' : ''}${outcome.reason}`);
  }
  return out;
}

export interface ClaimResult { granted: number; refused: string[]; error?: unknown }

/** Called for a signed-in account with a CONFIRMED email. Grants every pending paid Whop payment for that email, once each. */
/** Whether any pending claim is waiting for this email: true / false, or null when the read failed (the caller then takes the full path).
 *  Lets /api/whop/claim skip asking Auth on the page loads where there is nothing to claim, which is nearly all of them (#1397). */
export async function hasPendingClaim(sb: Admin, email: string): Promise<boolean | null> {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  const { data, error } = await sb
    .from(T.whop_webhook_events)
    .select('payload_hash')
    .eq('event', WHOP_PENDING_CLAIM_EVENT)
    .eq('body->>payer_email', e)
    .limit(1);
  if (error) return null;
  return (data ?? []).length > 0;
}

export async function claimPendingForAccount(
  sb: Admin,
  i: { userId: string; email: string },
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): Promise<ClaimResult> {
  const email = i.email.trim().toLowerCase();
  const out: ClaimResult = { granted: 0, refused: [] };
  if (!email) return out;

  const { data: pending, error } = await sb
    .from(T.whop_webhook_events)
    .select('payload_hash, resource_id, body')
    .eq('event', WHOP_PENDING_CLAIM_EVENT)
    .eq('body->>payer_email', email)
    .limit(10);
  if (error) return { ...out, error };

  for (const p of pending ?? []) {
    const hash = String(p.payload_hash);
    const paymentId = typeof p.resource_id === 'string' ? p.resource_id : '';
    const pb = (typeof p.body === 'object' && p.body !== null ? p.body : {}) as { delivery_hash?: unknown; payer_email?: unknown; reason?: unknown };
    // Put back EXACTLY as it was found: under the row's OWN payer email, never the caller's. If a claim is ever read for the wrong account
    // (the email filter above is relaxed by mistake), restoring it under the caller's address would hand someone else's payment to them.
    const ownEmail = typeof pb.payer_email === 'string' ? pb.payer_email : '';
    const put = async (reason: string) => { if (paymentId && ownEmail && typeof pb.delivery_hash === 'string') await recordPendingClaim(sb, { paymentId, deliveryHash: pb.delivery_hash, payerEmail: ownEmail, reason }); };

    // Take the claim. Only the caller whose delete removes the row goes on. KNOWN LIMIT: the delete is the lock, so a crash between this delete
    // and the grant below (the process dying, not an error, which puts the row back) loses the claim. Rare and bounded to one payment;
    // the delivery itself stays stored, so it can be found by payment id.
    const { data: removed, error: delErr } = await sb.from(T.whop_webhook_events).delete().eq('payload_hash', hash).select('payload_hash');
    if (delErr) { out.error = delErr; continue; }
    if (!removed || removed.length === 0) continue;

    if (typeof pb.delivery_hash !== 'string') { out.refused.push('pending_claim_has_no_delivery'); continue; }
    const { data: orig, error: origErr } = await sb.from(T.whop_webhook_events).select('body').eq('payload_hash', pb.delivery_hash).maybeSingle();
    if (origErr || !orig || typeof orig.body !== 'object' || orig.body === null) { await put(String(pb.reason ?? 'unknown')); out.refused.push('delivery_not_readable'); continue; }
    const event = orig.body as Record<string, unknown>;

    // The SAME rules as the webhook, applied to the stored delivery now (plan table, paid, amount above zero, USD, company).
    const decision = decideWhopEvent(event, env);
    const payment = readWhopPayment(event);
    if (decision.kind !== 'grant' || (payment && !whopCompanyMatches(payment, env.WHOP_COMPANY_ID))) {
      await put(String(pb.reason ?? 'unknown'));
      out.refused.push(decision.kind === 'grant' ? 'company_does_not_match' : decision.reason);
      continue;
    }
    // The pending row is found by email, but the delivery is the authority: it must name THIS account's email.
    if (decision.payerEmail !== email) { await put(String(pb.reason ?? 'unknown')); out.refused.push('payer_email_changed'); continue; }

    const res = await grantOnce(sb, decision.paymentId, i.userId, decision, now);
    if (res.kind === 'granted') { out.granted++; continue; }
    // Already applied by another path (the webhook or the hourly retry): the claim is spent, so it is NOT put back.
    if (res.kind === 'already_applied') continue;
    await put(String(pb.reason ?? 'unknown')); // nothing was granted: keep the claim so it is not lost
    if (res.kind === 'review') out.refused.push(res.reason); else out.error = res.err;
  }
  return out;
}
