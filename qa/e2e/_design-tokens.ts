import { TERMINAL_ALLOWED, TERMINAL_COLORS, TERMINAL_FLAT_CELL } from '@/lib/terminalTokens';

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

/* THE PALETTE IS NOT DEFINED HERE. It is imported from `lib/terminalTokens.ts`,
 * which `app/globals.css` is unit-tested against — so one list feeds the
 * stylesheet, the app and this spec.
 *
 * Dev asked for this and they were right. My first version transcribed the 15
 * hex values a second time, and **two copies drift invisibly**: each file reads
 * correctly on its own, and the only symptom is a conformance spec passing
 * against a stylesheet it no longer describes. That is the same shape as every
 * entry in HANDOVER §14 — a clean result from an instrument pointed at the wrong
 * thing — and it would have been the most expensive instance, because a green
 * conformance run is exactly what everyone would trust.
 *
 * `TERMINAL_ALLOWED` is 15 tokens + `--flat-cell` + 7 magma stops = 23 values.
 */

/** Named token values, for the round-trip control. Includes the undocumented
 * FLAT cell so the parser is exercised against it too. */
export const TOKEN_VALUES: Record<string, string> = {
  ...TERMINAL_COLORS,
  '--flat-cell': TERMINAL_FLAT_CELL,
};

/** Every allowed colour, lowercased, for membership tests. */
export const ALLOWED = new Set<string>(TERMINAL_ALLOWED.map(c => c.toLowerCase()));

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
