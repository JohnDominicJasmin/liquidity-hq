/* Explicit `.ts` extensions, unlike most of this codebase. This module is
   imported by a node:test file, and node's ESM loader will not resolve an
   extensionless relative import - Next's bundler will. `allowImportingTsExtensions`
   is on in tsconfig, so both are happy. Without this the unit test cannot load
   the module at all, and the leak invariant goes unasserted. */
import { isCheckoutConfigured } from './checkout.ts';
import { analyticsKey } from './analytics.ts';

/* Which integrations does THIS host actually have? (#282)
 *
 * Lives here rather than inline in app/api/version/route.ts for one reason: the
 * route imports `next/server`, which the unit-test runner cannot resolve, and
 * the invariant that matters - BOOLEANS ONLY, no value ever - is exactly the
 * kind of property that must be asserted rather than reviewed. A pure function
 * over an env bag is testable; a route handler is not.
 *
 * WHY IT EXISTS. `staging` was created missing most of its integrations, that
 * reduced what QA could verify before a release, and nobody noticed for eleven
 * days. Silence was the defect. A dashboard answers this only for someone with
 * access, a bundle grep answers it unreliably, and a table in a doc goes stale.
 * A host computing it about itself cannot.
 *
 * EACH FLAG COMES FROM THE SAME READ THE APP GATES ON, never a parallel list.
 * A boolean computed differently from the thing it describes is worse than no
 * boolean: it would report health while the feature was broken.
 */

export type ConfiguredFlags = Record<string, boolean>;

/** Presence of a key. Whitespace is not configuration - an empty or
 *  space-only value is the commonest way a dashboard entry looks present and
 *  behaves absent. */
const set = (v: string | undefined): boolean => !!v && v.trim() !== '';

export function configuredFlags(env: Record<string, string | undefined>): ConfiguredFlags {
  return {
    /* Payments. `checkout` goes through lib/checkout.ts so it cannot disagree
       with /upgrade, the upsell modal or the trial-ending email - all four now
       gate on that one function. */
    checkout:            isCheckoutConfigured(env),
    lemonsqueezyWebhook: set(env.LEMONSQUEEZY_WEBHOOK_SECRET),

    adminEmails: set(env.ADMIN_EMAILS),

    /* All three parts, because two out of three is a broken push setup that
       reads as configured - it fails when a notification is sent, not at boot. */
    vapid: set(env.VAPID_PRIVATE_KEY)
        && set(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
        && set(env.VAPID_EMAIL),

    /* Same reasoning: a bot token without a webhook secret cannot verify the
       callbacks it is about to receive. */
    telegram: set(env.TELEGRAM_BOT_TOKEN)
           && set(env.TELEGRAM_CHAT_ID)
           && set(env.TELEGRAM_WEBHOOK_SECRET),

    brevo: set(env.BREVO_API_KEY) && set(env.BREVO_SENDER_EMAIL),

    /* Through analyticsKey() rather than the raw variable. That function returns
       '' whenever NEXT_PUBLIC_APP_ENV is 'dev', so a non-prod host reports false
       even with the key set - which is the truth about whether events are sent,
       and the whole point of deriving from the app's own read. */
    posthog: analyticsKey(env) !== '',
    sentry:  set(env.NEXT_PUBLIC_SENTRY_DSN),

    coinglass: set(env.COINGLASS_API_KEY),
    grok:      set(env.GROK_API_KEY),
    finnhub:   set(env.FINNHUB_KEY),
    cmc:       set(env.CMC_API_KEY),

    /* Unlocks all nine checkCronAuth routes at once. FALSE MEANS THEY REJECT
       EVERYTHING - lib/cronAuth.ts returns false when this is unset - so on a
       non-prod host false is the desired state, not a gap. */
    cronSecret: set(env.CRON_SECRET),
  };
}
