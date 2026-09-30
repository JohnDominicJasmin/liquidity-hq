/** Is a real checkout URL configured?
 *
 *  One definition, because there were four: this guard was written out by hand
 *  in getCheckoutUrl below, `CHECKOUT_CONFIGURED` in app/upgrade/page.tsx,
 *  `checkoutConfigured` in components/UpgradeGateModal.tsx and `checkoutLive` in
 *  lib/email.ts. Four copies of "is Pro buyable" that had to agree and nothing
 *  made them - the trial-ending email in particular decides whether to link a
 *  checkout that may not exist.
 *
 *  `'#'` counts as unset: it is the placeholder the variable is given when the
 *  store is not live yet, and treating it as a URL sends buyers to a page whose
 *  address is a fragment.
 *
 *  Exported so /api/version can report `configured.checkout` from the SAME read
 *  the app gates on (#282). A boolean computed differently from the thing it
 *  describes is worse than no boolean. */

/* THE VALUES ARE READ HERE, AS LITERAL `process.env.NEXT_PUBLIC_*` MEMBER
 * ACCESSES AT MODULE SCOPE, AND THAT IS THE WHOLE FIX (#243).
 *
 * These functions took `env: Record<…> = process.env` and read
 * `env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL` off it. Next.js inlines ONLY the
 * literal `process.env.NEXT_PUBLIC_X` form into the client bundle; reading a
 * property off a `process.env` object passed in as a whole resolves to nothing
 * in the browser. So `isCheckoutConfigured()` - called with no argument at
 * module scope in app/upgrade/page.tsx:13 - was permanently false on the
 * client, and the upgrade page rendered its "no store yet" branch with NO
 * CHECKOUT BUTTON regardless of how the environment was configured.
 *
 * Measured before changing anything: with the variable set in .env.local AND
 * present at runtime, `/api/version` reported `configured.checkout: true`
 * (server-side, live process.env - that path always worked) while the built
 * client chunks contained the URL nowhere, the served HTML contained no CTA,
 * and the rendered page showed no checkout button. Pro was not buyable through
 * the UI in any environment.
 *
 * lib/analytics.ts:26 already documents this exact hazard, in these words:
 *
 *     "Next.js inlines only that literal form into the client bundle, so
 *      reading properties off a `process.env` object passed in as a whole
 *      resolves to nothing in the browser ... A default parameter here made
 *      that mistake easy and invisible, so it is gone."
 *
 * That lesson was learned, written down, and applied to analytics - and left
 * in place on the payment path, where the failure is silent in exactly the same
 * way and costs money instead of telemetry.
 *
 * The optional `env` parameter STAYS, because /api/version and lib/email.ts
 * legitimately read server-side values, and #282 requires them to use the same
 * predicate the UI gates on. What changed is the default: an explicit argument
 * still wins, and omitting it now falls back to a value that was inlined at
 * build time rather than to an object that is empty in the browser. */
const INLINED_MONTHLY = process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL;
const INLINED_ANNUAL  = process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_ANNUAL;
const INLINED_FORTNIGHTLY = process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_FORTNIGHTLY;

export function checkoutBase(env?: Record<string, string | undefined>): string | null {
  const base = env ? env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL : INLINED_MONTHLY;
  return base && base !== '#' ? base : null;
}

/** Boolean form of the same read. Returns the URL rather than a boolean above so
 *  callers that need the value get type narrowing from the one check, instead of
 *  testing a helper and then re-testing the variable to satisfy the compiler. */
export function isCheckoutConfigured(env?: Record<string, string | undefined>): boolean {
  return checkoutBase(env) !== null;
}

// Build a LemonSqueezy checkout URL with the user's email + ID pre-filled
// so the webhook can match the payment back to the correct Supabase user.
export function getCheckoutUrl(user: { id: string; email?: string } | null): string {
  const base = checkoutBase();
  if (!base) return '/login?signup=1';
  try {
    const url = new URL(base);
    if (user?.email) url.searchParams.set('checkout[email]', user.email);
    if (user?.id)    url.searchParams.set('checkout[custom][user_id]', user.id);
    return url.toString();
  } catch {
    return base;
  }
}

/* Same fix as checkoutBase above - see its header for why the default is a
   build-time constant rather than `= process.env`. */
export function checkoutBaseAnnual(env?: Record<string, string | undefined>): string | null {
  const base = env ? env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_ANNUAL : INLINED_ANNUAL;
  return base && base !== '#' ? base : null;
}

export function isCheckoutConfiguredAnnual(env?: Record<string, string | undefined>): boolean {
  return checkoutBaseAnnual(env) !== null;
}

export function getCheckoutUrlAnnual(user: { id: string; email?: string } | null): string {
  const base = checkoutBaseAnnual();
  if (!base) return '/login?signup=1';
  try {
    const url = new URL(base);
    if (user?.email) url.searchParams.set('checkout[email]', user.email);
    if (user?.id)    url.searchParams.set('checkout[custom][user_id]', user.id);
    return url.toString();
  } catch {
    return base;
  }
}

/* The third plan (#1400): $20 every two weeks. Same three-function shape as
   annual, same rules - a build-time inlined read, '#' and empty are unset, and
   an unset link renders nothing rather than a dead button. Never substituted by
   the monthly link. */
export function checkoutBaseFortnightly(env?: Record<string, string | undefined>): string | null {
  const base = env ? env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL_FORTNIGHTLY : INLINED_FORTNIGHTLY;
  return base && base !== '#' ? base : null;
}

export function isCheckoutConfiguredFortnightly(env?: Record<string, string | undefined>): boolean {
  return checkoutBaseFortnightly(env) !== null;
}

export function getCheckoutUrlFortnightly(user: { id: string; email?: string } | null): string {
  const base = checkoutBaseFortnightly();
  if (!base) return '/login?signup=1';
  try {
    const url = new URL(base);
    if (user?.email) url.searchParams.set('checkout[email]', user.email);
    if (user?.id)    url.searchParams.set('checkout[custom][user_id]', user.id);
    return url.toString();
  } catch {
    return base;
  }
}

/* ── Pay with crypto: BoomFi (#861, Phase 1) ──────────────────────────────────
 *
 * Lemon Squeezy rejected the store, so the card links above now point nowhere
 * and /upgrade no longer reads them. They stay in this file only because the
 * upsell modal and the trial-ending email still import them; removing them is
 * its own sweep, so that a payments change cannot silently break either.
 *
 * One link per plan, the same rules as every reader above: a literal
 * `process.env.NEXT_PUBLIC_*` read at module scope (#243 - anything else is not
 * inlined into the client bundle), '#' and empty mean unset, an unset link
 * renders nothing rather than a dead button, and no plan ever falls back to
 * another plan's link (a wrong-product link charges the wrong amount and looks
 * like it worked).
 *
 * TWO DIFFERENCES FROM THE CARD LINKS, both deliberate:
 *
 * 1. Only ONE parameter is added, and it is BoomFi's own: `customer_ident`,
 *    set to the account id. Their docs (payments/paylink-features): "Bind the
 *    session to a customer id you already store with `customer_ident`" -
 *    "Webhook and dashboard activity can then use this identifier
 *    consistently." That is what lets the webhook (Phase 1b) tie a payment to
 *    an account without guessing from an email. Email and name are NOT
 *    prefilled: BoomFi requires both together when prefilling and the account
 *    has no reliable name. Nothing else is appended.
 *
 *    The id is put there by the browser, so the payer can change it. As with
 *    the card links, it identifies who to credit and proves nothing about who
 *    paid; the webhook has to treat it that way.
 *
 * 2. The two-weekly plan is a WEEKLY link. BoomFi has no "every two weeks"
 *    interval, so its version of that plan bills $10 each week. /upgrade says so
 *    beside the button; the variable keeps the plan's name, not the interval's,
 *    so the three names line up with the three plans. */
const INLINED_CRYPTO_MONTHLY = process.env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL;
const INLINED_CRYPTO_ANNUAL = process.env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_ANNUAL;
const INLINED_CRYPTO_FORTNIGHTLY = process.env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_FORTNIGHTLY;

export function cryptoCheckoutBase(env?: Record<string, string | undefined>): string | null {
  const base = env ? env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL : INLINED_CRYPTO_MONTHLY;
  return base && base !== '#' ? base : null;
}

export function isCryptoCheckoutConfigured(env?: Record<string, string | undefined>): boolean {
  return cryptoCheckoutBase(env) !== null;
}

export function cryptoCheckoutBaseAnnual(env?: Record<string, string | undefined>): string | null {
  const base = env ? env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_ANNUAL : INLINED_CRYPTO_ANNUAL;
  return base && base !== '#' ? base : null;
}

export function isCryptoCheckoutConfiguredAnnual(env?: Record<string, string | undefined>): boolean {
  return cryptoCheckoutBaseAnnual(env) !== null;
}

export function cryptoCheckoutBaseFortnightly(env?: Record<string, string | undefined>): string | null {
  const base = env ? env.NEXT_PUBLIC_BOOMFI_CHECKOUT_URL_FORTNIGHTLY : INLINED_CRYPTO_FORTNIGHTLY;
  return base && base !== '#' ? base : null;
}

export function isCryptoCheckoutConfiguredFortnightly(env?: Record<string, string | undefined>): boolean {
  return cryptoCheckoutBaseFortnightly(env) !== null;
}

/** Can Pro be bought on this host at all, by any payment method?
 *
 *  ONE answer, for everything that has to say whether Pro is on sale: /upgrade
 *  (plan buttons or the coming-soon block), the trial-ending email ("Keep Pro"
 *  or "not on sale yet") and /api/version. They used to agree because all of
 *  them read the Lemon Squeezy link. When /upgrade moved to BoomFi the others
 *  were left reading a link to a store that had rejected us, so on a host with
 *  that link still set, "Upgrade" on a locked card opened the dead store, and
 *  on a host without it the email would have said Pro was not on sale while
 *  /upgrade was selling it.
 *
 *  Pro is buyable when the monthly plan has a working payment link: every
 *  other plan only renders alongside the monthly one. Today that is the BoomFi
 *  link. When card payments arrive this becomes "crypto OR card" HERE, and
 *  every caller follows without being touched. */
export function isProBuyable(env?: Record<string, string | undefined>): boolean {
  return isCryptoCheckoutConfigured(env);
}

export type CheckoutPlan = 'monthly' | 'annual' | 'fortnightly';

/** The BoomFi link for a plan with the account id bound to it, or null when
 *  that plan's link is not set. A link that does not parse as a URL is returned
 *  as it was given rather than dropped - the same choice the card links make. */
export function getCryptoCheckoutUrl(plan: CheckoutPlan, user: { id: string } | null): string | null {
  const base = plan === 'annual' ? cryptoCheckoutBaseAnnual()
    : plan === 'fortnightly' ? cryptoCheckoutBaseFortnightly()
    : cryptoCheckoutBase();
  if (!base) return null;
  if (!user?.id) return base;
  try {
    const url = new URL(base);
    url.searchParams.set('customer_ident', user.id);
    return url.toString();
  } catch {
    return base;
  }
}
