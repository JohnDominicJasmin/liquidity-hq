import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { patchForEvent, payerOwnsAccount, verifyWebhookSignature } from '@/lib/lemonsqueezy';

const SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '';

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-signature') ?? '';
  const payload = await req.text();

  if (!verifyWebhookSignature(payload, signature, SECRET)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(payload);
  const eventName: string = event.meta?.event_name ?? '';
  const attrs = event.data?.attributes ?? {};
  const userId: string | undefined = event.meta?.custom_data?.user_id;

  // Ignore test-mode events in production - a LemonSqueezy test-mode purchase
  // uses a fake card and must never grant real Pro. Dev keeps them so the
  // checkout flow can be exercised end to end.
  const isProd = process.env.NEXT_PUBLIC_APP_ENV !== 'dev';
  if (isProd && attrs.test_mode === true) {
    return NextResponse.json({ received: true, ignored: 'test_mode' });
  }

  /* SAY WHY, rather than a bare 200 (#243).
   *
   * `custom_data.user_id` is put there by getCheckoutUrl, so it is present on
   * any event from an order that went through our checkout - and ABSENT on an
   * event simulated from the Lemon Squeezy dashboard against an order created
   * some other way. Simulated events are how the cancelled/expired/refunded
   * branches get exercised without waiting for a real billing period, so this
   * path is about to be hit deliberately.
   *
   * It used to return a bare `{received: true}`. Lemon Squeezy shows that as a
   * green delivery, so "nothing happened" looked identical to "it worked" -
   * the same failure shape as the empty-200 in #228, on the payments path.
   *
   * Still 2xx on purpose: a non-2xx makes Lemon Squeezy RETRY, and an event with
   * no user of ours attached is not a failure to retry - it is correctly not
   * ours. The reason string is what makes it visible. */
  if (!userId) {
    return NextResponse.json({ received: true, ignored: 'no custom_data.user_id' });
  }

  const sb = getSupabaseAdmin();

  // ── Replay guard ────────────────────────────────────────────────────────
  // LemonSqueezy retries on any non-2xx with a byte-identical body. The
  // handlers below are idempotent upserts today, so a replay is only wasteful
  // - but this stops the next non-idempotent thing added here from becoming a
  // billing bug. Hash of the raw body, because the payload carries no
  // per-event id (meta.webhook_id is the webhook CONFIG, not the delivery).
  const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
  const { data: firstSeen, error: dedupErr } = await sb
    .from(T.ls_webhook_events)
    .insert({ payload_hash: payloadHash, event_name: eventName })
    .select('payload_hash')
    .maybeSingle();
  // A duplicate key is the expected "already handled" path, not a failure.
  if (dedupErr && dedupErr.code !== '23505') return apiError('lemonsqueezy/webhook', dedupErr);
  if (!firstSeen) return NextResponse.json({ received: true, ignored: 'replay' });

  // ── Ownership check ─────────────────────────────────────────────────────
  // user_id arrives in custom_data, which lib/checkout.ts writes into a
  // CLIENT-SIDE checkout URL - so the payer chooses it. The signature proves
  // LemonSqueezy sent this, never that the payer owns the account they named.
  // Without this check someone edits the id in their own browser, makes one
  // genuine purchase, and Pro lands on any account they like.
  //
  // Fails CLOSED: a mismatch grants nothing. Returns 200 so LemonSqueezy stops
  // retrying a delivery that will never succeed, and reports to GlitchTip so a
  // legitimate mismatch (someone paying from a different address than they
  // signed up with - a real thing) surfaces as something to reconcile by hand
  // rather than a silent refusal the customer has to chase.
  const payerEmail = String(attrs.user_email ?? '').trim().toLowerCase();
  const { data: acct } = await sb.auth.admin.getUserById(userId);
  const acctEmail = (acct?.user?.email ?? '').trim().toLowerCase();

  if (!payerOwnsAccount(payerEmail, acctEmail)) {
    apiError('lemonsqueezy/webhook', new Error(
      `Payer/account email mismatch - refusing to grant. event=${eventName} user_id=${userId} ` +
      `payer=${payerEmail || '(none)'} account=${acctEmail || '(unknown user)'}`,
    ));
    return NextResponse.json({ received: true, ignored: 'email_mismatch' });
  }

  // The decision lives in lib/lemonsqueezy.ts so it can be tested without a
  // database, a signature or a LemonSqueezy account - see the comment there.
  // null means an event we do not act on, which must stay distinguishable from
  // "act, and the result is no change".
  const patch = patchForEvent(eventName, attrs, String(event.data?.id ?? ''));
  if (!patch) return NextResponse.json({ received: true, ignored: 'unhandled_event' });

  await sb.from(T.user_subscriptions).upsert({
    user_id:    userId,
    ...patch,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  return NextResponse.json({ received: true });
}
