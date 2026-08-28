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
 *   /briefing    — #492 @ 27e495a, verified 2026-08-28
 *   /liq         — #494 @ 8496ea7, verified 2026-08-29 (static)
 *   /funding     — #494 @ 8496ea7, verified 2026-08-29 (static)
 *   /correlation — #494 @ 8496ea7, verified 2026-08-29 (static)
 *   /markets     — #495 @ 8496ea7, verified 2026-08-29 (static)
 *   /scanner     — #495 @ 8496ea7, verified 2026-08-29 (static)
 *   /journal     — #496 @ 8496ea7, verified 2026-08-29 (static)
 *   /alerts      — #496 @ 8496ea7, verified 2026-08-29 (static)
 *   /news        — #496 @ 8496ea7, verified 2026-08-29 (static)
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
