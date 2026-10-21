import { NextResponse } from 'next/server';
import { apiError } from '@/lib/apiError';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { estimateRowCostUsd, revenuePerMonthUsd, recordedPlan, ALL_USAGE_COLUMNS } from '@/lib/aiCost';
import { sendBanEmail } from '@/lib/email';
import { planKindOfRow, paidByProvider } from '@/lib/paidPeriod';

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
    // Whole row, for the same reason as /api/ops/ai-cost: `plan` (#1403,
    // migration 20261001h) may not exist yet, and naming it would fail this
    // read and show the account as Free with no ban reason.
    admin.from(T.user_subscriptions).select('*').eq('user_id', id).maybeSingle(),
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
  // #1630: the role the account is on NOW (lib/paidPeriod.ts planKindOfRow): a stored 'pro' whose paid time has lapsed shows as Free here too.
  const role = planKindOfRow(sub.data, Date.now()) === 'pro' ? 'pro' : 'free';
  const plan = recordedPlan(sub.data?.plan);
  const paid = paidByProvider(sub.data);
  const revenueMonthly = revenuePerMonthUsd(role, plan);

  return NextResponse.json({
    id: u.id,
    email: u.email ?? null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    banned: !!(u.banned_until && new Date(u.banned_until).getTime() > Date.now()),
    bannedUntil: u.banned_until ?? null,
    banReason: sub.data?.ban_reason ?? null,
    subscription: {
      role,
      storedRole: sub.data?.role ?? 'free',
      lsStatus: sub.data?.ls_status ?? null,
      currentPeriodEnd: sub.data?.current_period_end ?? null,
      plan,
      billingProvider: paid.provider,
      // #1630 GO-LIVE 4: true only for a Pro with no payment behind it (an admin-set or legacy comp) - the one kind Revoke Pro may end.
      manualGrant: role === 'pro' && !paid.paid,
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

/* #1630 GO-LIVE 4: NO 'grant_pro'. It wrote role 'pro' with no period end, which is lifetime Pro (lib/paidPeriod.ts never lapses a null end) - a manual
   grant, which the owner's rule forbids: Pro comes only from a payment, through the provider's webhook. A request for it now answers "Unknown action".
   'revoke_pro' stays, for a Pro with no payment behind it only: on a paid account it would strip time the buyer has paid for (cancel keeps paid time,
   owner rule), so it is refused there. */
type UserAction = 'revoke_pro' | 'ban' | 'unban' | 'reset_ai_limit';
const VALID_ACTIONS: UserAction[] = ['revoke_pro', 'ban', 'unban', 'reset_ai_limit'];

// A near-permanent ban (Supabase requires a finite duration string, not "forever").
const BAN_DURATION = '876000h'; // 100 years

// PATCH /api/ops/users/[id] - account actions. Any admin (owner or staff) may
// act - Team management is the owner-only surface, not this. Every action is
// audited. Self-ban is blocked so an admin can never lock themselves out.
export const PATCH = withAdmin<[{ params: Promise<{ id: string }> }]>(async (req, { user }, { params }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action as UserAction;
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
  if (action === 'ban' && id === user.id) {
    return NextResponse.json({ error: 'You cannot ban your own account.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  let emailSent = false;

  switch (action) {
    case 'revoke_pro': {
      const { data: row, error: readErr } = await admin.from(T.user_subscriptions).select('*').eq('user_id', id).maybeSingle();
      if (readErr) return apiError('ops/users/[id]', readErr);
      if (row?.role !== 'pro') return NextResponse.json({ error: 'This account is not on Pro.' }, { status: 400 });
      const paid = paidByProvider(row);
      if (paid.paid) {
        return NextResponse.json({
          error: `This account pays for Pro${paid.provider ? ` through ${paid.provider}` : ''}. Its Pro ends when its paid time ends; it cannot be revoked here.`,
        }, { status: 409 });
      }
      // Only the role column is written, on the existing row.
      const { error } = await admin.from(T.user_subscriptions)
        .update({ role: 'free', updated_at: new Date().toISOString() })
        .eq('user_id', id);
      if (error) return apiError('ops/users/[id]', error);
      break;
    }
    case 'ban':
    case 'unban': {
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: action === 'ban' ? BAN_DURATION : 'none',
      });
      if (error) return apiError('ops/users/[id]', error);
      await admin.from(T.user_subscriptions).upsert(
        { user_id: id, ban_reason: action === 'ban' ? (reason || null) : null, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
      // No unban email - the account can just sign back in, nothing to notify.
      if (action === 'ban') {
        const { data: target } = await admin.auth.admin.getUserById(id);
        if (target?.user?.email) emailSent = await sendBanEmail({ to: target.user.email, reason });
      }
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
    detail: action === 'ban' ? { emailSent } : {},
  });

  return NextResponse.json({ ok: true });
});
