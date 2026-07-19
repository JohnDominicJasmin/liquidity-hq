import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;
const USAGE_COLS = ['deep_count', 'quick_count', 'chat_count', 'chat_search_count', 'briefing_count'] as const;

// AI (Grok) cost & usage. Two datasets:
//  - alert_grok_log: system-level calls made by the alert cron (no user_id).
//  - grok_usage: per-user daily counts (deep/quick/chat/chat_search/briefing).
export const GET = withAdmin(async () => {
  const admin = getSupabaseAdmin();
  const now = Date.now();
  const since14 = new Date(now - 14 * DAY).toISOString();

  // System calls, last 14 days.
  const { data: logs } = await admin.from(T.alert_grok_log)
    .select('called_at, signal_type')
    .gte('called_at', since14)
    .order('called_at', { ascending: false })
    .limit(5000);

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

  // Per-user usage, last 7 days.
  const since7Date = new Date(now - 7 * DAY).toISOString().slice(0, 10);
  const { data: usage } = await admin.from(T.grok_usage)
    .select('*')
    .gte('date', since7Date);

  const userTotals = new Map<string, number>();
  for (const row of usage ?? []) {
    const uid = row.user_id as string;
    let sum = 0;
    for (const c of USAGE_COLS) sum += Number(row[c] ?? 0);
    userTotals.set(uid, (userTotals.get(uid) ?? 0) + sum);
  }
  const topIds = [...userTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Resolve just the top handful of ids to emails (cheap, avoids paging all users).
  const topUsers = await Promise.all(topIds.map(async ([userId, total]) => {
    let email: string | null = null;
    try {
      const { data } = await admin.auth.admin.getUserById(userId);
      email = data.user?.email ?? null;
    } catch { /* deleted user - leave email null */ }
    return { userId, email, total };
  }));

  return NextResponse.json({
    system: { total24h, total7d, perDay, byType },
    topUsers,
    generatedAt: new Date(now).toISOString(),
  });
});
