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
