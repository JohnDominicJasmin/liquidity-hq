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
import { T } from '@/lib/tables';
import { ExtraTool } from '@/lib/limits';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
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

// Returns the new count on success, or null if the caller was already at/over
// the limit (blocked - no row was written).
export async function incrementUsageColumn(
  token: string, userId: string, column: string, limit: number,
): Promise<number | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb(token).rpc('increment_ai_usage', {
    p_user_id: userId, p_date: today, p_column: column, p_limit: limit,
  });
  if (error) {
    console.error(`[aiUsage] increment_ai_usage failed for ${column}:`, error.message);
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
