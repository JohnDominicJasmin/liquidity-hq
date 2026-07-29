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

// The PAID role, as stored in lhq_user_subscriptions.role.
export type Tier = 'free' | 'pro';

// What a request is actually billed against. Distinct from Tier because a
// trial user is role='free' but has Pro feature access, and those two facts
// used to collapse onto the same limits row - which meant the "free" numbers
// were really the trial allowance, and any attempt to tighten free tightened
// trial instead. Splitting them lets each say what it means.
// Tier is a subset of UsageTier, so `AI_LIMITS[role]` still type-checks for
// the callers that legitimately only know the paid role.
export type UsageTier = 'free' | 'trial' | 'pro';

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
//
// All 11 ExtraTool routes are Pro-only: each calls hasProFeatures() and returns
// 403 PRO_REQUIRED, which is what /upgrade has always sold
// (UPGRADE_PRO_FEATURE_TOOL_POOL sits in the Pro column; the Free column never
// listed tools). Until 2026-08-07 only 6 of the 11 enforced it, so a free
// account really could run the other 5 - that gap is closed.
//
// THREE rows, not two. A trial user is role='free' with Pro feature access, so
// before the trial row existed they were billed against `free` - which made the
// free numbers secretly the trial allowance and left two bugs:
//   1. free had toolPool: null, so a trial got 2 x 11 = 22 UNPOOLED tool calls
//      a day against a paying Pro user's 25 pooled. Nearly no reason to upgrade
//      on tool volume, and up to ~300 calls per 14-day trial.
//   2. UsageRings hides any ring whose limit is 0, and toolPool null -> 0, so a
//      trial user could run the tools but had no counter for them - they just
//      hit "Daily limit reached" with no warning.
// Splitting the rows fixes both and lets `free` finally say what it means: zero,
// because a free account never gets past the route gate. Keeping it at 0 rather
// than deleting it is deliberate defence in depth - if a gate ever regresses,
// the cap still refuses the spend.
//
// Trial keeps Free-tier CORE AI spend (quick/deep/chat/search/briefing) - the
// long-standing "Pro tools, Free AI spend" rule in lib/entitlements.ts - and
// gets its own real tool pool, set below Pro so upgrading still buys something.
export const AI_LIMITS: Record<UsageTier, {
  quick: number; deep: number; chat: number; search: number; briefing: number;
  toolPool: number | null;
} & Record<ExtraTool, number>> = {
  free: {
    quick: 5,  deep: 3,  chat: 5,  search: 3,  briefing: 2,
    toolPool: null,
    thesisCheck: 0, strategyResearch: 0, shadowAccount: 0,
    behavioralBias: 0, pineScript: 0, hypothesisAnalyze: 0, tokenUnlock: 0,
    smcSnapshot: 0, dryPowder: 0, macroContext: 0, onchain: 0,
  },
  trial: {
    quick: 5,  deep: 3,  chat: 5,  search: 3,  briefing: 2,
    toolPool: 8,
    // Per-tool caps equal the pool for the same reason as Pro: the pool is what
    // binds, so a trial user can spend their whole tool budget on the one tool
    // they actually care about instead of being forced to sample.
    thesisCheck: 8, strategyResearch: 8, shadowAccount: 8,
    behavioralBias: 8, pineScript: 8, hypothesisAnalyze: 8, tokenUnlock: 8,
    smcSnapshot: 8, dryPowder: 8, macroContext: 8, onchain: 8,
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
