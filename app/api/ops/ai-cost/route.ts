import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { estimateRowCostUsd, PRO_PRICE_USD_PER_MONTH } from '@/lib/aiCost';

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

// AI (Grok) cost & usage. Three datasets:
//  - alert_grok_log: system-level calls made by the alert cron (no user_id).
//  - grok_usage: per-user daily counts (deep/quick/chat/chat_search/briefing/
//    + 8 one-shot tools) - the basis for the $ estimates below.
//  - global_ai_usage: the circuit breaker's single daily counter, read here
//    only to show "today's calls vs AI_GLOBAL_DAILY_MAX" and raise a spike
//    flag - grok_usage is the source for the actual $ figures since it has
//    the per-call-type breakdown the flat counter doesn't.
export const GET = withAdmin(async () => {
  const admin = getSupabaseAdmin();
  const now = Date.now();
  const since14 = new Date(now - 14 * DAY).toISOString();

  // System calls, last 14 days.
  const { data: logs, error: logsErr } = await admin.from(T.alert_grok_log)
    .select('called_at, signal_type')
    .gte('called_at', since14)
    .order('called_at', { ascending: false })
    .limit(5000);
  if (logsErr) return NextResponse.json({ error: logsErr.message }, { status: 500 });

  const perDayMap = new Map<string, number>();
  const byTypeMap = new Map<string, number>();
  let total24h = 0;
  let total7d = 0;
  for (const l of logs ?? []) {
    const t = new Date(l.called_at).getTime();
    const day = l.called_at.slice(0, 10);
    perDayMap.set(day, (perDayMap.get(day) ?? 0) + 1);
    const type = l.signal_type ?? 'unknown';
    byTypeMap.set(type, (byTypeMap.get(type) ?? 0) + 1);
    if (now - t <= DAY) total24h++;
    if (now - t <= 7 * DAY) total7d++;
  }
  // Last 14 calendar days, oldest -> newest, zero-filled for a clean sparkline.
  const perDay: { day: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(now - i * DAY).toISOString().slice(0, 10);
    perDay.push({ day, count: perDayMap.get(day) ?? 0 });
  }
  const byType = [...byTypeMap.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // Per-user usage, last 30 days - enough to bucket into 24h/7d/30d $ figures.
  const today = new Date(now).toISOString().slice(0, 10);
  const since30Date = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  const since7Date = new Date(now - 7 * DAY).toISOString().slice(0, 10);
  const [{ data: usage, error: usageErr }, { data: subs }, { data: globalToday }] = await Promise.all([
    admin.from(T.grok_usage).select('*').gte('date', since30Date),
    admin.from(T.user_subscriptions).select('user_id, role'),
    admin.from(T.global_ai_usage).select('xai_call_count').eq('date', today).maybeSingle(),
  ]);
  if (usageErr) return NextResponse.json({ error: usageErr.message }, { status: 500 });

  const roleByUser = new Map((subs ?? []).map(s => [s.user_id as string, s.role as string]));

  // $ cost buckets by recency, per user and app-wide. grok_usage only has a
  // `date` column (no timestamp), so "24h"/"7d" here means calendar-day
  // buckets (today; today back 7 days) - same granularity the rest of /ops
  // already uses (aiUsage14d on the user-detail page is day-bucketed too).
  const userCost24h = new Map<string, number>();
  const userCost7d = new Map<string, number>();
  const userCost30d = new Map<string, number>();
  let globalCost24h = 0, globalCost7d = 0, globalCost30d = 0;

  for (const row of usage ?? []) {
    const uid = row.user_id as string;
    const date = row.date as string;
    const cost = estimateRowCostUsd(row as Record<string, number | null>);
    userCost30d.set(uid, (userCost30d.get(uid) ?? 0) + cost);
    globalCost30d += cost;
    if (date >= since7Date) {
      userCost7d.set(uid, (userCost7d.get(uid) ?? 0) + cost);
      globalCost7d += cost;
    }
    if (date === today) {
      userCost24h.set(uid, (userCost24h.get(uid) ?? 0) + cost);
      globalCost24h += cost;
    }
  }

  const topSpenderIds = [...userCost30d.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Resolve just the top spenders we're about to show to emails (cheap,
  // avoids paging all users).
  const emailById = new Map<string, string | null>();
  await Promise.all(topSpenderIds.map(async ([id]) => {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      emailById.set(id, data.user?.email ?? null);
    } catch { emailById.set(id, null); /* deleted user - leave email null */ }
  }));

  const topSpenders = topSpenderIds.map(([userId, cost30d]) => {
    const role = roleByUser.get(userId) ?? 'free';
    const revenueMonthly = role === 'pro' ? PRO_PRICE_USD_PER_MONTH : 0;
    return {
      userId,
      email: emailById.get(userId) ?? null,
      role,
      cost24h: userCost24h.get(userId) ?? 0,
      cost7d: userCost7d.get(userId) ?? 0,
      cost30d,
      revenueMonthly,
      margin: revenueMonthly - cost30d,
    };
  });

  const globalDailyMax = Number(process.env.AI_GLOBAL_DAILY_MAX);
  const globalCapCalls = Number.isFinite(globalDailyMax) && globalDailyMax > 0 ? globalDailyMax : null;
  const todayCalls = globalToday?.xai_call_count ?? 0;
  const spikeAlert = globalCapCalls != null && todayCalls >= globalCapCalls * 0.8;

  return NextResponse.json({
    system: { total24h, total7d, perDay, byType },
    topSpenders,
    cost: { global24h: globalCost24h, global7d: globalCost7d, global30d: globalCost30d },
    globalBreaker: { todayCalls, capCalls: globalCapCalls, spikeAlert },
    generatedAt: new Date(now).toISOString(),
  });
});
