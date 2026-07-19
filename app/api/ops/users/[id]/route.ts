import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;
const USAGE_COLS = ['deep_count', 'quick_count', 'chat_count', 'chat_search_count', 'briefing_count'] as const;

// Single-user detail: identity, subscription, and AGGREGATES/COUNTS only.
// Deliberately does NOT return raw trades/hypotheses/settings/watchlist content -
// that's private per-user data (see the Monitor MVP's out-of-scope note); admin
// gets counts and activity signals, not a window into what a user actually wrote.
export const GET = withAdmin<[{ params: Promise<{ id: string }> }]>(async (_req, _ctx, { params }) => {
  const { id } = await params;
  const admin = getSupabaseAdmin();

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(id);
  if (userErr || !userData.user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const u = userData.user;

  const since14 = new Date(Date.now() - 14 * DAY).toISOString().slice(0, 10);

  const [sub, onboarding, pushCount, usageRows, tradesCount, hypothesesCount, priceAlertsCount] = await Promise.all([
    admin.from(T.user_subscriptions).select('role, ls_status, current_period_end').eq('user_id', id).maybeSingle(),
    admin.from(T.user_onboarding).select('tour_seen, checklist_telegram, checklist_price_alert, checklist_grok, checklist_coins').eq('user_id', id).maybeSingle(),
    admin.from(T.push_subscriptions).select('*', { count: 'exact', head: true }).eq('user_id', id),
    admin.from(T.grok_usage).select('*').eq('user_id', id).gte('date', since14),
    admin.from(T.trades).select('*', { count: 'exact', head: true }).eq('user_id', id),
    admin.from(T.hypotheses).select('*', { count: 'exact', head: true }).eq('user_id', id),
    admin.from(T.price_alerts).select('*', { count: 'exact', head: true }).eq('user_id', id),
  ]);

  const checklist = onboarding.data;
  const checklistDone = checklist
    ? [checklist.checklist_telegram, checklist.checklist_price_alert, checklist.checklist_grok, checklist.checklist_coins].filter(Boolean).length
    : 0;

  const aiUsage14d: { day: string; total: number }[] = [];
  const byDay = new Map<string, number>();
  for (const row of usageRows.data ?? []) {
    let sum = 0;
    for (const c of USAGE_COLS) sum += Number(row[c] ?? 0);
    byDay.set(row.date, (byDay.get(row.date) ?? 0) + sum);
  }
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    aiUsage14d.push({ day, total: byDay.get(day) ?? 0 });
  }

  return NextResponse.json({
    id: u.id,
    email: u.email ?? null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    banned: !!(u.banned_until && new Date(u.banned_until).getTime() > Date.now()),
    bannedUntil: u.banned_until ?? null,
    subscription: {
      role: sub.data?.role ?? 'free',
      lsStatus: sub.data?.ls_status ?? null,
      currentPeriodEnd: sub.data?.current_period_end ?? null,
    },
    onboarding: { tourSeen: !!checklist?.tour_seen, checklistDone, checklistTotal: 4 },
    pushSubscriptions: pushCount.count ?? 0,
    counts: {
      trades: tradesCount.count ?? 0,
      hypotheses: hypothesesCount.count ?? 0,
      priceAlerts: priceAlertsCount.count ?? 0,
    },
    aiUsage14d,
  });
});
