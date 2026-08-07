/**
 * Typed PostHog event helpers.
 * Import `track` anywhere - safely no-ops on SSR and before init.
 */
import posthog from 'posthog-js';

/**
 * The PostHog key, but only where analytics SHOULD run.
 *
 * There is one PostHog project on the free plan and every environment that
 * holds the key writes into it. Measured 2026-08-08: dev and prod were serving
 * the SAME `phc_...` key, so anyone who accepted cookies on dev was landing
 * events in production's analytics. qa and staging were already excluded by
 * simply never being given the variable - dev was overlooked, which is the
 * problem with enforcing this through configuration alone.
 *
 * So the environment gate lives here instead, mirroring `monitoringDsn()` in
 * lib/monitoring.ts, which solved exactly this for the GlitchTip DSN after
 * non-prod traffic exhausted that quota. Removing the key from a dashboard
 * fixes today; this fixes the next service someone copies an environment into.
 *
 * Returns '' rather than throwing: PostHogProvider already treats an empty key
 * as "do not init at all", which is the behaviour we want and is trivially
 * checkable in devtools - no PostHog request, no PostHog cookie.
 *
 * CALLERS MUST PASS THE VALUES IN as literal `process.env.NEXT_PUBLIC_*` member
 * accesses. There is deliberately no `= process.env` default: Next.js inlines
 * only that literal form into the client bundle, so reading properties off a
 * `process.env` object passed in as a whole resolves to nothing in the browser
 * and this returns '' everywhere - switching analytics off in production too.
 * A default parameter here made that mistake easy and invisible, so it is gone.
 */
export function analyticsKey(env: Record<string, string | undefined>): string {
  const key = env.NEXT_PUBLIC_POSTHOG_KEY ?? '';
  if (!key) return '';
  // Same switch lib/tables.ts reads: 'dev' means every non-production
  // environment, so this covers dev, qa and staging in one condition and any
  // future one automatically.
  if (env.NEXT_PUBLIC_APP_ENV === 'dev') return '';
  return key;
}

function capture(event: string, props?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try { posthog.capture(event, props); } catch { /* PostHog not initialised yet */ }
}

export const track = {
  /** User ran a Grok analysis in Arena */
  arenaAnalysis: (type: 'quick' | 'deep', coin: string) =>
    capture('arena_analysis_run', { type, coin }),

  /** User switched the selected coin */
  coinSwitched: (coin: string) =>
    capture('coin_switched', { coin }),

  /** User saved a trade journal entry */
  journalSaved: (outcome: string) =>
    capture('journal_entry_saved', { outcome }),

  /** User created a price alert */
  alertCreated: (coin: string, condition: string) =>
    capture('alert_created', { coin, condition }),

  /** User signed in */
  signIn: (method: 'google' | 'magic_link' | 'password_signin' | 'password_signup') =>
    capture('sign_in', { method }),

  /** User signed out */
  signOut: () =>
    capture('sign_out'),

  /** Page navigation (called from PostHogProvider - don't call manually) */
  pageView: (url: string) =>
    capture('$pageview', { $current_url: url }),
};
