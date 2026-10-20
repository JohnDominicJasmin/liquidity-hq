import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { verifyWhopWebhook } from '@/lib/whop';
import { decideWhopEvent, readWhopPayment, whopCompanyMatches } from '@/lib/whopEntitlement';
import { grantToAccount, recordPendingClaim } from '@/lib/whopGrant';
import { payerOwnsAccount } from '@/lib/lemonsqueezy';

/* Whop webhook (#1567). Phase 1 was a recording shell; Phase 3 (below the record) turns a verified, PAID payment for one of OUR plans
 * into Pro for the account whose email paid. The rules live in lib/whopEntitlement.ts (pure, tested there); this file is the wiring.
 *
 * WHAT GRANTS: a payment.succeeded whose body says paid, for a plan id in WHOP_PLAN_ID_MONTHLY / _ANNUAL / _FORTNIGHTLY (so the Whop
 * sandbox on qa and the live account on prod each use their own ids), charged above zero in USD, with a payer email that is a
 * CONFIRMED LiquidityHQ account. Nothing else grants: not membership.* (it can fire with no money), not a $0 or hand-added member, not an
 * unknown plan id, not the hidden $1 test plan.
 *
 * WHAT NEVER HAPPENS: THIS ROUTE NEVER REVOKES. Cancel, expiry, a failed payment, a refund, a dispute: recorded, and a refund or a
 * dispute is reported for a person. Owner rulings on #1567: all sales are final, paid time runs to its end, then the existing backstop
 * (lib/paidPeriod.ts, 48 h after current_period_end) demotes. The only role this file ever writes is 'pro'. Revoking on an event is how
 * #1422 happened.
 *
 * THE FIELD PATHS ARE FROM WHOP'S DOCUMENTATION, NOT FROM A RECORDED BODY (none existed when this was written; owner go-ahead
 * 2026-10-20). The reader is defensive - a missing or unexpected field is review, never a grant and never a crash - and the first real
 * body (the owner's $1 test purchase, hidden plan, record only) is the check on it. Sources are cited in lib/whopEntitlement.ts.
 *
 * STATUS CODES (Whop expects a 2xx within about 5 s and retries for about 71 hours):
 *   - 401  the request is not verifiably Whop's. Nothing is stored. One answer for every failure.
 *   - 400  verified, but the body is not a JSON object. Nothing to act on.
 *   - 500  verified, but it could NOT be written down, OR the grant write failed. A non-2xx keeps the delivery retryable on Whop's side.
 *          When the grant write fails the stored record is REMOVED first: left in place it is the replay guard, a retry would be
 *          answered "replay", and a paid customer would stay Free with no retry coming (the BoomFi route's failAndForget).
 *   - 200  written down (and acted on, or deliberately not - the body says which), or already written down on an earlier delivery.
 *
 * ONE PAYMENT IS COUNTED ONCE, however many deliveries and bodies it arrives in: the replay guard below is keyed on the bytes, which a
 * re-sent or re-signed event changes, so the grant has its own guard keyed on the PAYMENT ID (earliest recorded row wins).
 */

const SECRET = process.env.WHOP_WEBHOOK_SECRET ?? '';

// Same prefix switch as lib/tables.ts: the function that exists on prod is not the one that exists on dev (qa uses the dev database).
const userIdByEmailFn = process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_user_id_by_email' : 'lhq_user_id_by_email';

/** A text column's worth of a field that is a string. Anything else is left null rather than coerced: the whole body is stored beside
 *  it, so a surprise in the shape is visible instead of papered over. */
const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export async function POST(req: NextRequest) {
  // The RAW body, read once. The signature is over these exact bytes; parsing and re-serialising first would change them.
  const rawBody = await req.text();

  const webhookId = req.headers.get('webhook-id');
  const verdict = verifyWhopWebhook({
    rawBody,
    id: webhookId,
    timestamp: req.headers.get('webhook-timestamp'),
    signature: req.headers.get('webhook-signature'),
    secret: SECRET,
  });
  // One answer for every failure. Which check refused is not the caller's business; /api/version's `whopWebhook` flag says whether the
  // secret is set.
  if (!verdict.ok) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Body is not JSON' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body is not a JSON object' }, { status: 400 });
  }
  const event = body as Record<string, unknown>;
  const data = typeof event.data === 'object' && event.data !== null && !Array.isArray(event.data) ? (event.data as Record<string, unknown>) : null;
  // Read once, used for the searchable hints below and for the decision. Never throws; null = no event type at all.
  const payment = readWhopPayment(event);

  // ── Record, and let the same write be the replay guard ───────────────────
  // A retry of one message carries the same bytes and the same webhook-id; the hash of the raw body is the key. Different bytes with a
  // repeated webhook-id are still recorded (the evidence is kept), and the index on webhook_id makes them findable.
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  let sb: ReturnType<typeof getSupabaseAdmin>;
  try {
    sb = getSupabaseAdmin();
  } catch (e) {
    return apiError('whop/webhook', e);
  }
  const eventName = payment?.eventName ?? text(event.type) ?? text(event.event) ?? text(event.action);
  const { data: firstSeen, error: recordErr } = await sb
    .from(T.whop_webhook_events)
    .insert({
      payload_hash: payloadHash,
      webhook_id: text(webhookId),
      // Searchable hints only; `body` has the truth. For a payment the resource id is the PAYMENT id, which is what the grant guard keys on.
      event: eventName,
      resource_id: payment?.paymentId ?? text(data?.id) ?? text(event.id),
      body: event,
    })
    .select('payload_hash')
    .maybeSingle();

  // A duplicate key is the expected "already recorded" path, not a failure.
  if (recordErr && recordErr.code !== '23505') return apiError('whop/webhook', recordErr);
  if (!firstSeen) return NextResponse.json({ received: true, ignored: 'replay' });

  // ── The decision (rules in lib/whopEntitlement.ts) ───────────────────────
  const decision = decideWhopEvent(event, process.env, () => payment);
  if (decision.kind === 'ignore') return NextResponse.json({ received: true, recorded: true, ignored: decision.reason });
  if (decision.kind === 'review') return reviewResponse(eventName, payment?.paymentId ?? null, decision.reason);

  // ── A paid payment for one of our plans ──────────────────────────────────
  // Every refusal below is REPORTED (GlitchTip) and answered 200 with the reason, never dropped and never guessed at: a payment that
  // will never match is not helped by a retry. Only a failed READ or WRITE answers 500, because that one a retry can fix.
  const paymentId = decision.paymentId;
  if (payment && !whopCompanyMatches(payment, process.env.WHOP_COMPANY_ID)) {
    return reviewResponse(eventName, paymentId, 'company_does_not_match');
  }

  // One payment is counted once, even if Whop sends it again with a different body (a different hash: a re-signed retry, or the same
  // payment in a second event). The EARLIEST recorded row for this payment id and event is the one that may grant; every other is a
  // repeat. Two deliveries racing agree on which is earliest, so exactly one of them grants.
  const { data: earliest, error: earliestErr } = await sb
    .from(T.whop_webhook_events)
    .select('payload_hash')
    .eq('event', eventName ?? '').eq('resource_id', paymentId)
    .order('received_at', { ascending: true }).order('payload_hash', { ascending: true })
    .limit(1).maybeSingle();
  if (earliestErr) return failAndForget(sb, payloadHash, 'earliest-payment read', earliestErr);
  if (earliest && earliest.payload_hash !== payloadHash) {
    return NextResponse.json({ received: true, recorded: true, ignored: 'payment_already_counted' });
  }

  // The account is found by the payer's email: /upgrade tells the buyer to use the same email as their account, and the checkout link
  // carries nothing else. No match is review. (Supabase auth emails are unique and stored lower-case, so "more than one" cannot occur.)
  const { data: accountId, error: idErr } = await sb.rpc(userIdByEmailFn, { p_email: decision.payerEmail });
  if (idErr) return failAndForget(sb, payloadHash, 'account lookup by email', idErr);
  if (typeof accountId !== 'string' || !accountId) {
    // Paid, for one of our plans, and nobody to give it to YET. Leave a pending claim: when this email signs up or signs in,
    // /api/whop/claim grants from the stored delivery with the same rules (lib/whopGrant.ts). Best effort; reported if it fails.
    await leaveClaim(sb, paymentId, payloadHash, decision.payerEmail, 'no_account_for_payer_email');
    return reviewResponse(eventName, paymentId, 'no_account_for_payer_email');
  }

  const { data: acct, error: acctErr } = await sb.auth.admin.getUserById(accountId);
  if (acctErr && !/not found/i.test(acctErr.message ?? '')) return failAndForget(sb, payloadHash, 'account read', acctErr);
  if (!acct?.user) return reviewResponse(eventName, paymentId, 'account_not_found');
  // Belt and braces: the lookup is by email, so this should always hold; it also keeps the comparison identical to the other processors.
  if (!payerOwnsAccount(decision.payerEmail, acct.user.email)) return reviewResponse(eventName, paymentId, 'payer_email_does_not_match_account');
  // Someone can sign up with an address that is not theirs and never confirm it; the person who then PAYS with that address would be
  // buying Pro for the squatter. Only a confirmed address can receive a payment's Pro.
  if (!acct.user.email_confirmed_at) {
    await leaveClaim(sb, paymentId, payloadHash, decision.payerEmail, 'account_email_not_confirmed');
    return reviewResponse(eventName, paymentId, 'account_email_not_confirmed');
  }

  const res = await grantToAccount(sb, accountId, decision);
  if (res.kind === 'error') return failAndForget(sb, payloadHash, res.what, res.err);
  if (res.kind === 'review') return reviewResponse(eventName, paymentId, res.reason);

  return NextResponse.json({ received: true, recorded: true, granted: res.plan, period_end: res.periodEnd.toISOString() });
}

/** The pending claim for a paid payment that could not be given to an account yet. A failure to write it is reported, never turned into a
 *  failed delivery (the delivery itself is already recorded). */
async function leaveClaim(sb: ReturnType<typeof getSupabaseAdmin>, paymentId: string, deliveryHash: string, payerEmail: string, reason: string) {
  const r = await recordPendingClaim(sb, { paymentId, deliveryHash, payerEmail, reason });
  if (!r.ok) apiError('whop/webhook', new Error(`could not leave a pending claim for payment ${paymentId}: ${(r.error as { message?: string })?.message ?? String(r.error)}`));
}

/** A payment or event that cannot be applied safely, and needs a person. Reported with the payment id so it can be found in the
 *  stored row; answered 200 so Whop does not retry for a reason a retry will not change. No email, name or secret is put in the report. */
function reviewResponse(eventName: string | null, id: string | null, reason: string) {
  apiError('whop/webhook', new Error(`NEEDS MANUAL REVIEW, nothing granted - event=${eventName ?? '(none)'} id=${id ?? '(none)'} reason=${reason}`));
  return NextResponse.json({ received: true, recorded: true, review: reason });
}

/** The read or write that would have granted Pro failed. The row recorded at the top is the replay guard, so it is removed again: with
 *  it left in place a Whop retry would be answered "replay" and a paid account would stay Free. 500 so the delivery stays retryable. */
async function failAndForget(sb: ReturnType<typeof getSupabaseAdmin>, payloadHash: string, what: string, err: unknown) {
  await sb.from(T.whop_webhook_events).delete().eq('payload_hash', payloadHash);
  return apiError('whop/webhook', new Error(`${what} failed after a verified payment - nothing granted, delivery left replayable: ${(err as { message?: string })?.message ?? String(err)}`));
}
