// Single source of truth for per-tier daily AI usage limits.
// Enforced by the grok / grok-chat / briefing API routes, returned to the
// client (the UsageMeter reads these off the API response), and used to build
// the pricing copy on /upgrade. Change a number HERE and every functional
// surface follows - no more hand-syncing the same limit across three routes.
//
// NOTE: the localized landing-page marketing copy in lib/i18n/dictionaries.ts
// (ko/zh/ar) still embeds these numbers inside translated sentences and must be
// updated by hand when a limit changes - it can't be templated without
// restructuring the i18n dictionaries. The English /upgrade page IS derived
// from here, so at minimum the primary pricing surface never drifts.

export type Tier = 'free' | 'pro';

// Fast timeframes are Pro-only. Kept here (not in app/arena) because three
// other surfaces need the same rule: Arena's chart clamp, the Settings
// "default timeframe" chips, and onboarding's style-based default. When this
// lived only in Arena, Settings happily let a free user save `5m` and Arena
// then silently rewrote it to 1h on load with no explanation.
export const GATED_TFS = ['1m', '5m', '15m'] as const;
export const FREE_FALLBACK_TF = '1h';
export function isGatedTf(tf: string): boolean {
  return (GATED_TFS as readonly string[]).includes(tf);
}

// One-shot analysis tools gated by lib/aiUsage.ts (thesis-check, strategy-research,
// shadow-account, behavioral-bias, pine-script, hypotheses/[id]/analyze). No web
// search tools, cheaper per-call than `deep`, but still real xAI spend - previously
// unbounded.
export type ExtraTool =
  | 'thesisCheck' | 'strategyResearch' | 'shadowAccount'
  | 'behavioralBias' | 'pineScript' | 'hypothesisAnalyze' | 'tokenUnlock'
  | 'smcSnapshot' | 'dryPowder' | 'macroContext' | 'onchain';

// `toolPool` is a SHARED daily budget across all 11 ExtraTool routes, on top of
// each tool's own cap. Why it exists: 11 separate per-tool caps multiply out -
// at 18 each that's a 198-call/day ceiling per Pro user (~43% of the whole
// worst-case xAI bill) for tools nobody actually runs 18 times a day. A pool
// collapses that ceiling while making each individual tool MORE generous: a
// Pro user who only ever runs SMC snapshots gets 25 of them, not 6.
// null = no pool, per-tool caps are the only gate (free tier - keeping
// per-tool caps there means a free user can still sample every tool instead
// of burning one shared budget on the first one they click).
export const AI_LIMITS: Record<Tier, {
  quick: number; deep: number; chat: number; search: number; briefing: number;
  toolPool: number | null;
} & Record<ExtraTool, number>> = {
  free: {
    quick: 5,  deep: 3,  chat: 5,  search: 3,  briefing: 2,
    toolPool: null,
    thesisCheck: 2, strategyResearch: 2, shadowAccount: 2,
    behavioralBias: 2, pineScript: 2, hypothesisAnalyze: 2, tokenUnlock: 2,
    smcSnapshot: 2, dryPowder: 2, macroContext: 2, onchain: 2,
  },
  pro: {
    quick: 30, deep: 10, chat: 50, search: 10, briefing: 4,
    toolPool: 25,
    // Per-tool caps equal the pool on purpose: the pool is what actually
    // binds, so any single tool can use the whole budget if that's what the
    // user wants. Lowering one of these below `toolPool` would re-introduce
    // the per-tool ceiling the pool exists to remove.
    thesisCheck: 25, strategyResearch: 25, shadowAccount: 25,
    behavioralBias: 25, pineScript: 25, hypothesisAnalyze: 25, tokenUnlock: 25,
    smcSnapshot: 25, dryPowder: 25, macroContext: 25, onchain: 25,
  },
};
