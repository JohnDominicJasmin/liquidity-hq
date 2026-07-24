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
import { ExtraTool } from '@/lib/limits';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
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
};

// Returns the new count on success, or null if the caller is blocked - either
// by their own per-user cap or by the global daily circuit breaker. Both cases
// return null to the caller (identical client-facing 429), but a global-cap
// trip is logged distinctly server-side so it's visible in the logs.
export async function incrementUsageColumn(
  token: string, userId: string, column: string, limit: number,
): Promise<number | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb(token).rpc('increment_ai_usage', {
    p_user_id: userId, p_date: today, p_column: column, p_limit: limit,
    p_global_limit: globalDailyMax(),
  });
  if (error) {
    console.error(`[aiUsage] increment_ai_usage failed for ${column}:`, error.message);
    return null;
  }
  // -1 is the DB sentinel for "global daily cap reached" (distinct from null =
  // per-user cap). The per-user increment was already rolled back in-txn.
  if (data === -1) {
    console.error(`[aiUsage] GLOBAL daily xAI cap hit (AI_GLOBAL_DAILY_MAX) - blocked ${column} for ${userId}`);
    return null;
  }
  return data as number | null;
}

// Convenience wrapper for the 6 one-shot tool routes (keyed by lib/limits.ts's
// ExtraTool union instead of a raw column string).
export async function incrementToolUsage(
  token: string, userId: string, tool: ExtraTool, limit: number,
): Promise<number | null> {
  return incrementUsageColumn(token, userId, EXTRA_TOOL_COLUMN[tool], limit);
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
  const today = new Date().toISOString().slice(0, 10);
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
