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
 * PRO is intentionally NOT consolidated in this pass: #1152's reported defect
 * and the owner's four wording decisions are all about the FREE list. The Pro
 * lists also differ in shape (the landing page splits AI chat and live search
 * into two rows where /upgrade combines them), which is its own wording call.
 * When that is taken on, add PRO_PLAN_FEATURES here in the same shape.
 */

const F = AI_LIMITS.free; // numbers derived, never hand-typed - see reason (4) above

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
  // #1117: AI is included in the plan, not rented via a separate API key/bill -
  // stated plainly, once, as its own line above the specific daily allowances.
  { id: 'aiIncluded', labelKey: 'UPGRADE_FREE_FEATURE_AI_INCLUDED', included: true },
  { id: 'aiAnalyses', labelKey: 'UPGRADE_FREE_FEATURE_AI_ANALYSES', vars: { quick: F.quick, deep: F.deep }, included: true },
  { id: 'aiChat',     labelKey: 'UPGRADE_FREE_FEATURE_AI_CHAT',     vars: { chat: F.chat }, included: true },
  { id: 'telegram',   labelKey: 'UPGRADE_FREE_EXCL_TELEGRAM',       included: false },
  { id: 'priceAlerts', labelKey: 'UPGRADE_FREE_EXCL_PRICE_ALERTS',  included: false },
];
