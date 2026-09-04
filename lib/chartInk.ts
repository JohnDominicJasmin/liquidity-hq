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
 * 20 and 50 on the LIGHT ground were #60a5fa (2.11:1) and #f97316 (2.33:1) -
 * both under 3:1 - until #816 ruled them in scope alongside the four overlay
 * colours. They carry the same hue at lower lightness, so the ribbon reads the
 * same and the ground contrast is 3.30 and 3.31. Dark is untouched; 9 and 200
 * already cleared both grounds. */
export const CURRENT_EMA_RAMP = {
  dark:  { 9: '#fbbf24', 20: '#60a5fa', 50: '#f97316', 200: '#1a7aff' },
  light: { 9: '#8F4508', 20: '#187cf8', 50: '#d45a05', 200: '#0052CC' },
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

/* OVERLAY LINE INK (#808, then #816).
 *
 * NOT to be confused with KLineProChart's own OVERLAY_INK, which is a different
 * table for the buy/sell marker glow, chevron and alert line (#752). These are
 * the S/R, GEX and cluster RULES and the chips that label them.
 *
 * Each overlay is a coloured rule plus a filled chip carrying its label. The
 * rule's colour IS the chip's background, so one value has two accessibility
 * jobs: a graphic against the chart ground (3:1, SC 1.4.11) and a text
 * background under the label (4.5:1, SC 1.4.3).
 *
 * #808 fixed the second by switching the label text to black. #816 fixes the
 * first, which only failed on the LIGHT ground: every one of these clears its
 * ground comfortably on #000000 and six of the seven failed on #E8EAED.
 *
 *   gexFlip 1.50   srSupport 1.59   ema20 2.11
 *   gexMaxPain 2.26   srResistance 2.30   ema50 2.33
 *
 * HUE IS KEPT AND LIGHTNESS IS LOWERED, deliberately. What makes these tellable
 * apart from each other is hue, not lightness - a contrast ratio between two of
 * them is the wrong instrument for "can a user distinguish them", which is what
 * #787 and #756 were both filed on. So each light value is its dark value with
 * the same H and S walked down in L until it clears the ground. Measured hue
 * drift is at most 0.2 degrees.
 *
 * TARGETED AT 3.3 RATHER THAN 3.0. The threshold is 3:1; landing on 3.05 leaves
 * nothing for a future change to --bg, and the ground has moved before. The
 * realized-cluster pink sits at 3.81 untouched, so this keeps the set in one
 * band.
 *
 * DARK IS UNTOUCHED. Every dark value clears #000000 already and a change there
 * would be a redesign nobody asked for.
 */
export const OVERLAY_LINE_INK = {
  dark: {
    srResistance: { bg: '#f87171', text: '#000000' },
    srSupport:    { bg: '#34d399', text: '#000000' },
    gexMaxPain:   { bg: '#a78bfa', text: '#000000' },
    gexFlip:      { bg: '#22d3ee', text: '#000000' },
    liqCluster:   { bg: '#db2777', text: '#ffffff' },
  },
  light: {
    srResistance: { bg: '#f52c2c', text: '#000000' },
    srSupport:    { bg: '#1f9067', text: '#000000' },
    gexMaxPain:   { bg: '#8964f8', text: '#000000' },
    gexFlip:      { bg: '#0c8ca0', text: '#000000' },
    /* Unchanged, and that is a decision rather than an oversight: #db2777
       measures 3.81 on the light ground, and its white label text wins over
       black by 0.03 (4.60 against 4.57). Retune the chip and that coin-toss has
       to be re-made for no accessibility gain. */
    liqCluster:   { bg: '#db2777', text: '#ffffff' },
  },
} as const;

export type OverlayKind = keyof (typeof OVERLAY_LINE_INK)['dark'];

/** The ink one overlay paints in, for the theme it is painting in.
 *
 *  Read per repaint, not captured at overlay creation - the overlays outlive a
 *  theme switch, and a colour chosen when the overlay was created goes stale
 *  exactly the way the RSI indicator's did (#806). */
export function lineInk(kind: OverlayKind, dark: boolean): { bg: string; text: string } {
  return dark ? OVERLAY_LINE_INK.dark[kind] : OVERLAY_LINE_INK.light[kind];
}
