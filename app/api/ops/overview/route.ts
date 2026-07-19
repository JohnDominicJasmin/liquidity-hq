import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

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
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    users.push(...data.users.map(u => ({ created_at: u.created_at, last_sign_in_at: u.last_sign_in_at })));
    if (data.users.length < perPage) break;
  }

  const within = (ts: string | null | undefined, ms: number) =>
    !!ts && now - new Date(ts).getTime() <= ms;

  const totalUsers = users.length;

  // Pro / paying counts straight from subscriptions (head-only, no rows pulled).
  const proQ = await admin.from(T.user_subscriptions)
    .select('*', { count: 'exact', head: true })
    .eq('role', 'pro');
  const proUsers = proQ.count ?? 0;

  const payingQ = await admin.from(T.user_subscriptions)
    .select('*', { count: 'exact', head: true })
    .eq('role', 'pro')
    .eq('ls_status', 'active');
  const activePaying = payingQ.count ?? 0;

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
