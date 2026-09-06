/* Arena's timeframe row — three states, and what a click does (#413).
 *
 * Spec: design_handoff_arena/specs/arena.md §Timeframe row.
 *
 * WHY THIS IS A LIBRARY. Three reasons, and the third is the one that matters:
 *
 *   1. it decides what a user can reach, which is worth testing without a DOM
 *   2. it is entitlement logic, and this project has already shipped a paywall
 *      leak by moving markup and leaving its guard behind
 *   3. QA's coverage map puts criteria 20-23 - the padlocks and the gated-click
 *      behaviour - in the group where "a defect reaches dev unopposed", because
 *      no automated check exists for them. Pure logic with tests is the only
 *      opposition available.
 *
 * GATED MUST BE LEGIBLE WITHOUT COLOUR. --txt2 and --txt3 are close enough that
 * a colour-only distinction is not one; the padlock glyph carries the state and
 * the row ends with an explicit "1M · 5M · 15M NEED PRO". That is an
 * accessibility requirement in the spec, not decoration - which is why the
 * state is returned as a value here rather than being a CSS class decision.
 */

import { GATED_TFS, FREE_FALLBACK_TF } from './limits.ts';

export type TfState = 'active' | 'available' | 'gated';

/** Every timeframe the row offers, in the order the frame draws them. */
export const TF_ROW = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const;
export type Tf = typeof TF_ROW[number];

const isGated = (tf: string): boolean => (GATED_TFS as readonly string[]).includes(tf);

/**
 * What state a chip is in.
 *
 * Order matters: ACTIVE WINS over gated. A Pro user on 5m who lets their
 * subscription lapse should see the chip they are actually on rendered as
 * active, not as a padlock next to a chart already showing that timeframe -
 * the padlock would be describing a state the screen contradicts.
 * `forcedTimeframe` below is what stops them being there in the first place.
 */
export function tfState(tf: string, current: string, entitled: boolean): TfState {
  if (tf === current) return 'active';
  if (!entitled && isGated(tf)) return 'gated';
  return 'available';
}

/**
 * The timeframe that should actually render, given who is asking.
 *
 * A free user landing on `/arena?tf=5m` - from a bookmark, a shared link, or a
 * lapsed subscription - is moved to 1h rather than shown an empty chart or a
 * paywall where a chart should be. Returns the input unchanged for anyone
 * entitled, so this is safe to call unconditionally on every render.
 */
export function forcedTimeframe(requested: string, entitled: boolean): string {
  if (entitled) return requested;
  return isGated(requested) ? FREE_FALLBACK_TF : requested;
}

/**
 * What a click on a chip should do.
 *
 * `'select'` changes the timeframe. `'upgrade'` opens UpgradeGateModal and
 * changes NOTHING - the spec is explicit that a gated click must not move the
 * chart. Returning an intent rather than performing it keeps the decision
 * testable and stops the component owning the entitlement rule.
 */
export function tfClickIntent(tf: string, entitled: boolean): 'select' | 'upgrade' {
  return !entitled && isGated(tf) ? 'upgrade' : 'select';
}

/** The trailing hint, or null when the user has nothing gated. */
export function gatedHint(entitled: boolean): string | null {
  if (entitled) return null;
  return `${GATED_TFS.map(t => t.toUpperCase()).join(' · ')} NEED PRO`;
}
