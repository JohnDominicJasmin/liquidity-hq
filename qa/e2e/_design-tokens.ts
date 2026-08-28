/**
 * Routes that have been converted to the Monochrome Terminal design and
 * verified by QA on the `qa` environment.
 *
 * Add a route here only after posting a PASS comment on #413.
 * Specs that loop over this list run at `?design=terminal` and assert the
 * terminal palette — zero impact on users until they opt in.
 *
 * Verified (with commit + date):
 *   /            — #448, verified 2026-08-26
 *   /disclaimer  — #420, verified 2026-08-26
 *   /arena       — #460, verified 2026-08-26
 *   /dashboard   — #491 @ d3d7e15, verified 2026-08-28
 */
export const CONVERTED_ROUTES: string[] = [
  '/',
  '/disclaimer',
  '/arena',
  '/dashboard',
];

/**
 * Criteria every terminal-converted route must satisfy.
 * Used by terminal-design.spec.ts.
 */
export const TERMINAL_CRITERIA = {
  /** <html> must carry data-design="terminal" when ?design=terminal is set */
  dataDesignAttr: 'terminal',
  /** All card-like elements must have 0px border-radius */
  flatRadiusSelectors: [
    '.edge-card',
    '.scc-card',
    '.macro-rail-card',
    '.mr',
  ],
  /** Body font must resolve to IBM Plex Sans, not Figtree */
  fontFamily: 'plexSans',
  /** Amber accent hex — used by visual spot-checks */
  accentHex: '#d9a626',
} as const;
