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
export function checkoutBase(env: Record<string, string | undefined> = process.env): string | null {
  const base = env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL;
  return base && base !== '#' ? base : null;
}

/** Boolean form of the same read. Returns the URL rather than a boolean above so
 *  callers that need the value get type narrowing from the one check, instead of
 *  testing a helper and then re-testing the variable to satisfy the compiler. */
export function isCheckoutConfigured(env: Record<string, string | undefined> = process.env): boolean {
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
