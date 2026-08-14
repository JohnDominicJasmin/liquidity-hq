/* The Monochrome Terminal palette, and the ledger of which routes are held to it.
 *
 * SOURCE OF TRUTH IS THE README TABLE, NOT THE PROTOTYPES — and that distinction
 * was measured rather than assumed. The four `.dc.html` design files contain
 * **1,284 hex literals and zero `var(--…)`**: they carry no custom properties at
 * all, so there is nothing in them to extract. The README's colour table is the
 * authored list; the prototypes are useful as a place to CHECK it against, which
 * is exactly what they were on 2026-08-14 — they surfaced one omission and three
 * false alarms.
 */

/** The 15 documented tokens, plus one the README omits. Lowercase, no alpha. */
export const DESIGN_TOKENS: Record<string, string> = {
  '--bg0':          '#08090a',
  '--bg1':          '#0c0d0f',
  '--bg2':          '#111416',
  '--bdr':          '#1f2225',
  '--bdr2':         '#131618',
  '--bdr3':         '#16191b',
  '--txt':          '#e8e9ea',
  '--txt2':         '#8b8f94',
  '--txt3':         '#5a5f66',
  '--txt4':         '#3a3f45',
  '--accent':       '#d9a626',
  '--green':        '#3fb950',
  '--red':          '#f0524d',
  '--mark-idle':    '#22262a',
  '--border-input': '#2a2e32',

  /* UNDOCUMENTED, and deliberately included. `#1c1f22` is the FLAT cell in the
   * hours expectancy grid — `Math.abs(v) < 0.12 ? '#1c1f22' : …` — and it has its
   * own legend swatch, so it is a real design decision that the README's table
   * simply does not list.
   *
   * It sits close to `--mark-idle #22262a` and both mean "not firing", so the
   * two may want collapsing into one token. That is the designer's call; the
   * VALUE is unambiguous in the prototype and the implementation needs one
   * either way. Named provisionally. */
  '--flat-cell':    '#1c1f22',
};

/* The liquidation map's magma ramp. EXEMPT from conformance rather than part of
 * the palette: it is a data encoding, the README gives four selectable ramps,
 * and a heatmap cell's colour is a value rather than a style choice. */
export const HEATMAP_RAMP = [
  '#0a0614', '#2a114e', '#681e7a', '#b5306a', '#e85b3a', '#f9a94a', '#fdf3c8',
];

/** Every allowed colour, lowercased, for membership tests. */
export const ALLOWED = new Set<string>(
  [...Object.values(DESIGN_TOKENS), ...HEATMAP_RAMP].map(c => c.toLowerCase()),
);

/* ── THE CONVERSION LEDGER ───────────────────────────────────────────────────
 *
 * EMPTY ON PURPOSE, AND THIS IS THE WHOLE DESIGN OF THIS FILE.
 *
 * The app currently ships **75 `:root` tokens** across amber, blue, green,
 * orange, purple and red families. Held to a 17-value palette today, every one
 * of the 33 user-facing routes fails — and a suite that is red on 33 known-good
 * screens is a suite people stop reading. That is not a hypothetical: the same
 * failure mode is recorded in `qa/STATUS.md` for the internal routes, which is
 * why they are exempt rather than merely failing.
 *
 * So conformance is OPT-IN PER ROUTE. A route joins this list when its redesign
 * merges, and from that moment it can never drift back. Before that it is not
 * checked, because there is nothing yet to check it against.
 *
 * ADD A ROUTE IN THE SAME PR THAT CONVERTS IT. A converted screen missing from
 * this list is unguarded and looks identical to a guarded one — which is the
 * "automation that is off looks exactly like automation that is working" trap
 * this suite has hit before.
 *
 * NOT EXEMPT, NEVER ADD THEM: `/admin` and the six `/ops` routes keep the
 * current design by the owner's instruction, so they are outside this system
 * entirely rather than pending. See qa/STATUS.md.
 */
export const CONVERTED_ROUTES: string[] = [
  // '/dashboard',   <- add as each redesign lands
];
