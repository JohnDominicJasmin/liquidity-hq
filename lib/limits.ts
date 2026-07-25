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

// One-shot analysis tools gated by lib/aiUsage.ts (thesis-check, strategy-research,
// shadow-account, behavioral-bias, pine-script, hypotheses/[id]/analyze). No web
// search tools, cheaper per-call than `deep`, but still real xAI spend - previously
// unbounded.
export type ExtraTool =
  | 'thesisCheck' | 'strategyResearch' | 'shadowAccount'
  | 'behavioralBias' | 'pineScript' | 'hypothesisAnalyze' | 'tokenUnlock'
  | 'smcSnapshot' | 'dryPowder' | 'macroContext' | 'onchain';

export const AI_LIMITS: Record<Tier, {
  quick: number; deep: number; chat: number; search: number; briefing: number;
} & Record<ExtraTool, number>> = {
  free: {
    quick: 5,  deep: 3,  chat: 10,  search: 3,  briefing: 2,
    thesisCheck: 3, strategyResearch: 3, shadowAccount: 3,
    behavioralBias: 3, pineScript: 3, hypothesisAnalyze: 3, tokenUnlock: 3,
    smcSnapshot: 3, dryPowder: 3, macroContext: 3, onchain: 3,
  },
  pro: {
    quick: 40, deep: 18, chat: 75, search: 18, briefing: 8,
    thesisCheck: 18, strategyResearch: 18, shadowAccount: 18,
    behavioralBias: 18, pineScript: 18, hypothesisAnalyze: 18, tokenUnlock: 18,
    smcSnapshot: 18, dryPowder: 18, macroContext: 18, onchain: 18,
  },
};
