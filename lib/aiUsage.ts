// Atomic daily-cap gate for every AI route (grok, grok-chat, briefing, and the
// one-shot tools: thesis-check, strategy-research, shadow-account,
// behavioral-bias, pine-script, hypotheses/[id]/analyze).
//
// Calls the `increment_ai_usage` Postgres function (see
// supabase/migrations/20260804c_atomic_ai_usage_increment.sql) instead of the
// old read-count-then-upsert pattern - that was a TOCTOU race: two concurrent
// requests could both read the same under-limit count and both pass the
// check before either write landed, exceeding the daily cap. The DB function
// does the check-and-increment as a single atomic UPDATE ... WHERE <col> <
// limit, so Postgres's row lock serializes concurrent callers.
//
// No refund on a failed xAI call after a successful increment - see the
// migration file's comment for why that tradeoff was chosen over a second
// compensating-write path.
import { createClient } from '@supabase/supabase-js';
import { AI_LIMITS, ExtraTool, Tier } from '@/lib/limits';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

// The ONLY place "what day is it" gets decided for daily-cap bucketing.
// Every route that checks or increments a cap must call this - never
// `new Date()` inline - so there is exactly one place to audit for the abuse
// case this exists to prevent: a user changing their OS/browser timezone, or
// routing through a VPN in another region, to make the app think a new day
// has started and get a fresh quota mid-day.
//
// That attack cannot work against this function, for two independent reasons:
//   1. It runs on the SERVER. The client never supplies a date, a timezone,
//      or anything this function reads - it takes no arguments. Grep every
//      route in app/api that touches a usage cap; none destructure `date` or
//      `timezone` out of the request body, headers, or query string. There is
//      no wire from client input to this value - not a validated wire, no
//      wire at all.
//   2. `toISOString()` is specified by ECMA-262 to always render UTC,
//      regardless of the server process's own TZ. Even a misconfigured
//      container clock could not make this function disagree with itself
//      from one call to the next in a way a client could steer.
// A per-user local "day" (using user_settings.timezone, added for Telegram
// alert display - see components/TimezoneSync.tsx) must NEVER be substituted
// in here: that field is client-writable by design, and doing so would
// reopen exactly this hole - a user picks a favorable timezone, the day
// boundary moves for them specifically, quota resets on demand. It exists
// for one purpose (cosmetic display) and must stay confined to it.
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// App-wide daily xAI ceiling - a circuit breaker on top of the per-user caps.
// Per-user caps stop one account looping; this stops a FLEET of farmed accounts
// each staying under its own cap from collectively blowing the budget. Once
// today's total xAI calls across ALL users hits this number, every route
// blocks. Unset/0/invalid => breaker disabled (per-user caps still apply).
// Tune in Render env without a redeploy of logic - just bump the number.
function globalDailyMax(): number | null {
  const raw = Number(process.env.AI_GLOBAL_DAILY_MAX);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

const EXTRA_TOOL_COLUMN: Record<ExtraTool, string> = {
  thesisCheck:       'thesis_check_count',
  strategyResearch:  'strategy_research_count',
  shadowAccount:     'shadow_account_count',
  behavioralBias:    'behavioral_bias_count',
  pineScript:        'pine_script_count',
  hypothesisAnalyze: 'hypothesis_analyze_count',
  tokenUnlock:       'token_unlock_count',
  smcSnapshot:       'smc_snapshot_count',
  dryPowder:         'dry_powder_count',
  macroContext:      'macro_context_count',
  onchain:           'onchain_count',
};

// blocked.reason distinguishes what actually blocked the caller - this user's
// own daily count for this one feature, the shared one-shot-tool pool, or the
// app-wide circuit breaker. Callers use it to give an accurate error message:
// every route used to say "your daily limit reached" even when a user's own
// count was nowhere near their cap and the real cause was the shared breaker
// tripping - confusing (the usage meter shows the real, unexhausted per-user
// count right next to that message) and simply wrong about the cause. `limit`
// is the number that was actually hit, so the message can't quote a different
// cap than the one that blocked the call.
export type UsageBlockReason = 'user' | 'global' | 'pool';

export type UsageIncrementResult =
  | { blocked: false; count: number }
  | { blocked: true; reason: UsageBlockReason; limit: number };

export async function incrementUsageColumn(
  token: string, userId: string, column: string, limit: number,
  poolLimit: number | null = null,
): Promise<UsageIncrementResult> {
  const today = todayUtc();
  const { data, error } = await sb(token).rpc('increment_ai_usage', {
    p_user_id: userId, p_date: today, p_column: column, p_limit: limit,
    p_global_limit: globalDailyMax(),
    p_pool_limit: poolLimit,
  });
  if (error) {
    console.error(`[aiUsage] increment_ai_usage failed for ${column}:`, error.message);
    return { blocked: true, reason: 'user', limit };
  }
  // -1 / -2 are the DB sentinels for the two shared caps (distinct from null =
  // this column's own per-user cap). Any increment already made was rolled
  // back in-txn before the sentinel was returned.
  if (data === -1) {
    console.error(`[aiUsage] GLOBAL daily xAI cap hit (AI_GLOBAL_DAILY_MAX) - blocked ${column} for ${userId}`);
    return { blocked: true, reason: 'global', limit };
  }
  if (data === -2) {
    return { blocked: true, reason: 'pool', limit: poolLimit ?? limit };
  }
  if (data === null) {
    return { blocked: true, reason: 'user', limit };
  }
  return { blocked: false, count: data as number };
}

// Convenience wrapper for the 11 one-shot tool routes (keyed by lib/limits.ts's
// ExtraTool union instead of a raw column string). Takes the caller's tier
// rather than a pre-looked-up number so the per-tool cap and the shared pool
// can never be sourced from different places - passing one without the other
// is what would silently disable the pool for a route.
export async function incrementToolUsage(
  token: string, userId: string, tool: ExtraTool, role: Tier,
): Promise<UsageIncrementResult> {
  return incrementUsageColumn(
    token, userId, EXTRA_TOOL_COLUMN[tool],
    AI_LIMITS[role][tool], AI_LIMITS[role].toolPool,
  );
}

// Shared message builder so all 14 call sites word this identically.
export function rateLimitMessage(
  reason: UsageBlockReason, limit: number, label: string,
): string {
  if (reason === 'global') {
    return `AI Arena is at capacity right now across all users - try again shortly.`;
  }
  if (reason === 'pool') {
    // "one-shot tool" is our internal name for these routes - a user has no
    // idea what it means, so say what they'd actually observe instead.
    return `Daily limit of ${limit} AI tool runs reached. All the AI analysis tools share one daily budget.`;
  }
  return `Daily limit of ${limit} ${label} reached.`;
}

// Global-only check for call sites with no natural per-user attribution - a
// single shared commentary call in a cron fanning out to many recipients at
// once (app/api/telegram/alert/route.ts's checkEMASignal), not one user's own
// request. increment_ai_usage() needs a real per-user row in lhq_grok_usage,
// which doesn't fit here; this touches only lhq_global_ai_usage, via the
// service-role client since the caller is a cron, not a signed-in user.
// Fail-open on a Supabase error (matches every other Supabase-unreachable
// path in the alert cron) - a DB hiccup should never silently kill AI
// commentary that would otherwise be within budget.
export async function incrementGlobalUsage(): Promise<boolean> {
  const limit = globalDailyMax();
  if (limit === null) return true; // breaker disabled
  const today = todayUtc();
  const { data, error } = await getSupabaseAdmin().rpc('increment_global_ai_usage', {
    p_date: today, p_global_limit: limit,
  });
  if (error) {
    console.error('[aiUsage] increment_global_ai_usage failed:', error.message);
    return true;
  }
  if (data === -1) {
    console.error('[aiUsage] GLOBAL daily xAI cap hit (AI_GLOBAL_DAILY_MAX) - blocked checkEMASignal commentary');
    return false;
  }
  return true;
}
