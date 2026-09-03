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
export const CONVERTED_ROUTES: string[] = [
  '/',
  '/disclaimer',
  '/arena',
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
