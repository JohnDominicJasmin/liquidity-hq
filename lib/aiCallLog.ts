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
import { reportHealth, healthError } from '@/lib/apiHealth';

/* THE WRITE'S OWN HEALTH ROW (#1631, PM: a broken write was only a console line, invisible with Render logs unavailable, while the per-user AI caps read these rows). `ai:call-log-write` is ok after a row
   lands and not ok after a failed insert, throttled like every health source (a state change writes within the floor, a steady state at most once per interval). The detail is the same bounded
   error text the console line already carried: nothing about the user or the call. */
const HEALTH_SOURCE = 'ai:call-log-write';

export interface AiCallRecord {
  /** Verified server-side from the caller's token - every call site already has it
   *  in hand for the daily-cap increment, because the increment comes first. */
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
    if (error) {
      console.error(`[aiCallLog] insert failed for ${rec.callType}: ${error.message}`);
      reportHealth(HEALTH_SOURCE, 'ai', false, healthError(error.message));
    } else {
      reportHealth(HEALTH_SOURCE, 'ai', true, 'ok');
    }
  } catch (e) {
    console.error(`[aiCallLog] insert threw for ${rec.callType}: ${e instanceof Error ? e.message : String(e)}`);
    reportHealth(HEALTH_SOURCE, 'ai', false, healthError(e));
  }
}
