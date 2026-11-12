// SERVER ONLY (imports supabase-admin). The per-feature AI engine switch (#1631, group 4).
//
// WHAT THIS IS, AND WHAT IT IS NOT YET. It answers one question - "for this call type, which model?"
// - from an `app_config` row, and nothing more. No route reads it yet, so with the row absent (its
// state today) every call stays on Grok and the app behaves exactly as before. Wiring a route to
// `engineFor` is a later change, per call type, after the bake-off and the owner's key.
//
// WHY A MODEL, NOT JUST A VENDOR. The owner's split is by input (#1631): an X-free read can run on
// Claude, and WHICH Claude is a cost/quality call he makes per feature - Haiku for the cheap reads,
// up to Opus for the ones worth it. So the flag value is a model id, not a 'grok'/'claude' bit, and
// `engineFor` returns the model a route should call. 'grok' stays the token for Grok (one model, its
// id pinned at the call site); every other value is a specific Anthropic model id.
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
import { AI_CALL_TYPES, type AiCallType, ANTHROPIC_RATES_BY_MODEL } from '@/lib/aiCost';

/* The Claude models a call may be routed to. THE ALLOWLIST IS lib/aiCost.ts's ANTHROPIC_RATES_BY_MODEL,
   read at runtime below - a model that has no row in that rate table cannot be selected, because a
   call we cannot price is a call we will not make. CLAUDE_MODELS is that key set. The ClaudeModel
   union is the same list spelled out for callers' ergonomics (a route can switch on it), but it is a
   convenience, not the gate: `engineFor` validates against CLAUDE_MODELS, so the TABLE wins. No
   compile-time coupling is claimed between the two - the table's keys are typed `string`, so tsc
   cannot check either direction, and a check that cannot fail is not written. A model added to the
   table is honoured at runtime at once; it just will not narrow in a caller's switch until it is
   added to the union too. */
export type ClaudeModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export type Engine = 'grok' | ClaudeModel;

export const CLAUDE_MODELS: ReadonlySet<string> = new Set(Object.keys(ANTHROPIC_RATES_BY_MODEL));

/* The call types whose input is OUR OWN NUMBERS, not X posts - the only ones a read can run on Claude
   (#1631, owner's split by input). Everything outside this set resolves to Grok unconditionally. */
export const CLAUDE_ELIGIBLE: ReadonlySet<AiCallType> = new Set<AiCallType>([
  'quick', 'chat', 'briefing',
  'thesis_check', 'strategy_research', 'shadow_account', 'behavioral_bias',
  'pine_script', 'hypothesis_analyze', 'token_unlock', 'smc_snapshot',
  'dry_powder', 'macro_context', 'draw_structure',
]);

// Same shape and TTL as featureFlags: one app_config row, value a map of call type -> model id. A
// missing key, a lookup failure, or any value that is not an allowlisted Claude model leaves that
// type on Grok.
const TTL_MS = 15_000;
let cache: { data: Partial<Record<AiCallType, Engine>>; expires: number } | null = null;

async function getEngineMap(): Promise<Partial<Record<AiCallType, Engine>>> {
  if (cache && cache.expires > Date.now()) return cache.data;
  let data: Partial<Record<AiCallType, Engine>> = {};
  try {
    const { data: row } = await getSupabaseAdmin().from(T.app_config)
      .select('value').eq('key', 'ai_engines').maybeSingle();
    const v = (row?.value ?? {}) as Record<string, unknown>;
    // Only an allowlisted Claude model id, for a KNOWN and eligible call type, is honoured. Anything
    // else - 'grok', a typo, an unpriced model, an X-dependent call type - is dropped, so it can
    // route nowhere but Grok. CLAUDE_ELIGIBLE is re-checked here as well as in engineFor so a stale
    // or hand-edited row cannot seat a model on a type that must never leave Grok.
    const out: Partial<Record<AiCallType, Engine>> = {};
    for (const t of AI_CALL_TYPES) {
      if (!CLAUDE_ELIGIBLE.has(t)) continue;
      const val = v[t];
      if (typeof val === 'string' && CLAUDE_MODELS.has(val)) out[t] = val as ClaudeModel;
    }
    data = out;
  } catch {
    // FAIL OPEN TO GROK: a broken config read must not move a live call to Claude.
    data = {};
  }
  cache = { data, expires: Date.now() + TTL_MS };
  return data;
}

/** Which model serves this call type right now. An allowlisted Claude model only when the call type
 *  is X-free AND the config names that model; 'grok' in every other case - ineligible type, absent or
 *  unknown flag, an unpriced model, or a failed read. Server-only; mirrors isFeatureEnabled's cached,
 *  fail-open read. */
export async function engineFor(callType: AiCallType): Promise<Engine> {
  if (!CLAUDE_ELIGIBLE.has(callType)) return 'grok';
  const map = await getEngineMap();
  return map[callType] ?? 'grok';
}

/** Test seam: drop the cached map so the next engineFor re-reads. Mirrors the pattern the feature
 *  flags test uses; no production caller. */
export function __resetEngineCache(): void { cache = null; }
