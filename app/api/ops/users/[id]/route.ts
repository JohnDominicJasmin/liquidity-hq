import { NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { estimateRowCostUsd, PRO_PRICE_USD_PER_MONTH, ALL_USAGE_COLUMNS } from '@/lib/aiCost';

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;
// Was a hand-picked 5 of the 13 real usage columns (missing all 8 one-shot
// tools - thesis check, strategy research, pine script, etc) - undercounted
// "Total calls" for any account that used a tool. Now the full set, same
// source ALL_USAGE_COLUMNS the app-wide /ops cost view already uses.
const USAGE_COLS = ALL_USAGE_COLUMNS;

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
  const aiCost14d: { day: string; cost: number }[] = [];
  const byDay = new Map<string, number>();
  const costByDay = new Map<string, number>();
  const byTypeMap = new Map<string, number>();
  for (const row of usageRows.data ?? []) {
    let sum = 0;
    for (const c of USAGE_COLS) {
      const n = Number(row[c] ?? 0);
      sum += n;
      if (n) byTypeMap.set(c, (byTypeMap.get(c) ?? 0) + n);
    }
    byDay.set(row.date, (byDay.get(row.date) ?? 0) + sum);
    costByDay.set(row.date, (costByDay.get(row.date) ?? 0) + estimateRowCostUsd(row as Record<string, number | null>));
  }
  const callsByType = [...byTypeMap.entries()]
    .map(([type, count]) => ({ type: type.replace(/_count$/, ''), count }))
    .sort((a, b) => b.count - a.count);
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    aiUsage14d.push({ day, total: byDay.get(day) ?? 0 });
    aiCost14d.push({ day, cost: costByDay.get(day) ?? 0 });
  }
  const cost14dTotal = aiCost14d.reduce((s, d) => s + d.cost, 0);
  const role = sub.data?.role === 'pro' ? 'pro' : 'free';
  const revenueMonthly = role === 'pro' ? PRO_PRICE_USD_PER_MONTH : 0;

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
    aiCost14d,
    callsByType,
    cost14dTotal,
    revenueMonthly,
    margin14d: revenueMonthly - cost14dTotal,
  });
});

type UserAction = 'grant_pro' | 'revoke_pro' | 'ban' | 'unban' | 'reset_ai_limit';
const VALID_ACTIONS: UserAction[] = ['grant_pro', 'revoke_pro', 'ban', 'unban', 'reset_ai_limit'];

// A near-permanent ban (Supabase requires a finite duration string, not "forever").
const BAN_DURATION = '876000h'; // 100 years

// PATCH /api/ops/users/[id] - account actions. Any admin (owner or staff) may
// act - Team management is the owner-only surface, not this. Every action is
// audited. Self-ban is blocked so an admin can never lock themselves out.
export const PATCH = withAdmin<[{ params: Promise<{ id: string }> }]>(async (req, { user }, { params }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action as UserAction;
  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
  if (action === 'ban' && id === user.id) {
    return NextResponse.json({ error: 'You cannot ban your own account.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  switch (action) {
    case 'grant_pro':
    case 'revoke_pro': {
      // Only the role column is written - upsert with a partial payload leaves
      // any existing Lemon Squeezy fields (ls_status, ls_subscription_id, etc.)
      // untouched, so comping a free user never clobbers a real subscription's
      // billing state, and revoking a comp doesn't touch billing either.
      const role = action === 'grant_pro' ? 'pro' : 'free';
      const { error } = await admin.from(T.user_subscriptions).upsert(
        { user_id: id, role, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
      if (error) return apiError('ops/users/[id]', error);
      break;
    }
    case 'ban':
    case 'unban': {
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: action === 'ban' ? BAN_DURATION : 'none',
      });
      if (error) return apiError('ops/users/[id]', error);
      break;
    }
    case 'reset_ai_limit': {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await admin.from(T.grok_usage).delete().eq('user_id', id).eq('date', today);
      if (error) return apiError('ops/users/[id]', error);
      break;
    }
  }

  await admin.from(T.admin_audit_log).insert({
    actor_email: user.email,
    action: `user_${action}`,
    target_user_id: id,
    detail: {},
  });

  return NextResponse.json({ ok: true });
});
