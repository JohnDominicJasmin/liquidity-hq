// SERVER ONLY (imports supabase-admin). The per-feature AI engine switch (#1631, group 4).
//
// WHAT THIS IS, AND WHAT IT IS NOT YET. It answers one question - "for this call type, Grok or
// Claude?" - from an `app_config` row, and nothing more. No route reads it yet, so with the row
// absent (its state today) every call stays on Grok and the app behaves exactly as before. Wiring a
// route to `engineFor` is a later change, per call type, after the bake-off and the owner's key.
//
// WHY app_config AND NOT AN ENV VAR. The same mechanism lib/featureFlags.ts uses: a single row, read
// with a short TTL and failing OPEN, so a flip takes effect in seconds with no deploy - an env var
// on Render needs a redeploy. "Open" here means Grok: the engine whose legal strings are already
// published and whose economics do not depend on a grant. An unreadable config must never silently
// route a live call to Claude.
//
// X-DEPENDENT CALLS ARE NOT ELIGIBLE. `deep`, `chat_search` and `onchain` read X posts (xAI's search
// tools); only Grok has those, so they can never switch and are not in the set below. `verdict_repair`
// retries another call and must inherit ITS engine, so it is not independently switchable either -
// it is absent from the set, so `engineFor('verdict_repair')` is always 'grok' here, and the retry
// path will pass the original call's engine explicitly when that path is built.
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';
import { AI_CALL_TYPES, type AiCallType } from '@/lib/aiCost';

export type Engine = 'grok' | 'claude';

/* The call types whose input is OUR OWN NUMBERS, not X posts - the only ones a read can run on Claude
   (#1631, owner's split by input). Everything outside this set resolves to Grok unconditionally. */
export const CLAUDE_ELIGIBLE: ReadonlySet<AiCallType> = new Set<AiCallType>([
  'quick', 'chat', 'briefing',
  'thesis_check', 'strategy_research', 'shadow_account', 'behavioral_bias',
  'pine_script', 'hypothesis_analyze', 'token_unlock', 'smc_snapshot',
  'dry_powder', 'macro_context', 'draw_structure',
]);

// Same shape and TTL as featureFlags: one app_config row, value a map of call type -> engine. A
// missing key, a lookup failure, or any value that is not exactly 'claude' leaves that type on Grok.
const TTL_MS = 15_000;
let cache: { data: Partial<Record<AiCallType, Engine>>; expires: number } | null = null;

async function getEngineMap(): Promise<Partial<Record<AiCallType, Engine>>> {
  if (cache && cache.expires > Date.now()) return cache.data;
  let data: Partial<Record<AiCallType, Engine>> = {};
  try {
    const { data: row } = await getSupabaseAdmin().from(T.app_config)
      .select('value').eq('key', 'ai_engines').maybeSingle();
    const v = (row?.value ?? {}) as Record<string, unknown>;
    // Only a literal 'claude' for a KNOWN call type is honoured; everything else is dropped, so a
    // typo or an unexpected value cannot route anywhere but Grok.
    const out: Partial<Record<AiCallType, Engine>> = {};
    for (const t of AI_CALL_TYPES) if (v[t] === 'claude') out[t] = 'claude';
    data = out;
  } catch {
    // FAIL OPEN TO GROK: a broken config read must not move a live call to Claude.
    data = {};
  }
  cache = { data, expires: Date.now() + TTL_MS };
  return data;
}

/** Which engine serves this call type right now. 'claude' only when the call type is X-free AND the
 *  config says so; 'grok' in every other case - ineligible type, absent/unknown flag, or a failed
 *  read. Server-only; mirrors isFeatureEnabled's cached, fail-open read. */
export async function engineFor(callType: AiCallType): Promise<Engine> {
  if (!CLAUDE_ELIGIBLE.has(callType)) return 'grok';
  const map = await getEngineMap();
  return map[callType] === 'claude' ? 'claude' : 'grok';
}

/** Test seam: drop the cached map so the next engineFor re-reads. Mirrors the pattern the feature
 *  flags test uses; no production caller. */
export function __resetEngineCache(): void { cache = null; }
