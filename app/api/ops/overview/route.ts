import { NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { selectAllRows } from '@/lib/selectAllRows';
import { planKindOfRow, paidByProvider } from '@/lib/paidPeriod';

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

// Users + revenue overview. Reads auth.users (service-role, paginated) for
// signup/activity, and user_subscriptions for the paying count.
export const GET = withAdmin(async () => {
  const admin = getSupabaseAdmin();
  const now = Date.now();

  // Page through every auth user. Cap at 50 pages (50k users) as a runaway guard,
  // far above current scale.
  const perPage = 1000;
  const users: { created_at?: string; last_sign_in_at?: string | null }[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return apiError('ops/overview', error);
    users.push(...data.users.map(u => ({ created_at: u.created_at, last_sign_in_at: u.last_sign_in_at })));
    if (data.users.length < perPage) break;
  }

  const within = (ts: string | null | undefined, ms: number) =>
    !!ts && now - new Date(ts).getTime() <= ms;

  const totalUsers = users.length;

  /* Pro / paying counts (#1630). These were head-only counts of the STORED role ('pro') and of Lemon Squeezy's ls_status 'active', so a lapsed Whop
     buyer still counted as Pro and no Whop buyer ever counted as paying. Now the stored-'pro' rows are read (paged, they are a small set) and counted
     by the rule every other reader uses: Pro = planKindOfRow says pro (paid time + 48 h, or a hand-set Pro); paying = that AND a payment provider
     behind it (paidByProvider). */
  const { data: proRows, error: proErr } = await selectAllRows('ops:overview:pro_rows', 'user_id', () =>
    admin.from(T.user_subscriptions).select('*').eq('role', 'pro'));
  if (proErr) return apiError('ops/overview', proErr);
  const proNow = (proRows ?? []).filter(r => planKindOfRow(r, now) === 'pro');
  const proUsers = proNow.length;
  const activePaying = proNow.filter(r => paidByProvider(r).paid).length;

  return NextResponse.json({
    totalUsers,
    proUsers,
    freeUsers: Math.max(0, totalUsers - proUsers),
    activePaying,
    signups7d:  users.filter(u => within(u.created_at, 7 * DAY)).length,
    signups30d: users.filter(u => within(u.created_at, 30 * DAY)).length,
    active7d:   users.filter(u => within(u.last_sign_in_at, 7 * DAY)).length,
    active30d:  users.filter(u => within(u.last_sign_in_at, 30 * DAY)).length,
    generatedAt: new Date(now).toISOString(),
  });
});
