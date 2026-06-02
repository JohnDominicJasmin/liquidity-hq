/**
 * Typed PostHog event helpers.
 * Import `track` anywhere — safely no-ops on SSR and before init.
 */
import posthog from 'posthog-js';

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
  signIn: (method: 'google' | 'magic_link') =>
    capture('sign_in', { method }),

  /** User signed out */
  signOut: () =>
    capture('sign_out'),

  /** Page navigation (called from PostHogProvider — don't call manually) */
  pageView: (url: string) =>
    capture('$pageview', { $current_url: url }),
};
