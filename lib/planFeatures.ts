import type { LabelKey } from './labelKeys.ts';
import { AI_LIMITS } from './limits.ts';

/* Single source of truth for the FREE plan's feature list, shown on BOTH
 * surfaces (#1152): the in-app /upgrade screen (app/upgrade/page.tsx, label
 * system) and the landing-page pricing card (components/LandingTerminal.tsx,
 * i18n dictionary).
 *
 * Before this, each surface kept its OWN hardcoded list, in two different
 * systems, and they had drifted - a user comparing the landing page to the
 * signed-in upgrade screen saw three different stories about what "Free" is:
 *   1. the squeeze-scanner line was worded differently ("All 50 coins" vs
 *      "every tracked coin");
 *   2. the landing page omitted Free's chart-timeframe limit entirely, so it
 *      UNDERSTATED what Free includes;
 *   3. /upgrade omitted the excluded features (no Telegram alerts, no price
 *      alerts), so it never told the user what they were missing;
 *   4. the landing page's AI-limit numbers were a hand-typed copy with no link
 *      to lib/limits, free to drift from the real caps in every locale
 *      independently.
 *
 * WHAT LIVES HERE is the STRUCTURE: which rows, in what order, whether each is
 * included (✓) or excluded (✗), and - for the numeric rows - the numbers pulled
 * from lib/limits so they can never drift from the real caps. Both surfaces
 * render THIS list, so a row added or reordered or re-flagged here changes both
 * at once; neither surface owns its own row set any more.
 *
 * WHAT DOES NOT live here is the localized TEXT, and that is deliberate, not an
 * oversight (see #1152's dev note). The two surfaces resolve their locale
 * DIFFERENTLY: the label system's locale follows the signed-in user's saved
 * language (LanguageSync) / localStorage, while the landing dict follows the
 * URL segment (/ko, /zh). The landing page is shown only to logged-out
 * visitors, whose label locale is still the localStorage default 'en' - so
 * rendering label text there would print English pricing on /ko and /zh (the
 * exact "English-only change regresses done work" #1117 warns about). Landing
 * text therefore stays in the i18n dict (URL-correct per locale); /upgrade text
 * stays in the label system. A guard test (QA-owned) pins the English dict text
 * equal to the English label defaults and asserts every `id` below has a dict
 * entry in every offered locale, so the two localized copies cannot
 * structurally drift or fall out of English sync again.
 *
 * PRO is consolidated the same way (PRO_PLAN_FEATURES below). The two Pro lists
 * differed in shape - the landing page split "AI chat" and "live searches" into
 * two rows where /upgrade combined them into one - and the owner's call (relayed
 * via PM/DevOps 2026-09-28) was to keep the COMBINED /upgrade shape as canonical,
 * so the landing page now shows one combined row too. Same locale reasoning as
 * FREE: structure and numbers here, text in each surface's own layer.
 */

const F = AI_LIMITS.free; // numbers derived, never hand-typed - see reason (4) above
const P = AI_LIMITS.pro;

export interface PlanFeature {
  /** Stable id. This is the key the landing i18n dict stores this row's text
   *  under (dict.pricing.free.features[id]); it never changes once shipped. */
  id: string;
  /** The label key /upgrade renders this row's text from. */
  labelKey: LabelKey;
  /** Interpolation vars - the numeric caps from lib/limits, applied identically
   *  by both surfaces so the numbers can't diverge from the real config. */
  vars?: Record<string, string | number>;
  /** false = shown as an EXCLUDED feature (✗) rather than included (✓). The
   *  landing page already rendered this distinction; /upgrade gains it via
   *  #1152 so an upgrade screen finally says what Free does NOT have. */
  included: boolean;
}

export const FREE_PLAN_FEATURES: PlanFeature[] = [
  { id: 'dashboard',  labelKey: 'UPGRADE_FREE_FEATURE_DASHBOARD',   included: true },
  { id: 'briefing',   labelKey: 'UPGRADE_FREE_FEATURE_BRIEFING',    included: true },
  { id: 'news',       labelKey: 'UPGRADE_FREE_FEATURE_NEWS',        included: true },
  { id: 'scanner',    labelKey: 'UPGRADE_FREE_FEATURE_SCANNER',     included: true },
  { id: 'charts',     labelKey: 'UPGRADE_FREE_FEATURE_CHARTS',      included: true },
  { id: 'aiAnalyses', labelKey: 'UPGRADE_FREE_FEATURE_AI_ANALYSES', vars: { quick: F.quick, deep: F.deep }, included: true },
  { id: 'aiChat',     labelKey: 'UPGRADE_FREE_FEATURE_AI_CHAT',     vars: { chat: F.chat }, included: true },
  { id: 'telegram',   labelKey: 'UPGRADE_FREE_EXCL_TELEGRAM',       included: false },
  { id: 'priceAlerts', labelKey: 'UPGRADE_FREE_EXCL_PRICE_ALERTS',  included: false },
];

// Keep this list in sync with the actual gates: the timeframe clamp and locked
// cards in app/arena/page.tsx, the /backtest paywall, and the PRO_REQUIRED check
// in all 11 one-shot AI tool routes (thesis-check, strategy-research,
// shadow-account, behavioral-bias, pine-script, hypotheses/[id]/analyze,
// token-unlock, smc-snapshot, dry-powder, macro-context, onchain).
//
// There is NO "Full strategy backtesting" row, on purpose - not a placeholder.
// /backtest was advertised here by accident (#264/#273); the owner ruled it an
// internal tool never meant to be sold (it redirects to /dashboard). If a real
// customer-facing backtest ships, that is a new decision and a new label key.
//
// There is NO "Priority support" row, on purpose. Owner ruling (#1309 item 34):
// support is one shared mailbox for every plan, so there is no priority tier to
// sell. UPGRADE_PRO_FEATURE_PRIORITY_SUPPORT is RETIRED (production is
// additive-only), not deleted, so nothing renders it.
//
// Pro has no excluded rows - it is the everything tier - so every entry is
// included: true.
export const PRO_PLAN_FEATURES: PlanFeature[] = [
  { id: 'everythingFree',  labelKey: 'UPGRADE_PRO_FEATURE_EVERYTHING_FREE',  included: true },
  { id: 'fastTimeframes',  labelKey: 'UPGRADE_PRO_FEATURE_FAST_TIMEFRAMES',  included: true },
  { id: 'confluence',      labelKey: 'UPGRADE_PRO_FEATURE_CONFLUENCE',       included: true },
  { id: 'onchainMacro',    labelKey: 'UPGRADE_PRO_FEATURE_ONCHAIN_MACRO',    included: true },
  { id: 'telegram',        labelKey: 'UPGRADE_PRO_FEATURE_TELEGRAM',         included: true },
  { id: 'unlimitedAlerts', labelKey: 'UPGRADE_PRO_FEATURE_UNLIMITED_ALERTS', included: true },
  { id: 'aiAnalyses',      labelKey: 'UPGRADE_PRO_FEATURE_AI_ANALYSES',      vars: { quick: P.quick, deep: P.deep }, included: true },
  { id: 'aiChatSearch',    labelKey: 'UPGRADE_PRO_FEATURE_AI_CHAT_SEARCH',   vars: { chat: P.chat, search: P.search }, included: true },
  { id: 'toolPool',        labelKey: 'UPGRADE_PRO_FEATURE_TOOL_POOL',        vars: { tools: P.toolPool ?? 0 }, included: true },
];
