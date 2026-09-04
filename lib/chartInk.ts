/* Colours the Arena chart paints onto its CANVAS, and the one place they are
 * allowed to be decided.
 *
 * WHY THESE LIVE IN lib/ RATHER THAN IN THE COMPONENT. Nothing on this canvas
 * is reachable by the contrast sweep. `createPointFigures` returns text and
 * line figures that klinecharts paints into a 2D context - they are not DOM
 * nodes, carry no computed style, and axe cannot see them. So
 * qa/e2e/contrast.spec.ts sweeping /arena clean has never included a single
 * overlay label, and never will (#808). That is not a gap that seeding or
 * waiting closes, the way trap 3's empty /news did: it is structural.
 *
 * The only durable guard is arithmetic over the constants themselves, so the
 * constants have to be importable. __tests__/chartInk.test.mts is that guard.
 *
 * A SECOND REASON, learned the hard way: a canvas fillStyle cannot resolve
 * `var(--amber)`. It does not throw and it does not fail to invisible - the
 * context KEEPS THE PREVIOUS COLOUR, so the line paints in whatever the last
 * overlay set and looks deliberate. EMA9 and EMA200 were painting green
 * borrowed from the S/R support line, then pink when a pink overlay drew ahead
 * of them. Everything here is a literal for that reason.
 */

/** The chart canvas is transparent; the ground is .klc-wrap's `background:
 *  var(--bg)` (globals.css:2042). There is no terminal override of --bg, so
 *  the four design x theme contexts collapse to these two grounds. */
export const CHART_GROUND = { dark: '#000000', light: '#E8EAED' } as const;

export type EmaPeriod = 9 | 20 | 50 | 200;
export const EMA_RIBBON_PERIODS: EmaPeriod[] = [9, 20, 50, 200];

/* THE TERMINAL RAMPS (#806).
 *
 * Ruled by QA on 2026-09-04: extend the existing grey ramp to periods 9 and
 * 200, which had been reading through --amber and --accent and therefore never
 * rendered at all. Nothing visible is lost by replacing them - nobody has ever
 * seen "EMA9 is amber" on this chart.
 *
 * ONE RAMP PER THEME, and that is not extra scope - it is what "distinct in
 * all four contexts" costs. The old ramp was design-aware but theme-blind, so
 * the same greys had to serve both grounds, and #8b8f94 measured 6.45:1 on
 * black and 2.70:1 on the light ground. A single fixed grey cannot clear 3:1
 * on both.
 *
 * Chosen for EQUAL CONTRAST-RATIO STEPS rather than equal byte steps: for
 * neutral greys the separation between neighbours is the quotient of their
 * ground ratios, so evenly spaced ground ratios give evenly spaced neighbours,
 * which byte spacing does not.
 *
 *   dark ground     12.04  8.03  5.03  3.19      adjacent 1.50 / 1.60 / 1.58
 *   light ground     3.19  4.98  7.95 12.07      adjacent 1.56 / 1.60 / 1.52
 *   9 vs 200         3.78 dark, 3.79 light       (was 1.33 and 1.03)
 *
 * "Darker as the period lengthens" is the convention the file already used,
 * and both ramps obey it - which is why they run in opposite directions
 * against their grounds. On black, darker means less contrast; on the light
 * ground it means more.
 *
 * NOTE ON THE INSTRUMENT: these are neutral greys, r=g=b, so hue separation is
 * not in play and a contrast ratio IS the right measure of distinctness. For
 * two different HUES it is not - #787 and #756 were both filed on a
 * contrastRatio between colours that differ in hue, where it reported 1.02 for
 * a brown and a blue anyone can tell apart. */
export const TERMINAL_EMA_RAMP = {
  dark:  { 9: '#c4c4c4', 20: '#a0a0a0', 50: '#7c7c7c', 200: '#5d5d5d' },
  light: { 9: '#828282', 20: '#636363', 50: '#454545', 200: '#292929' },
} as const satisfies Record<'dark' | 'light', Record<EmaPeriod, string>>;

/* The current design keeps its hues: gold and blue read as different lines
 * without relying on lightness, so they stay distinct in both themes.
 *
 * Literals rather than tokens for the canvas reason at the top of this file.
 * Periods 9 and 200 are the values --amber and --accent resolve to, pinned -
 * which is a VISIBLE change, because until now they resolved to nothing and
 * painted a borrowed colour. Periods 20 and 50 are byte-for-byte what the file
 * already had.
 *
 * KNOWN AND DELIBERATELY UNTOUCHED: on the light ground, 20 (#60a5fa) measures
 * 2.11:1 and 50 (#f97316) measures 2.33:1, against 3:1 for graphics. Both
 * predate this work, both are in the design the owner uses daily, and changing
 * four ribbon colours nobody asked about is not what #806 ruled. Reported on
 * the issue instead of fixed here. */
export const CURRENT_EMA_RAMP = {
  dark:  { 9: '#fbbf24', 20: '#60a5fa', 50: '#f97316', 200: '#1a7aff' },
  light: { 9: '#8F4508', 20: '#60a5fa', 50: '#f97316', 200: '#0052CC' },
} as const satisfies Record<'dark' | 'light', Record<EmaPeriod, string>>;

/** The colour one EMA ribbon line paints, for the context it is painting in.
 *
 *  Called per repaint rather than captured when the overlay is created: the
 *  ribbon is only recreated on a coin or timeframe change, so a colour chosen
 *  at creation survives a theme switch and goes stale. */
export function emaInk(period: EmaPeriod, ctx: { terminal: boolean; dark: boolean }): string {
  const ramp = ctx.terminal ? TERMINAL_EMA_RAMP : CURRENT_EMA_RAMP;
  return (ctx.dark ? ramp.dark : ramp.light)[period];
}

/* OVERLAY LABEL INK (#808).
 *
 * Each overlay label is white or black text on a filled chip whose colour is
 * the line's own. The line colours are fine; the TEXT on them was not. Measured
 * with lib/readableOn.ts:
 *
 *                        white   black
 *   S/R resistance        2.77    7.59
 *   S/R support           1.92   10.92
 *   GEX max pain          2.72    7.72
 *   GEX gamma flip        1.81   11.62
 *   realized liq cluster  4.60    4.57
 *
 * Four of the five failed 4.5:1 on white and clear it comfortably on black, so
 * the fix is the text colour and not the palette - no line changes hue, and
 * nothing about how the chart reads changes. The cluster chip keeps white: it
 * is the only background dark enough to sit mid-scale, where white is the
 * marginally better of two passing options.
 */
export const OVERLAY_LABEL_INK = {
  srResistance: { bg: '#f87171', text: '#000000' },
  srSupport:    { bg: '#34d399', text: '#000000' },
  gexMaxPain:   { bg: '#a78bfa', text: '#000000' },
  gexFlip:      { bg: '#22d3ee', text: '#000000' },
  liqCluster:   { bg: '#db2777', text: '#ffffff' },
} as const;
