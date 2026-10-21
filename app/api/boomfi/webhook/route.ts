import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { verifyBoomfiWebhook, boomfiOrgMatches } from '@/lib/boomfi';
import { decideBoomfiEvent, extendedPeriodEnd } from '@/lib/boomfiEntitlement';
import { isCryptoCheckoutConfigured } from '@/lib/checkout';
import { payerOwnsAccount } from '@/lib/lemonsqueezy';

/* BoomFi webhook (#861). Phase 1b was a shell; Phase 1c (below, after the organisation gate) acts on a verified, org-matched,
 * PAID event - but only while Pro is on sale on this host (BoomFi's own link is set: isCryptoCheckoutConfigured, NOT isProBuyable, which is the Whop switch since #1567 Phase 2), and by the rules in lib/boomfiEntitlement.ts, which
 * refuses to guess any field BoomFi does not document. Cancel, expiry and a failed pull still revoke NOTHING.
 *
 * The rest of this header is the Phase 1b reasoning and still holds for everything up to the organisation gate:
 *
 * This route proves a request is BoomFi's, proves it is about our organisation,
 * writes it down, and then (until 1c) did nothing with it. IT GRANTED NOTHING AND REVOKED
 * NOTHING. That is on purpose, not a gap to fill in from memory:
 *
 * BoomFi documents its event NAMES and a table of field conventions, and
 * publishes no example payload for any of them. The decision that matters here
 * - who is Pro - depends on the real body: where the account id we bind to the
 * link comes back, how a payment points at its subscription, where the paid
 * period ends. The last time this project inferred a payload's shape, a
 * successful payment revoked Pro (#1422). So the decision is written from a
 * recorded event, and recording events is what this shell is for.
 *
 * Every verified delivery is stored whole in `boomfi_webhook_events`. That row
 * is both the evidence the decision will be built from and the replay guard.
 *
 * STATUS CODES ARE CHOSEN FOR BOOMFI'S DELIVERY MODEL, which is not Lemon
 * Squeezy's. BoomFi documents no automatic retry - a delivery that gets a
 * non-2xx is marked failed and waits for someone to press Replay. So:
 *
 *   - 401  the request is not verifiably BoomFi's. Nothing is stored.
 *   - 400  verified, but the body is not a JSON object. Nothing to act on.
 *   - 500  verified, but it could NOT be written down. BoomFi's own guidance is
 *          "return 2xx only after a durable write"; a failed mark on their side
 *          is what keeps this event recoverable by Replay.
 *   - 200  written down (or already written down on an earlier delivery).
 *
 * THE ORGANISATION CHECK COMES AFTER THE RECORD, NOT BEFORE IT, and that order
 * is deliberate. The key is per organisation, so a delivery that verifies
 * against ours is already ours; BoomFi's docs still say to confirm `org_id`.
 * But nobody here has seen what that field holds - the dashboard shows a
 * "Merchant ID" with no `org_` prefix, the API reference shows ids with one.
 * Refusing before recording would mean a BOOMFI_ORG_ID in the wrong format
 * throws away the very body that shows the right one. So the delivery is
 * recorded first, and a mismatch is reported WITH the value that arrived. The
 * check is the gate for the entitlement step when that is written: nothing may
 * ever be granted on an event that fails it.
 */

const PUBLIC_KEY = process.env.BOOMFI_WEBHOOK_PUBLIC_KEY ?? '';
const ORG_ID = process.env.BOOMFI_ORG_ID ?? '';

/** A text column's worth of a field that is documented as a string. Anything
 *  else is left null rather than coerced: the whole body is stored beside it,
 *  so a surprise in the shape is visible instead of papered over. */
const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export async function POST(req: NextRequest) {
  // The RAW body, read once. The signature is over these exact bytes; parsing
  // and re-serialising first would change them.
  const rawBody = await req.text();

  const verdict = verifyBoomfiWebhook({
    rawBody,
    signature: req.headers.get('x-boomfi-signature'),
    timestamp: req.headers.get('x-boomfi-timestamp'),
    publicKeyPem: PUBLIC_KEY,
  });
  // One answer for every failure. Which check refused is not the caller's
  // business; /api/version's `boomfiWebhook` flag says whether the key is set.
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
  const eventName = text(event.event);

  // ── Record, and let the same write be the replay guard ───────────────────
  // A BoomFi retry is re-signed with a new timestamp, so the signature cannot
  // identify a repeat. No event id is documented in the body either. The hash
  // of the raw body is the one thing a repeat of the same delivery shares.
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  // getSupabaseAdmin throws when its settings are missing. Caught so that it is
  // REPORTED like every other failure here, not only turned into a bare 500.
  let sb: ReturnType<typeof getSupabaseAdmin>;
  try {
    sb = getSupabaseAdmin();
  } catch (e) {
    return apiError('boomfi/webhook', e);
  }
  const { data: firstSeen, error: recordErr } = await sb
    .from(T.boomfi_webhook_events)
    .insert({
      payload_hash: payloadHash,
      event: eventName,
      resource_id: text(event.id),
      resource_status: text(event.status),
      body: event,
    })
    .select('payload_hash')
    .maybeSingle();

  // A duplicate key is the expected "already recorded" path, not a failure.
  if (recordErr && recordErr.code !== '23505') return apiError('boomfi/webhook', recordErr);
  if (!firstSeen) return NextResponse.json({ received: true, ignored: 'replay' });

  // ── Organisation gate (see the header for why it sits here) ──────────────
  // An unset BOOMFI_ORG_ID fails this too: a missing setting must never read
  // as "every organisation is ours".
  if (!boomfiOrgMatches(event, ORG_ID)) {
    const nested = typeof event.org === 'object' && event.org !== null ? (event.org as { id?: unknown }).id : undefined;
    apiError('boomfi/webhook', new Error(
      `verified and recorded, but the organisation does not match - nothing may be granted on this event. ` +
      `event=${eventName ?? '(none)'} org_id=${text(event.org_id) ?? '(absent)'} org.id=${text(nested) ?? '(absent)'} ` +
      `BOOMFI_ORG_ID=${ORG_ID.trim() ? 'set' : 'UNSET'}`,
    ));
    return NextResponse.json({ received: true, recorded: true, ignored: 'org_mismatch' });
  }

  // ── The payments switch (#861, Phase 1c) ─────────────────────────────────
  // The same predicate /upgrade gates on. While Pro is not on sale on this host the route is exactly the shell it was: it records
  // and acts on nothing, and the reason string stops a green delivery in BoomFi's dashboard being read as "the account unlocked".
  if (!isCryptoCheckoutConfigured(process.env)) {
    return NextResponse.json({ received: true, recorded: true, ignored: 'payments_not_enabled' });
  }

  const decision = decideBoomfiEvent(event);
  if (decision.kind === 'ignore') return NextResponse.json({ received: true, recorded: true, ignored: decision.reason });
  if (decision.kind === 'review') return reviewResponse(eventName, resourceId(event), decision.reason);

  // ── A payment that is paid, priced like a plan and names one account ─────
  // Every refusal below is REPORTED (GlitchTip) and answered 200 with the reason, never dropped and never guessed at: BoomFi marks
  // a non-2xx as failed and waits for Replay, and a payment that will never match is not helped by one.
  const paymentId = decision.paymentId;

  // One payment is counted once, even if BoomFi sends Payment.Updated for it again with a different body (a different hash).
  // The EARLIEST recorded Succeeded row for this payment id is the one that may grant; every other is a repeat. Two deliveries
  // racing agree on which is earliest, so exactly one of them grants.
  const { data: earliest, error: earliestErr } = await sb
    .from(T.boomfi_webhook_events)
    .select('payload_hash')
    .eq('event', 'Payment.Updated').eq('resource_id', paymentId).eq('resource_status', 'Succeeded')
    .order('received_at', { ascending: true }).order('payload_hash', { ascending: true })
    .limit(1).maybeSingle();
  if (earliestErr) return failAndForget(sb, payloadHash, 'earliest-payment read', earliestErr);
  if (earliest && earliest.payload_hash !== payloadHash) {
    return NextResponse.json({ received: true, recorded: true, ignored: 'payment_already_counted' });
  }

  const accountId = decision.accountIds[0];
  const { data: acct, error: acctErr } = await sb.auth.admin.getUserById(accountId);
  if (acctErr && !/not found/i.test(acctErr.message ?? '')) return failAndForget(sb, payloadHash, 'account lookup', acctErr);
  const acctEmail = acct?.user?.email ?? '';
  if (!acct?.user) return reviewResponse(eventName, paymentId, 'account_not_found');
  // The id came from a client-side URL the payer can edit; the payer's own email is the only proof they own the account named.
  if (!decision.payerEmails.some((e) => payerOwnsAccount(e, acctEmail))) {
    return reviewResponse(eventName, paymentId, 'payer_email_does_not_match_account');
  }

  const { data: stored, error: storedErr } = await sb
    .from(T.user_subscriptions)
    .select('role, current_period_end, billing_provider')
    .eq('user_id', accountId)
    .maybeSingle();
  if (storedErr) return failAndForget(sb, payloadHash, 'stored-subscription read', storedErr);
  // An admin grant (Pro with no end date, no processor) is not time-limited. A payment must not turn it into one.
  if (stored?.role === 'pro' && !stored.current_period_end && !stored.billing_provider) {
    return reviewResponse(eventName, paymentId, 'account_has_admin_grant');
  }

  const now = new Date();
  const periodEnd = extendedPeriodEnd(stored?.current_period_end as string | null | undefined, now, decision.add);
  const row = {
    user_id: accountId,
    role: 'pro',
    current_period_end: periodEnd.toISOString(),
    billing_provider: 'boomfi',
    ...(decision.customerId ? { boomfi_customer_id: decision.customerId } : {}),
    ...(decision.subscriptionId ? { boomfi_subscription_id: decision.subscriptionId } : {}),
    updated_at: now.toISOString(),
  };
  let { error: writeErr } = await sb.from(T.user_subscriptions).upsert({ ...row, plan: decision.plan }, { onConflict: 'user_id' });
  // `plan` is the one OPTIONAL column (migration 20261001h). If the database does not have it yet, the grant must still succeed with the
  // plan simply not recorded - "paid and not Pro" is the failure to avoid. Only a complaint about THAT column triggers the retry.
  if (writeErr && /plan/.test(writeErr.message ?? '') && /column|PGRST204|schema cache/i.test(`${writeErr.code ?? ''} ${writeErr.message ?? ''}`)) {
    ({ error: writeErr } = await sb.from(T.user_subscriptions).upsert(row, { onConflict: 'user_id' }));
  }
  if (writeErr) return failAndForget(sb, payloadHash, 'subscription write', writeErr);

  return NextResponse.json({ received: true, recorded: true, granted: decision.plan, period_end: periodEnd.toISOString() });
}

const resourceId = (event: Record<string, unknown>) => text(event.id);

/** A payment or event that cannot be applied safely, and needs a person. Reported with the payment id so it can be found in the
 *  stored row; answered 200 so BoomFi does not mark it failed for a reason a Replay will not change. */
function reviewResponse(eventName: string | null, id: string | null, reason: string) {
  apiError('boomfi/webhook', new Error(`NEEDS MANUAL REVIEW, nothing granted - event=${eventName ?? '(none)'} id=${id ?? '(none)'} reason=${reason}`));
  return NextResponse.json({ received: true, recorded: true, review: reason });
}

/** The write that would have granted Pro failed. The row recorded at the top is the replay guard, so it is removed again: with it
 *  left in place a BoomFi Replay would be answered "replay" and a paid account would stay Free. 500 so the delivery shows as failed. */
async function failAndForget(sb: ReturnType<typeof getSupabaseAdmin>, payloadHash: string, what: string, err: unknown) {
  await sb.from(T.boomfi_webhook_events).delete().eq('payload_hash', payloadHash);
  return apiError('boomfi/webhook', new Error(`${what} failed after a verified payment - nothing granted, delivery left replayable: ${(err as { message?: string })?.message ?? String(err)}`));
}
