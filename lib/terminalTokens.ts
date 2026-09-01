/* The Monochrome Terminal design tokens, as the single source of truth (#413).
 *
 * Transcribed from the handoff README's colour table, which QA established is
 * the authoritative list: the four .dc.html prototypes contain 1,284 hex
 * literals and ZERO custom properties, so they are a place to check for drift
 * rather than a place to read tokens from.
 *
 * This file exists so the values live in ONE place that both the stylesheet and
 * a conformance test can read. Duplicating fifteen hex strings into a spec
 * fixture is how the fixture and the stylesheet end up disagreeing, and the
 * disagreement would be invisible - both would look correct in isolation.
 *
 * NOT wired into the app yet. `app/globals.css` carries these under
 * [data-design="terminal"], which nothing sets, so the running app is
 * unchanged. The redesign opts in screen by screen.
 */

/** The 15 documented colour tokens. Values are the README's, EXCEPT --bg1 and
 *  --txt3 - see the amendment note below. */
export const TERMINAL_COLORS = {
  '--bg0':          '#08090a',  // Canvas
  /* Owner-amended 2026-09-01 (#518/#526): handoff said #0c0d0f, which sat only
     13 hex units off --bg (#000) - imperceptible as a card boundary (#512 bug
     2). #141517 is the value of record now; the handoff docs were amended to
     match, not the other way around. */
  '--bg1':          '#141517',  // Raised region
  '--bg2':          '#111416',  // Bar/track background
  '--bdr':          '#1f2225',  // Structural hairline
  '--bdr2':         '#131618',  // Row hairline
  '--bdr3':         '#16191b',  // Cell hairline
  '--txt':          '#e8e9ea',  // Primary text and data
  '--txt2':         '#8b8f94',  // Secondary text, prose
  /* Owner-amended 2026-09-01 (#518/#526): handoff said #5a5f66, which measures
     3.03-3.10:1 against --bg0/--bg1 - both are in the spec's own enumerated
     4.5:1 pairs (arena.md:252), so the handoff's own value failed the
     handoff's own rule. #7c828a clears 4.5:1 on both. */
  '--txt3':         '#7c828a',  // Micro-labels, meta
  '--txt4':         '#3a3f45',  // Disabled, axis labels
  '--accent':       '#d9a626',  // Active nav, primary CTA - ALWAYS with #08090a text
  '--green':        '#3fb950',  // Bullish / firing positive
  '--red':          '#f0524d',  // Bearish / firing negative
  '--mark-idle':    '#22262a',  // Signal marker when NOT firing
  '--border-input': '#5e646b',  // Input and secondary-button border
} as const;

/* The sixteenth value: the FLAT cell in the hours expectancy grid.
 *
 * Rendered in `Monochrome Terminal - Tools.dc.html` with its own legend swatch,
 * used when |expectancy| < 0.12, and ABSENT from the README's table - QA found
 * it by diffing the prototypes against the doc. It is close to --mark-idle
 * #22262a and deliberately not the same value; both mean "not firing" but they
 * sit on different backgrounds.
 *
 * Named separately rather than folded into --mark-idle so that if the designer
 * later says they should be one token, that is a one-line change with a test
 * behind it rather than an archaeology exercise. */
export const TERMINAL_FLAT_CELL = '#1c1f22';

/* Liquidation map only. The one place the design permits a multi-hue ramp,
   because a heatmap's whole content is magnitude. Four palettes are selectable;
   magma is the default and the only one specified in the README.
 *
 * eslint-disable local/no-bare-hex-colour -- taking the rule's own escape
 * hatch, with the reason it asks for. These seven are a continuous colour ramp,
 * not text colours: they interpolate across a density scale and there is no
 * token that could express a gradient stop. Tokenising them would mean fifteen
 * more named colours that only ever appear in one component, which is the
 * opposite of what the rule protects. The rule's stated concern - "hardcoded
 * colours do not adapt to theme" - does not apply either: the liquidation map
 * is dark-only by design and the ramp IS the data. */
/* eslint-disable local/no-bare-hex-colour */
export const MAGMA_RAMP = [
  { stop: 0,    color: '#0a0614' },
  { stop: 0.14, color: '#2a114e' },
  { stop: 0.32, color: '#681e7a' },
  { stop: 0.52, color: '#b5306a' },
  { stop: 0.70, color: '#e85b3a' },
  { stop: 0.86, color: '#f9a94a' },
  { stop: 1,    color: '#fdf3c8' },
] as const;
/* eslint-enable local/no-bare-hex-colour */

/** Every colour the design is allowed to render, for a conformance check. */
export const TERMINAL_ALLOWED = [
  ...Object.values(TERMINAL_COLORS),
  TERMINAL_FLAT_CELL,
  ...MAGMA_RAMP.map(s => s.color),
];
