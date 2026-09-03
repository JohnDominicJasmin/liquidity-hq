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

/** The 18 documented colour tokens. Values are the README's, EXCEPT --bg1 and
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
  /* Found missing (#542): app-root --amber (#fbbf24) was falling through into
     terminal mode ungoverned - never redeclared in the terminal block, never
     documented here, so an inherited current-design colour rendered on
     terminal screens as if chosen for them. Design confirmed #fbbf24 as the
     intended value (handoff README, both token tables) and it's used in
     specs/dashboard-2a.md's OI-trend and funding ladders (weak_up state).
     11.1:1 on --bg1 - not a contrast fix, a governance one. */
  '--amber':        '#fbbf24',  // Weak/caution state (OI-trend, funding ladders)
  '--mark-idle':    '#22262a',  // Signal marker when NOT firing
  '--border-input': '#5e646b',  // Input and secondary-button border
  /* #559/#561: FundingTerminal's "slight long" signal state - the one of
     eight states using a bare literal instead of a token, undeclared in the
     terminal block, same governance shape as --amber above. */
  '--fr-slight-long': '#d4b483',
  /* #559: the empty-cell dash's own colour - --txt3 passes on --bg0/-1/-2
     but only 4.30:1 on the composited tile background CoinHeatmap.tsx's
     placeholder actually renders on. Design's ruling: a dedicated value
     for this one use, not a change to --txt3 itself. */
  '--txt-dash': '#848a92',
  /* #652: green FOREGROUND on a composited tint. Dark's --green passes on
     every ground it meets, so this is simply --green there; terminal light's
     #14702c does not - 4.35 on its own 12% chip tint, 4.19 on the
     current-price bar's accent wash. Dedicated value for the composited case,
     exactly as --txt-dash above, rather than moving --green and shifting every
     green in the light theme to fix three elements on one screen. */
  '--green-fg': '#3fb950',
} as const;

/** The same 18 tokens under `[data-design="terminal"][data-theme="light"]`
 *  (#602). Terminal light is a real, separately-specified palette, not the
 *  dark values on a pale ground - `--accent`/`--green`/`--red`/`--amber` are
 *  all darkened because their dark-theme hex measures under 2.6:1 on a light
 *  ground. Without this set, any conformance check that reads
 *  TERMINAL_COLORS could only ever validate half the design's themes, and
 *  #595 showed what an unvalidated light theme costs: terminal landing shipped
 *  painting the current design's black ground and blue accent, passing 20/21
 *  because no criterion asserted a colour.
 *
 *  Transcribed from `app/globals.css`'s terminal-light block, which is in turn
 *  sourced from `specs/light-theme-tokens.md` - same reason the dark set
 *  exists here: one place for both the stylesheet and a test to read, so the
 *  two cannot drift apart invisibly. Hex case is copied as declared; compare
 *  case-insensitively.
 *
 *  NOTE: `TERMINAL_FLAT_CELL` below has NO light counterpart - it is absent
 *  from the terminal-light CSS block, from `:root`, and from
 *  `specs/light-theme-tokens.md`. So under terminal+light `var(--flat-cell)`
 *  resolves to nothing and the declaration using it is dropped. Not given a
 *  value here because inventing one would be a design decision; raised on
 *  #602 for design to rule on. */
export const TERMINAL_COLORS_LIGHT = {
  '--bg0':          '#f7f6f3',  // Canvas
  '--bg1':          '#ebe9e6',  // Raised region
  '--bg2':          '#e3e1dd',  // Bar/track background
  '--bdr':          '#d5d2cd',  // Structural hairline
  '--bdr2':         '#dfdcd7',  // Row hairline
  '--bdr3':         '#e2dfda',  // Cell hairline
  '--txt':          '#15181b',  // Primary text and data
  '--txt2':         '#585c61',  // Secondary text, prose
  /* #559 second round: 5.690:1 on --bg0 and 4.709:1 on --bg2, the binding
     surface - chosen against the darkest composited background actually
     used, not just the canvas. */
  '--txt3':         '#5e6267',  // Micro-labels, meta
  '--txt4':         '#aeaaa4',  // Disabled, axis labels
  '--accent':       '#754e00',  // Active nav, primary CTA - with #ffffff text here, not --bg0
  '--green':        '#14702c',  // Bullish / firing positive
  '--red':          '#9d1a23',  // Bearish / firing negative
  '--amber':        '#755100',  // Weak/caution state
  '--mark-idle':    '#d1cec9',  // Signal marker when NOT firing
  '--border-input': '#75797e',  // Input and secondary-button border
  '--fr-slight-long': '#7C5E2E',
  '--txt-dash':     '#4f5257',
  '--green-fg':     '#0f5a22',   // see the dark entry - 5.87 / 5.66 on the two tints
} as const;

/* The seventeenth value: the FLAT cell in the hours expectancy grid.
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

/** Every colour the design is allowed to render in DARK, for a conformance
 *  check. */
export const TERMINAL_ALLOWED = [
  ...Object.values(TERMINAL_COLORS),
  TERMINAL_FLAT_CELL,
  ...MAGMA_RAMP.map(s => s.color),
];

/** The same list for LIGHT (#602). The magma ramp is shared deliberately: the
 *  liquidation map is dark-only by design (see the ramp's comment above), so
 *  it renders the same seven stops under either theme rather than having a
 *  light variant. TERMINAL_FLAT_CELL is NOT included - it has no light value
 *  anywhere, see TERMINAL_COLORS_LIGHT's note. */
export const TERMINAL_ALLOWED_LIGHT = [
  ...Object.values(TERMINAL_COLORS_LIGHT),
  ...MAGMA_RAMP.map(s => s.color),
];
