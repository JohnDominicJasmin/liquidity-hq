/* Product flags that are read at build time. Each is a literal `process.env.NEXT_PUBLIC_*` member access so Next inlines it into the
   client bundle (see lib/checkout.ts, #243: reading a property off a passed-in `process.env` object resolves to nothing in the browser). */

/* SHOW_PERFORMANCE_STATS (owner order, 2026-10-16, #1574): every win/loss/record display is hidden while this is false (the default).
 * It gates, and only gates, RENDERING. No component, calculation, API route or label is deleted, so turning it back on restores
 * everything exactly as it was:
 *   - Arena: the "Recent record" line in components/EMASignal.tsx and the Anti-Chop tooltip's backtest claim
 *   - /scanner: components/SignalAccuracy.tsx (via ScannerTerminal)
 *   - /alerts: components/AlertOutcomes.tsx
 *   - /about: step 6 (points at Signal Accuracy)
 *   - /learn: the "Alert Outcome Tracking" glossary entry
 * Not controlled here: the /backtest and /live-tracking routes, which proxy.ts already redirects to /dashboard (#264), and
 * the Risk/Reward calculator's Win Rate input and the Trade Journal's own statistics, which are the user's own numbers.
 * TO BRING IT BACK: set NEXT_PUBLIC_SHOW_PERFORMANCE_STATS=1 on the host and redeploy (it is inlined at build time). */
export const SHOW_PERFORMANCE_STATS = process.env.NEXT_PUBLIC_SHOW_PERFORMANCE_STATS === '1';
