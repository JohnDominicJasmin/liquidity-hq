/**
 * Routes that have been converted to the Monochrome Terminal design and
 * verified by QA on the `qa` environment.
 *
 * Add a route here only after posting a PASS comment on #413.
 * Specs that loop over this list run at `?design=terminal` and assert the
 * terminal palette — zero impact on users until they opt in.
 *
 * Verified (with commit + date):
 *   /               — #448, verified 2026-08-26
 *   /disclaimer     — #420, verified 2026-08-26
 *   /arena          — #460, verified 2026-08-26
 *   /dashboard      — #491 @ d3d7e15, verified 2026-08-28
 *   /briefing       — #492 @ 27e495a, verified 2026-08-28
 *   /liq            — #494 @ 8496ea7, verified 2026-08-29 (static)
 *   /funding        — #494 @ 8496ea7, verified 2026-08-29 (static)
 *   /correlation    — #494 @ 8496ea7, verified 2026-08-29 (static)
 *   /markets        — #495 @ 8496ea7, verified 2026-08-29 (static)
 *   /scanner        — #495 @ 8496ea7, verified 2026-08-29 (static)
 *   /journal        — #496 @ 8496ea7, verified 2026-08-29 (static)
 *   /alerts         — #496 @ 8496ea7, verified 2026-08-29 (static)
 *   /news           — #496 @ 8496ea7, verified 2026-08-29 (static)
 *   /calc           — #498 @ 35986d3, verified 2026-08-29 (static)
 *   /playbook       — #498 @ 35986d3, verified 2026-08-29 (static)
 *   /hours          — #498 @ 35986d3, verified 2026-08-29 (static)
 *   /research       — #498 @ 35986d3, verified 2026-08-29 (static)
 *   /econ-calendar  — #498 @ 35986d3, verified 2026-08-29 (static)
 *   /settings       — #498 @ 35986d3, verified 2026-08-29 (static)
 *   /login          — #499 @ 6ffe068, verified 2026-08-29 (static)
 *   /forgot-password — #499 @ 6ffe068, verified 2026-08-29 (static)
 *   /reset-password  — #499 @ 6ffe068, verified 2026-08-29 (static)
 *   /about          — no treatment needed (0 hardcoded radii), verified 2026-08-29 (static)
 *   /learn          — no treatment needed (0 hardcoded radii), verified 2026-08-29 (static)
 *   /privacy        — no treatment needed (0 hardcoded radii), verified 2026-08-29 (static)
 *   /faq            — #503 @ 701d368, verified 2026-08-29 (static)
 *   /terms          — #503 @ 701d368, verified 2026-08-29 (static)
 *   /refund         — #503 @ 701d368, verified 2026-08-29 (static)
 *   /upgrade        — #503 @ 701d368, verified 2026-08-29 (static)
 */
/* `/arena` IS NOT IN THIS LIST, and its absence is the finding (#843, #853).
 *
 * It was here, and the four `arena-structure.spec.ts` tests measured it against
 * `specs/arena.md` and failed — rail 320 where the spec says 352, ticker strip
 * absent entirely. Neither number is a styling slip. **The terminal Arena
 * component does not exist.** `components/ArenaTerminal.tsx` was removed by the
 * `dd39c9bb` revert, 1,212 lines including `lib/arenaColour.ts`,
 * `lib/arenaTimeframes.ts` and their tests; `ccefc0de` later restored 939 lines
 * of CSS and never restored the component. So
 * `[data-design="terminal"] .at-rail { flex: 0 0 352px }` is already in
 * `globals.css` and **nothing renders `.at-rail`** — along with `.at-body`,
 * `.at-main`, `.at-pair`, `.at-ev*`, `.at-verdict` and the ticker strip. 66
 * orphaned `at-*` classes styling markup that is not emitted. The 320 the spec
 * measured is `.arena-ws`, the CURRENT design's Arena grid column.
 *
 * Setting `.arena-ws` to 352 under terminal was on the table and the owner
 * rejected it on 2026-09-05: one criterion goes green, four stay red, and the
 * screen is still not the one the spec describes. **A check made to pass without
 * making the thing true is the failure this whole folder is about.**
 *
 * Removed rather than left failing, because a route in this list is a claim that
 * the screen was converted, and that claim is false — what `/arena` has is
 * current-design markup plus `border-radius: 0 !important` from #505. Leaving it
 * would have the suite reporting a conversion that was reverted eight weeks ago.
 *
 * PUT IT BACK IN THE PR THAT REBUILDS THE COMPONENT — #853. The four structural
 * tests arm themselves off this list and are the acceptance criteria for that
 * work, so they need no edit when it lands.
 *
 * What this does NOT do, stated because the absence is easy to misread: it fixes
 * nothing a visitor sees, and since #748 made terminal the default everywhere,
 * whatever `/arena` looks like is now what every visitor gets. Swept on deployed
 * `qa` @ 122423d — it renders coherently: title, category filters, coin row, the
 * three research controls, chart with timeframe row, and a market-snapshot rail.
 * Not the spec's screen, not a broken one.
 */
export const CONVERTED_ROUTES: string[] = [
  '/',
  '/disclaimer',
  '/dashboard',
  '/briefing',
  '/liq',
  '/funding',
  '/correlation',
  '/markets',
  '/scanner',
  '/journal',
  '/alerts',
  '/news',
  '/calc',
  '/playbook',
  '/hours',
  '/research',
  '/econ-calendar',
  '/settings',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/about',
  '/learn',
  '/privacy',
  '/faq',
  '/terms',
  '/refund',
  '/upgrade',
];

/**
 * Criteria every terminal-converted route must satisfy.
 * Used by terminal-design.spec.ts.
 */
export const TERMINAL_CRITERIA = {
  /** <html> must carry data-design="terminal" when ?design=terminal is set */
  dataDesignAttr: 'terminal',
  /** All card-like elements must have 0px border-radius.
   *  `.mr` removed (#587/#608): MarketRead no longer renders on any
   *  terminal route (TMarketReadBanner replaced it in the dashboard's
   *  first main-column slot), so the selector matches zero elements on
   *  every route in CONVERTED_ROUTES now. Note for whoever wires this
   *  list up: `flatRadiusSelectors` has no consumer anywhere in the repo
   *  today (checked with a full-repo grep) - this array isn't run by
   *  any spec yet, so removing a stale entry costs nothing now but
   *  matters the day someone connects it. */
  flatRadiusSelectors: [
    '.edge-card',
    '.scc-card',
    '.macro-rail-card',
  ],
  /** Body font must resolve to IBM Plex Sans, not Figtree */
  fontFamily: 'plexSans',
  /** Amber accent hex — used by visual spot-checks */
  accentHex: '#d9a626',
} as const;
