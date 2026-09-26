import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { apiError } from '@/lib/apiError';
import { cancelSubscription, isLsApiConfigured } from '@/lib/lemonsqueezyApi';

export const dynamic = 'force-dynamic';

/* Cancel the CALLER'S OWN subscription (#1396).
 *
 * BOLA is the whole point: the subscription id is NEVER read from the request
 * body - it is derived from the authenticated user's own `user_subscriptions`
 * row. A user can only ever cancel the subscription their row holds, so no
 * crafted id can cancel someone else's plan. Mirrors the auth pattern in
 * app/api/alert-prefs/route.ts.
 *
 * This route does NOT write the row. LemonSqueezy's cancel fires the
 * subscription webhooks, and lib/lemonsqueezy.ts (Fix A/B) is the single writer:
 * it keeps `role` pro and access to `ends_at` (the owner's 2026-08-08 rule). Two
 * writers of the same row is how #1429 happened; there is one here.
 *
 * FAILS CLOSED everywhere: unauthenticated, no subscription to cancel, already
 * cancelled, the LS API key unset (prod today), or ANY unexpected LS response ->
 * no state change, a machine reason reported to GlitchTip, a clean status to the
 * client. DOCUMENTED-not-observed until QA runs the first real call on qa. */

async function getAuthedUserId(req: NextRequest): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

export async function POST(req: NextRequest) {
  const userId = await getAuthedUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  // The feature is unavailable where the server has no LS API key (prod today).
  // 200 with a clear reason, not an error: the UI hides the button in this state,
  // and a probe should not look like a server fault.
  if (!isLsApiConfigured()) {
    return NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 200 });
  }

  // Derive the subscription id from the caller's OWN row. Service-role read
  // filtered by user_id; the filter is the boundary (same as alert-prefs).
  let stored: { role: string | null; ls_subscription_id: string | null; ls_status: string | null } | null = null;
  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from(T.user_subscriptions)
      .select('role, ls_subscription_id, ls_status')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      apiError('lemonsqueezy/cancel', new Error(`stored-row read failed: ${error.message}`));
      return NextResponse.json({ ok: false, error: 'Failed to read subscription' }, { status: 503 });
    }
    // supabase-js infers `never` for a dynamic table name, so cast through unknown.
    stored = (data as unknown) as { role: string | null; ls_subscription_id: string | null; ls_status: string | null } | null;
  } catch (e) {
    apiError('lemonsqueezy/cancel', e instanceof Error ? e : new Error(String(e)));
    return NextResponse.json({ ok: false, error: 'Failed to read subscription' }, { status: 503 });
  }

  const subId = stored?.ls_subscription_id ?? '';
  // Guards mirror GET /api/subscription's `canCancel`, so the button and this
  // route agree (QA #1435 D1). All are 200 with a clean reason - the UI should
  // not have offered cancel in these states, so they are not errors.
  //   - not pro: free/trial, or a demoted row (past_due/expired left role free)
  //     that still carries a stale subscription id.
  //   - no id: an admin/pre-column pro grant with nothing at LS to cancel.
  //   - already cancelled.
  if (stored?.role !== 'pro') {
    return NextResponse.json({ ok: false, reason: 'not_pro' }, { status: 200 });
  }
  if (!subId) {
    return NextResponse.json({ ok: false, reason: 'no_subscription' }, { status: 200 });
  }
  if (stored?.ls_status === 'cancelled') {
    return NextResponse.json({ ok: false, reason: 'already_cancelled' }, { status: 200 });
  }

  const result = await cancelSubscription(subId);

  if (!result.ok) {
    // The first real qa call is the capture: log the redacted reason + status so
    // an unexpected LS shape is observed rather than silently mishandled. No row
    // write happened. Reported to GlitchTip; the client gets a generic failure.
    apiError('lemonsqueezy/cancel', new Error(
      `LS cancel failed for user=${userId} - reason=${result.reason} http=${result.status} body=${result.bodyRedacted}`,
    ));
    return NextResponse.json({ ok: false, error: 'Cancel failed' }, { status: 502 });
  }

  // Success. Log the redacted response too (QA #1435): the first real qa call
  // must capture a SUCCESS shape, not only failures. Not an error - console, not
  // apiError/GlitchTip.
  console.log(
    `[lemonsqueezy/cancel] ok user=${userId} http=${result.status} ` +
    `lsStatus=${result.lsStatus ?? 'null'} endsAt=${result.endsAt ?? 'null'} body=${result.bodyRedacted}`,
  );
  // The webhook writes the row (role stays pro, ls_status 'cancelled',
  // current_period_end = ends_at). Return the ends_at LS reported so the UI can
  // say "access until <date>" without waiting for the webhook.
  return NextResponse.json({ ok: true, endsAt: result.endsAt });
}
