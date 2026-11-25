import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { revenuePerMonthUsd, recordedPlan, ALL_USAGE_COLUMNS } from '@/lib/aiCost';
import { spendSumToUsd, type SpendSumRow } from '@/lib/aiSpendCap';
import { selectAllRows } from '@/lib/selectAllRows';

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

// AI (Grok) cost & usage. Four datasets:
//  - alert_grok_log: system-level calls made by the alert cron (no user_id).
//  - ai_call_log: one row per AI call with its RECORDED cost - every $ figure
//    below (#1413). A row with no cost counts at the same estimate the spend caps
//    use (lib/aiSpendCap.ts). Site totals are summed in the database, so no row
//    bound applies to them; the per-user list is read in pages and says when cut.
//  - grok_usage: per-user daily counts (deep/quick/chat/chat_search/briefing/
//    + 11 one-shot tools) - calls by type only. The authoritative column list is
//    ALL_USAGE_COLUMNS in lib/aiCost.ts.
//  - global_ai_usage: the circuit breaker's single daily counter, read here
//    only to show "today's calls vs AI_GLOBAL_DAILY_MAX" and raise a spike
//    flag.
export const GET = withAdmin(async () => {
  const admin = getSupabaseAdmin();
  const now = Date.now();
  const since14 = new Date(now - 14 * DAY).toISOString();

  // System calls, last 14 days. Paged (#1397): PostgREST answers at most 1000
  // rows per request and clamps without an error - the old `.limit(5000)` was
  // clamped to 1000 too - so the 7-day and 14-day call counts stopped at the
  // newest 1000 calls. Ordered by id, the bigserial primary key.
  const { data: logs, error: logsErr, truncated: logsTruncated } = await selectAllRows('ops:ai-cost:alert_grok_log', 'id', () =>
    admin.from(T.alert_grok_log)
      .select('called_at, signal_type')
      .gte('called_at', since14));
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

  // Usage counts and recorded cost over the last 30 days.
  const today = new Date(now).toISOString().slice(0, 10);
  const since30Date = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  const since24Iso = new Date(now - DAY).toISOString();
  const since7Iso = new Date(now - 7 * DAY).toISOString();
  const since30Iso = new Date(now - 30 * DAY).toISOString();
  const spendSince = (since: string) => admin.rpc('lhq_ai_spend_all_since', { p_since: since });
  const [
    { data: usage, error: usageErr, truncated: usageTruncated },
    { data: subs, error: subsErr, truncated: subsTruncated },
    { data: globalToday },
    { data: calls, error: callsErr, truncated: callsTruncated },
    spend24, spend7, spend30,
  ] = await Promise.all([
    // Paged (#1397): one row per user per day, so a plain read stopped at 1000
    // user-days and every $ total and call count below came out short.
    // Ordered by (user_id, date), the primary key.
    selectAllRows('ops:ai-cost:grok_usage', ['user_id', 'date'], () =>
      admin.from(T.grok_usage).select('*').gte('date', since30Date)),
    // Whole rows, not 'user_id, role, plan': `plan` (#1403) comes with
    // migration 20261001h, which is applied on its own schedule. Naming a
    // column the database does not have fails the whole read, and every account
    // would then show as Free. A whole row from a database without it simply
    // has no `plan`, which reads as "not recorded" - the monthly price, as before.
    // Paged (#1397): past 1000 accounts, a Pro top spender could fall outside
    // the read and show as Free with no revenue.
    selectAllRows('ops:ai-cost:user_subscriptions', 'user_id', () =>
      admin.from(T.user_subscriptions).select('*')),
    admin.from(T.global_ai_usage).select('xai_call_count').eq('date', today).maybeSingle(),
    selectAllRows('ops:ai-cost:ai_call_log', 'id', () =>
      admin.from(T.ai_call_log).select('id, user_id, call_type, cost_usd, created_at').gte('created_at', since30Iso)),
    spendSince(since24Iso),
    spendSince(since7Iso),
    spendSince(since30Iso),
  ]);
  // A failed read is an error, never $0 spend or every account shown as Free.
  const readErr = usageErr ?? subsErr ?? callsErr ?? spend24.error ?? spend7.error ?? spend30.error;
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const subByUser = new Map((subs ?? []).map(s => [
    s.user_id as string,
    { role: s.role as string, plan: recordedPlan(s.plan) },
  ]));

  // Recorded $ per user over the last 24 hours, 7 days and 30 days.
  const userCost24h = new Map<string, number>();
  const userCost7d = new Map<string, number>();
  const userCost30d = new Map<string, number>();
  for (const call of calls ?? []) {
    const uid = call.user_id as string | null;
    if (!uid) continue; // a scheduled job's call: in the site totals, nobody's row
    const unknown = call.cost_usd == null;
    const cost = spendSumToUsd({
      cost: call.cost_usd as number | string | null,
      null_search: unknown && call.call_type === 'chat_search' ? 1 : 0,
      null_other: unknown && call.call_type !== 'chat_search' ? 1 : 0,
    });
    const at = new Date(call.created_at as string).getTime();
    userCost30d.set(uid, (userCost30d.get(uid) ?? 0) + cost);
    if (now - at <= 7 * DAY) userCost7d.set(uid, (userCost7d.get(uid) ?? 0) + cost);
    if (now - at <= DAY) userCost24h.set(uid, (userCost24h.get(uid) ?? 0) + cost);
  }
  const siteUsd = (data: unknown) => spendSumToUsd((Array.isArray(data) ? data[0] : data) as SpendSumRow | null);

  // Call-count breakdown by feature (quick/deep/chat/etc), summed across
  // every user, 30-day window - answers "how many calls of each kind have
  // we made," distinct from the $ totals above (which come from the call
  // ledger). Mirrors system.byType's shape below, which
  // does the same thing for the alert cron's signal types.
  const userCallsByTypeMap = new Map<string, number>();

  for (const row of usage ?? []) {
    for (const col of ALL_USAGE_COLUMNS) {
      const n = Number((row as Record<string, number | null>)[col] ?? 0);
      if (n) userCallsByTypeMap.set(col, (userCallsByTypeMap.get(col) ?? 0) + n);
    }
  }
  const userCallsByType = [...userCallsByTypeMap.entries()]
    .map(([type, count]) => ({ type: type.replace(/_count$/, ''), count }))
    .sort((a, b) => b.count - a.count);

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
    const sub = subByUser.get(userId);
    const role = sub?.role ?? 'free';
    const plan = sub?.plan ?? null;
    const revenueMonthly = revenuePerMonthUsd(role, plan);
    return {
      userId,
      email: emailById.get(userId) ?? null,
      role,
      plan,
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
    userCallsByType,
    topSpenders,
    cost: { global24h: siteUsd(spend24.data), global7d: siteUsd(spend7.data), global30d: siteUsd(spend30.data) },
    globalBreaker: { todayCalls, capCalls: globalCapCalls, spikeAlert },
    // true only if a read reached selectAllRows' 10,000-row bound - the counts
    // and the per-user list are then a minimum, and the AI cost card says so.
    truncated: logsTruncated || usageTruncated || subsTruncated || callsTruncated,
    generatedAt: new Date(now).toISOString(),
  });
});
