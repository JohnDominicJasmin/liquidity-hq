// SERVER ONLY (imports supabase-admin). One row per xAI call the app makes on a
// user's behalf: what kind of call, which model, the token counts and what it
// cost - from xAI's own usage figure, not an estimate (#1399 part 1). This is
// what the per-account monthly spend ceiling (part 2) and the owner's cost
// number will be built on, so a missing row here is a missing dollar there.
//
// NEVER lets bookkeeping break the answer. The user has already paid for the
// call by the time this runs; a failed insert loses one data point, not their
// result. So this catches everything, logs a one-liner, and returns.
//
// NOTHING PRIVATE IN THE LOGS. The only things that reach console (and from
// there GlitchTip) are the call type and a Supabase error message - never the
// user id, an email, or a byte of prompt or completion text. The row itself
// carries user_id because the whole point is per-account cost; that is data in
// the database, not a log line.
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { parseAiUsage, type AiCallType } from '@/lib/aiCost';

export interface AiCallRecord {
  /** Verified server-side from the caller's token - all sixteen call sites
   *  already have it in hand for the daily-cap increment. */
  userId: string;
  callType: AiCallType;
  /** The model the RESPONSE names (xAI echoes it back), falling back to the one
   *  the request asked for. */
  model: string;
  /** The raw `usage` object off xAI's response body, exactly as received.
   *  Undefined, null or malformed is fine: it records as 'unknown'. */
  usage: unknown;
}

export async function recordAiCall(rec: AiCallRecord): Promise<void> {
  const cost = parseAiUsage(rec.model, rec.usage);
  try {
    const { error } = await getSupabaseAdmin().from(T.ai_call_log).insert({
      user_id:           rec.userId,
      call_type:         rec.callType,
      model:             rec.model,
      prompt_tokens:     cost.promptTokens,
      completion_tokens: cost.completionTokens,
      cost_usd:          cost.costUsd,
      cost_source:       cost.source,
    });
    if (error) console.error(`[aiCallLog] insert failed for ${rec.callType}: ${error.message}`);
  } catch (e) {
    console.error(`[aiCallLog] insert threw for ${rec.callType}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
