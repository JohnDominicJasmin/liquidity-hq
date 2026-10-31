/* Explicit `.ts` extensions, unlike most of this codebase. This module is
   imported by a node:test file, and node's ESM loader will not resolve an
   extensionless relative import - Next's bundler will. `allowImportingTsExtensions`
   is on in tsconfig, so both are happy. Without this the unit test cannot load
   the module at all, and the leak invariant goes unasserted. */
import {
  isCheckoutConfigured, isCheckoutConfiguredAnnual, isCheckoutConfiguredFortnightly,
  isCryptoCheckoutConfigured, isCryptoCheckoutConfiguredAnnual, isCryptoCheckoutConfiguredFortnightly,
  isProBuyable,
  isWhopCheckoutConfigured, isWhopCheckoutConfiguredAnnual, isWhopCheckoutConfiguredFortnightly,
  getWhopEmbed,
} from './checkout.ts';
import { isLsApiConfigured } from './lemonsqueezyApi.ts';
import { analyticsKey } from './analytics.ts';
import { whopPlanTable } from './whopEntitlement.ts';

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
 *
 * ── WHAT THIS OBJECT CANNOT TELL YOU, AND THE MISREADING IT INVITES ─────────
 *
 * EVERY FLAG IS SELF-CONSISTENCY. This function takes `process.env` and
 * nothing else. No flag here has ever contacted an external party, so the
 * whole object answers one question - "is this host's own configuration
 * internally coherent?" - and no other.
 *
 * THE TWO SHAPES THAT READ AS HEALTH AND ARE NOT:
 *
 *   A SECRET THAT IS WRONG READS `true`. `whopWebhook` is `set(...)` - a
 *   non-empty string. A secret that is present and incorrect rejects every
 *   delivery and this flag still says `true`. "A key is set" is not "a
 *   delivery arrived"; only the second has an external party in it.
 *
 *   `whopPlanMatchesLink*` COMPARES TWO OF OUR OWN VALUES. It asks whether our
 *   checkout URL variable carries the plan id our unlock variable grants for.
 *   Both sides are ours. They can agree perfectly while the link points at the
 *   wrong account, or the account posts its webhook somewhere else entirely -
 *   which is not hypothetical here: the Whop webhook NAMED "Production"
 *   pointed at the qa host for nine days, and every flag in this object was
 *   true throughout.
 *
 * SO "ELEVEN OF ELEVEN TRUE" MEANS THE ENVIRONMENT IS COHERENT AND NOTHING
 * MORE. It is a necessary condition for payments working and nowhere near a
 * sufficient one, and a release checklist that reads it as the latter is
 * reading the wrong instrument.
 *
 * WHERE EXTERNAL TRUTH ACTUALLY LIVES: one row in `lhq_whop_webhook_events`.
 * As of 2026-10-31 there have never been any, three days after payments went
 * live - which is consistent with nobody having bought and equally consistent
 * with deliveries going to the wrong host. **This object cannot distinguish
 * those two, and no addition to it could.** That is a deliberate boundary, not
 * a gap to fill: a flag that reached out to a payment provider on every
 * `/api/version` read would be a different thing with a different cost.
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
    /* The other two plans (#1400). Reported separately because each is its own
       link, and "monthly is set" says nothing about whether the annual or the
       two-weekly button will render. Same read /upgrade uses. */
    checkoutAnnual:      isCheckoutConfiguredAnnual(env),
    checkoutFortnightly: isCheckoutConfiguredFortnightly(env),
    /* The crypto links (#861). These three, not the three above, are what
       /upgrade gates on now - so these are the flags that say whether a plan
       button renders on this host. Same read the page uses. */
    /* What /upgrade goes by: is the Whop monthly link set, so Pro can be bought here at all (#1567 Phase 2; it was BoomFi's link before). A display
       switch only: the trial-ending email and the BoomFi grant do NOT follow it. */
    proBuyable:                isProBuyable(env),
    cryptoCheckout:            isCryptoCheckoutConfigured(env),
    cryptoCheckoutAnnual:      isCryptoCheckoutConfiguredAnnual(env),
    cryptoCheckoutFortnightly: isCryptoCheckoutConfiguredFortnightly(env),
    /* The Whop links (#1567 Phase 2). These are what /upgrade gates its buttons on now, and `proBuyable` above is the monthly one. The BoomFi flags
       above are kept because the BoomFi webhook grant and the trial-ending email still gate on them (parked, unset on prod). */
    whopCheckout:              isWhopCheckoutConfigured(env),
    whopCheckoutAnnual:        isWhopCheckoutConfiguredAnnual(env),
    whopCheckoutFortnightly:   isWhopCheckoutConfiguredFortnightly(env),
    lemonsqueezyWebhook: set(env.LEMONSQUEEZY_WEBHOOK_SECRET),
    /* Both, because either one missing refuses every delivery: no key fails
       the signature check, no organisation id fails the check after it. */
    boomfiWebhook: set(env.BOOMFI_WEBHOOK_PUBLIC_KEY) && set(env.BOOMFI_ORG_ID),
    /* The Whop webhook secret (#1567, Phase 1). A boolean only, never the value. Unset refuses every delivery -
       and so does a WRONG one, which reads `true` here. See the header: presence is not correctness. */
    whopWebhook: set(env.WHOP_WEBHOOK_SECRET),
    /* Which Whop plan ids the unlock will grant for on this environment (#1567 Phase 3): WHOP_PLAN_ID_MONTHLY / _ANNUAL / _FORTNIGHTLY. Booleans
       only, never the ids. A plan that is unset, duplicated or equal to the record-only test plan reads false, and its payments go to review. */
    whopPlanMonthly:     Object.values(whopPlanTable(env)).some((r) => r.plan === 'monthly'),
    whopPlanAnnual:      Object.values(whopPlanTable(env)).some((r) => r.plan === 'annual'),
    whopPlanFortnightly: Object.values(whopPlanTable(env)).some((r) => r.plan === 'fortnightly'),
    /* #1630 GO-LIVE 3: does the plan's CHECKOUT LINK (what a buyer pays on) carry the same plan id the unlock grants for (WHOP_PLAN_ID_*)? If not,
       every buyer of that plan pays and is refused as unknown_plan. Booleans only. false = the link or the id is unset, or they differ; read it with
       whopCheckout* and whopPlan* above to tell which. */
    whopPlanMatchesLinkMonthly:     whopLinkMatchesPlan('monthly', env),
    whopPlanMatchesLinkAnnual:      whopLinkMatchesPlan('annual', env),
    whopPlanMatchesLinkFortnightly: whopLinkMatchesPlan('fortnightly', env),
    /* The LS REST API key the cancel route needs (#1396). Same read the route
       and the settings panel gate on (isLsApiConfigured), so cancel-availability
       is observable per environment - set on qa (test), unset on staging/prod
       until payments go live. */
    lsApi:               isLsApiConfigured(env),

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

/** True when the plan's Whop checkout link names a plan id that the unlock's table (WHOP_PLAN_ID_*) maps to that same plan. */
function whopLinkMatchesPlan(plan: 'monthly' | 'annual' | 'fortnightly', env: Record<string, string | undefined>): boolean {
  const linkPlanId = getWhopEmbed(plan, env)?.planId;
  if (!linkPlanId) return false;
  const table = whopPlanTable(env);
  const row = Object.prototype.hasOwnProperty.call(table, linkPlanId) ? table[linkPlanId] : undefined;
  return !!row && row.plan === plan;
}
