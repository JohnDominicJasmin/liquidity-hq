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
/* ── GLOBAL CHROME NOT YET CONVERTED ─────────────────────────────────────────
 *
 * A converted PAGE still sits inside UNCONVERTED CHROME. `AppShell` mounts the
 * cookie banner, the chat launcher and the platform footer on every route, so
 * the first conformance run against `/disclaimer` reported 11 findings of which
 * **zero came from the screen dev had built**.
 *
 * Without this list the spec cannot pass on any single screen until the LAST
 * global component converts — red for the whole migration, green only at the
 * end. That is the "permanently red suite people stop reading" failure the
 * route ledger exists to avoid, arriving through a different door.
 *
 * EXPLICIT SELECTORS, NEVER PATTERNS. The same run reported
 * `html.figtree_…` — which looked like more chrome and was a real defect: the
 * canvas hardcodes `#06070a` instead of `var(--bg0)`, so a converted screen
 * renders on the OLD ground, two hex digits away and invisible to any eye.
 * **I nearly exempted it while triaging eleven findings in a minute.**
 * A rule like "anything on html" would have buried it permanently.
 *
 * REMOVE AN ENTRY IN THE PR THAT CONVERTS ITS COMPONENT. An exemption that
 * outlives its component is indistinguishable from coverage.
 */
export const UNCONVERTED_CHROME: string[] = [
  '.consent-btn',            // CookieConsent
  '.consent-link',           // CookieConsent
  '.gchat-fab',              // GrokChat launcher - undesigned entirely, see #413
  '.gchat-panel',            // GrokChat panel and everything inside it
  '.gchat-coins',            // GrokChat coin chips
  /* THE WHOLE FOOTER, not two of its children. My first version named
   * `.pf-footer-divider-label` and `.pf-footer-link`, which covered the text
   * and missed `.pf-footer-brand` — an INLINE SVG of the blue logo, four
   * hardcoded fills.
   *
   * I had already written on #413 that a raster logo is invisible to a
   * CSS-property check but *"if it is ever inlined as SVG with hardcoded fills,
   * this WILL flag it, correctly"*. It is, and it did, and I still had to trace
   * the parent chain to find out — because I had exempted the parts of the
   * footer I happened to have seen fail rather than the component.
   *
   * **Exempt COMPONENTS, not the symptoms you have observed.** A list built
   * from one run's findings is a list of what rendered that day. */
  '.pf-footer',              // PlatformFooter, entire component

  /* ── THE BRAND MARK ──────────────────────────────────────────────────────
   *
   * ONE SELECTOR, on the component, since dev added `data-brand-mark` in #451.
   * It replaced three call-site selectors — `.sshell-brand`, `.lt-brand`,
   * `.lt-footer-brand` — which were three chances to forget the fourth. There
   * are ten `<BrandMark>` call sites across seven files; whoever adds the
   * eleventh gets the exemption for free.
   *
   * WHY IT IS EXEMPT AT ALL. The mark is blue — #2E7BFF, #6FD3FF, #1C3E76 —
   * and that is the DESIGN, not drift. The handoff's own `logo.png` decodes to
   * exactly those values and frame `7a` references it three times at 26/30/22px.
   * README:199: *"the app icon the user supplied; used at 18-26px in every nav
   * bar and mobile header"*. So the design's own asset is off the design's own
   * 15-value palette, and that is a brand decision inside a theme.
   *
   * I FILED IT AS A DEFECT FIRST (#449). Dev decoded the asset and disproved
   * it. The part I should have caught unaided: the design embeds the mark as
   * `<img>` and we inline it as SVG — a raster logo is invisible to a
   * computed-`fill` check and the same mark inlined is not. That sentence was
   * already in this file about `.pf-footer-brand`, written by me.
   *
   * IF THE MARK IS EVER RESTATED IN PALETTE COLOURS, delete the attribute and
   * this entry together. An exemption that outlives its reason is
   * indistinguishable from coverage. */
  '[data-brand-mark]',
];

/* THREE SELECTORS FOR ONE DECISION, and that is a smell worth naming.
 *
 * `.sshell-brand`, `.lt-brand` and `.lt-footer-brand` all render the SAME
 * `BrandMark` component. Each screen wraps it in its own class, so an exemption
 * has to be re-added per screen — and the fourth one will be missed, silently,
 * on whichever screen converts next. That is the `.pf-footer-brand` failure
 * repeating: I exempted the children I had SEEN fail rather than the component.
 *
 * The durable fix is a marker on the component itself — `data-brand-mark` on
 * `BrandMark`, one exemption, every screen covered forever. That is app code,
 * so it is dev's to add; raised on #449. Until then this list grows by one per
 * converted screen and each entry is a chance to forget. */

export const CONVERTED_ROUTES: string[] = [
  '/disclaimer',      // #420, merged 2026-08-14
  /* Landing, #448. Added at REVIEW time rather than in dev's PR, because this
   * file is QA-owned and dev cannot edit it — so "the route joins in the PR
   * that converts it" becomes "the review PR that follows it", one PR late.
   *
   * One late is the safe direction. See the `/arena` note below. */
  '/',                // #448, Landing 7a

  /* `/arena` IS DELIBERATELY ABSENT, and this comment exists so it is not
   * re-added a third time.
   *
   * It arrived here once before #438 merged and turned four structure specs red
   * against a screen that was never converted on `dev`. It came back in this
   * rebase, and I removed it again after measuring rather than assuming:
   *
   *   gh pr view 438            state=OPEN  merged=null
   *   ArenaTerminal on dev      0 files
   *   dev's arena/page.tsx      0 references to design=terminal
   *
   * A route in this list is a claim that the screen is converted. Arena is not.
   * **Add it in the PR that merges #438, not before** — a red suite that says
   * nothing is worse than a gap that says nothing, because someone has to
   * triage the red and nobody has to triage the gap. */
];
