import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { isLsApiConfigured } from '@/lib/lemonsqueezyApi';

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
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await getAuthedUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from(T.user_subscriptions)
      .select('role, ls_status, ls_subscription_id, current_period_end')
      .eq('user_id', userId)
      .maybeSingle();
    // Fail closed: an unknown state must not render a Cancel button that would
    // then hit the guarded route and fail. 503 lets the panel show a neutral
    // "couldn't load" rather than a wrong control.
    if (error) { console.error('[subscription] GET:', error.message); return NextResponse.json({ error: 'Failed to load' }, { status: 503 }); }

    const role = (data?.role as string) ?? 'free';
    const lsStatus = (data?.ls_status as string) ?? null;
    const currentPeriodEnd = (data?.current_period_end as string) ?? null;
    const hasSubscription = Boolean(data?.ls_subscription_id);
    // Cancel is offered only for a live, LS-backed, not-already-cancelled Pro
    // subscription, and only where the server can actually call LS.
    const canCancel = role === 'pro' && hasSubscription && lsStatus !== 'cancelled' && isLsApiConfigured();

    return NextResponse.json({ role, lsStatus, currentPeriodEnd, hasSubscription, canCancel });
  } catch (e) {
    console.error('[subscription] GET exception:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: 'Failed to load' }, { status: 503 });
  }
}
