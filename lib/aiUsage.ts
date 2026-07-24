// Shared daily-cap gate for the one-shot AI analysis routes (thesis-check,
// strategy-research, shadow-account, behavioral-bias, pine-script,
// hypotheses/[id]/analyze). These previously had auth checks but no usage cap -
// any signed-in user could loop-call them and run up the xAI bill.
//
// Mirrors app/api/grok/route.ts's pattern: read usage + role, check the limit,
// call the AI, then increment only on success (so a failed xAI call doesn't
// burn quota). Same read-then-write race as grok/route.ts - see PENDING.md
// finding #2 (TOCTOU on daily caps) for the follow-up fix.
import { createClient } from '@supabase/supabase-js';
import { T } from '@/lib/tables';
import { getUserRole } from '@/lib/entitlements';
import { AI_LIMITS, ExtraTool } from '@/lib/limits';

function sb(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}

const COLUMN: Record<ExtraTool, string> = {
  thesisCheck:       'thesis_check_count',
  strategyResearch:  'strategy_research_count',
  shadowAccount:     'shadow_account_count',
  behavioralBias:    'behavioral_bias_count',
  pineScript:        'pine_script_count',
  hypothesisAnalyze: 'hypothesis_analyze_count',
};

export async function checkToolUsage(
  token: string, userId: string, tool: ExtraTool,
): Promise<{ used: number; limit: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const column = COLUMN[tool];
  const client = sb(token);
  const [{ data }, role] = await Promise.all([
    client.from(T.grok_usage).select(column).eq('user_id', userId).eq('date', today).maybeSingle(),
    getUserRole(token, userId),
  ]);
  const used = (data as Record<string, number> | null)?.[column] ?? 0;
  return { used, limit: AI_LIMITS[role][tool] };
}

export async function incrementToolUsage(
  token: string, userId: string, tool: ExtraTool, currentUsed: number,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const column = COLUMN[tool];
  const { error } = await sb(token).from(T.grok_usage).upsert(
    { user_id: userId, date: today, [column]: currentUsed + 1, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,date' },
  );
  if (error) console.error(`[aiUsage] usage upsert failed for ${tool}:`, error.message);
}
