import crypto from 'crypto';
import type { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { decideWhopEvent, extendedPeriodEnd, readWhopPayment, whopCompanyMatches } from '@/lib/whopEntitlement';

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
 * account whose CONFIRMED email equals the payer's email. */

type Admin = ReturnType<typeof getSupabaseAdmin>;

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

export interface ClaimResult { granted: number; refused: string[]; error?: unknown }

/** Called for a signed-in account with a CONFIRMED email. Grants every pending paid Whop payment for that email, once each. */
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
    const pb = (typeof p.body === 'object' && p.body !== null ? p.body : {}) as { delivery_hash?: unknown; reason?: unknown };
    const put = async (reason: string) => { if (paymentId && typeof pb.delivery_hash === 'string') await recordPendingClaim(sb, { paymentId, deliveryHash: pb.delivery_hash, payerEmail: email, reason }); };

    // Take the claim. Only the caller whose delete removes the row goes on.
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

    const res = await grantToAccount(sb, i.userId, decision, now);
    if (res.kind === 'granted') { out.granted++; continue; }
    await put(String(pb.reason ?? 'unknown')); // nothing was granted: keep the claim so it is not lost
    if (res.kind === 'review') out.refused.push(res.reason); else out.error = res.err;
  }
  return out;
}
