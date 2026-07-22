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

export const AI_LIMITS: Record<Tier, {
  quick: number; deep: number; chat: number; search: number; briefing: number;
}> = {
  free: { quick: 7,  deep: 5,  chat: 15,  search: 5,  briefing: 3  },
  pro:  { quick: 50, deep: 25, chat: 100, search: 25, briefing: 10 },
};
