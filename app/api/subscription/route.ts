import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { isLsApiConfigured } from '@/lib/lemonsqueezyApi';
import { planKindOfRow } from '@/lib/paidPeriod';
import { membershipStateForAccount } from '@/lib/whopGrant';
import { getUserCompat } from '@/lib/authUser';

export const dynamic = 'force-dynamic';

/* The caller's OWN subscription state, for the settings "Subscription" panel
 * (#1396). The client (components/AuthProvider.tsx) deliberately reads only
 * role/trial_ends_at; the cancel panel additionally needs ls_status and
 * current_period_end, so it reads them here rather than widening that context
 * for every page. Auth + user_id filter as in app/api/alert-prefs/route.ts.
 *
 * Never returns the raw ls_subscription_id or ls_customer_id - the browser has
 * no use for them and they should not leave the server. `canCancel` is computed
 * HERE (server-side) so the button's presence and the route's guard agree. */

async function getAuthedUserId(req: NextRequest): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  // #1397: verified locally (lib/authUser.ts), no Auth round trip per request.
  const { data } = await getUserCompat(token);
  return data.user?.id ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await getAuthedUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from(T.user_subscriptions)
      .select('role, trial_ends_at, ls_status, ls_subscription_id, current_period_end, billing_provider')
      .eq('user_id', userId)
      .maybeSingle();
    // Fail closed: an unknown state must not render a Cancel button that would
    // then hit the guarded route and fail. 503 lets the panel show a neutral
    // "couldn't load" rather than a wrong control.
    if (error) { console.error('[subscription] GET:', error.message); return NextResponse.json({ error: 'Failed to load' }, { status: 503 }); }

    /* #1630 GO-LIVE 1: the role the account is on NOW. A stored 'pro' whose paid period (+48 h) has lapsed is reported as free, like everywhere else. */
    const role = planKindOfRow(data, Date.now()) === 'pro' ? 'pro' : 'free';
    const lsStatus = (data?.ls_status as string) ?? null;
    const currentPeriodEnd = (data?.current_period_end as string) ?? null;
    const hasSubscription = Boolean(data?.ls_subscription_id);
    // Cancel is offered only for a live, LS-backed, not-already-cancelled Pro
    // subscription, and only where the server can actually call LS.
    const canCancel = role === 'pro' && hasSubscription && lsStatus !== 'cancelled' && isLsApiConfigured();

    /* #1630 Step 1: which processor the row is on, and whether it is set to stop renewing.
     *
     * The cancel state is read only for a live Whop Pro - one lookup keyed on this account, skipped for everybody else, which is
     * nearly every caller. Null (no linked membership: paid before Step 1, or a payment body that carried no membership id) reads as
     * "not cancelled", so the panel shows the renewing view and the link out to Whop rather than inventing a state. */
    const provider = (data?.billing_provider as string) ?? null;
    let cancelAtPeriodEnd = false;
    let canceledAt: string | null = null;
    if (role === 'pro' && provider === 'whop') {
      const state = await membershipStateForAccount(db, userId);
      cancelAtPeriodEnd = state?.cancelAtPeriodEnd === true;
      canceledAt = state?.canceledAt ?? null;
    }

    return NextResponse.json({ role, lsStatus, currentPeriodEnd, hasSubscription, canCancel, provider, cancelAtPeriodEnd, canceledAt });
  } catch (e) {
    console.error('[subscription] GET exception:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'Failed to load' }, { status: 503 });
  }
}
