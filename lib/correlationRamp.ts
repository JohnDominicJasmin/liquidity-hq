/* The /correlation heatmap's tint ramp (#570).
 *
 * Extracted from components/CorrelationTerminal.tsx so the alpha caps can be
 * TESTED rather than asserted in a comment. The first fix for #570 carried its
 * reasoning as prose - "red's two thresholds sit close together (~72-73% either
 * theme) so 65% covers both" - and that sentence was wrong: it measured dark
 * and assumed light matched. Light red actually fails at 61-66%, so the 65% cap
 * left a residual AA failure that survived the fix and the review of the fix.
 *
 * A comment cannot be run. These constants can, and __tests__/correlationRamp
 * composites them against the real tokens and checks 4.5:1 in both themes.
 *
 * Pure module, no React, no imports - so `node --test` can load it.
 */

/** Alpha caps, in percent, verified in __tests__/correlationRamp.test.mts.
 *
 *  First alpha at which --txt fails 4.5:1, swept against --bg0/--bg1/--bg2:
 *
 *                  dark        light
 *      --green   61-64%      74-78%
 *      --red     74-76%      61-66%    <- light red is the binding case
 *
 *  The two colours have OPPOSITE worst themes, which is exactly why a single
 *  assumed pair of thresholds could not hold for both. */
export const GREEN_CAP_PCT = 50;
export const RED_CAP_PCT   = 56;

/** Where the positive ramp starts lifting off the untinted card. Below this,
 *  correlation is weak enough that a tint would imply a signal. */
const GREEN_FLOOR_PCT = 4;
const RED_FLOOR_PCT   = 6;

/**
 * Tint alpha in percent for a correlation value.
 *
 * Positive correlations ramp from 0.35 upward so the weak band stays visually
 * quiet; negative ones ramp from 0, because a negative correlation is itself
 * the notable thing and there is no uninteresting band to suppress.
 *
 * @param r correlation, -1..1
 * @returns alpha percent, floor..cap for the matching colour
 */
export function tintPct(r: number): number {
  if (r > 0) {
    const t = Math.max(0, (r - 0.35) / 0.65);
    return GREEN_FLOOR_PCT + Math.pow(t, 2.2) * (GREEN_CAP_PCT - GREEN_FLOOR_PCT);
  }
  return RED_FLOOR_PCT + Math.pow(Math.abs(r), 1.5) * (RED_CAP_PCT - RED_FLOOR_PCT);
}
