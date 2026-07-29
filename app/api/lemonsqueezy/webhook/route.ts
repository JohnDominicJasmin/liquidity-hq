import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { apiError } from '@/lib/apiError';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

const SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '';

function verifySignature(payload: string, signature: string): boolean {
  if (!SECRET) return false;
  const digest = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(digest, 'hex'));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-signature') ?? '';
  const payload = await req.text();

  if (!verifySignature(payload, signature)) {
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

  if (!userId) return NextResponse.json({ received: true });

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

  if (!acctEmail || !payerEmail || acctEmail !== payerEmail) {
    apiError('lemonsqueezy/webhook', new Error(
      `Payer/account email mismatch - refusing to grant. event=${eventName} user_id=${userId} ` +
      `payer=${payerEmail || '(none)'} account=${acctEmail || '(unknown user)'}`,
    ));
    return NextResponse.json({ received: true, ignored: 'email_mismatch' });
  }

  const isActive = attrs.status === 'active';

  switch (eventName) {
    case 'subscription_created':
    case 'subscription_updated':
    case 'subscription_payment_success': {
      await sb.from(T.user_subscriptions).upsert({
        user_id:            userId,
        role:               isActive ? 'pro' : 'free',
        ls_subscription_id: String(event.data?.id ?? ''),
        ls_customer_id:     String(attrs.customer_id ?? ''),
        ls_status:          attrs.status ?? '',
        current_period_end: attrs.renews_at ?? attrs.ends_at ?? null,
        updated_at:         new Date().toISOString(),
      }, { onConflict: 'user_id' });
      break;
    }
    case 'subscription_cancelled':
    case 'subscription_expired': {
      await sb.from(T.user_subscriptions).upsert({
        user_id:    userId,
        role:       'free',
        ls_status:  attrs.status ?? eventName.replace('subscription_', ''),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      break;
    }
  }

  return NextResponse.json({ received: true });
}
