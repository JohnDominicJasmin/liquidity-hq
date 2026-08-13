import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, signedInContext, gotoSignedIn } from './_auth';

/* Does the checkout button actually carry the signed-in user's identity?
 *
 * `__tests__/checkoutUrl.test.mts` pins what `getCheckoutUrl()` RETURNS. It
 * cannot prove the function is wired to the button - which is exactly the gap
 * that produced #164, where a fix passed 22 source-level tests while its hook
 * returned a context default forever. This is the other half.
 *
 * WHY IT MATTERS MORE THAN A NORMAL WIRING CHECK. `app/upgrade/page.tsx` does:
 *
 *     window.location.href = getCheckoutUrl(user)
 *
 * so `checkout[custom][user_id]` leaves the browser in a URL the payer controls.
 * `qa/e2e/payments-webhook.spec.ts` asserts the handler refuses a payload
 * claiming an id the payer does not own. Between the three files the whole path
 * is covered: what the URL contains, that the button really sends it, and that
 * the server does not trust it.
 *
 * NEEDS NO LEMONSQUEEZY ACCOUNT. `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL` is set
 * to an obviously fake host in `ci.yml`, the same precedent as the fake webhook
 * secret already there. The navigation is intercepted and aborted, so nothing is
 * ever requested from that host.
 *
 * 🔴 WHAT REMAINS UNTESTED: a real purchase granting Pro. That needs the owner's
 * test-mode keys and a live sandbox. §5 stays open on that alone.
 */

/* Matched on the PATH SHAPE, not on a hostname.
 *
 * This was `example.lemonsqueezy.com` - the deliberately fake value `ci.yml`
 * inlines at build time. That works for a local build and silently breaks on a
 * DEPLOYED host, where the store URL is real and different, so the interception
 * never fires and the failure reads "nothing navigated to
 * example.lemonsqueezy.com. Either the button is not wired to getCheckoutUrl,
 * or the env var was absent at BUILD time" - a message that sends the reader
 * looking for a product defect or a build problem, when the spec was aimed at a
 * host that was never going to be contacted.
 *
 * Found 2026-08-12 running this against deployed `staging`. Same family as the
 * hardcoded `localhost` in security.spec and perf.spec (#266): anything holding
 * a URL constant is a spec that silently only ever tests one environment.
 *
 * `/checkout/buy/<id>` is LemonSqueezy's own path shape and is shared by the CI
 * fake and every real store, so this matches both without knowing the host. */
const CHECKOUT_PATH = '**/checkout/buy/**';

test.describe('checkout hand-off', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'a navigation URL is viewport-independent');
  });

  test('the checkout button sends the SIGNED-IN user\'s own id', async ({ browser }) => {
    /* `signedInContext`, NOT `signIn`.
     *
     * The first version called `signIn()` for a token and then opened a PLAIN
     * context - so the page had no session, `user` was null, and /upgrade did
     * `router.push('/login?signup=1')` instead of navigating to checkout. It
     * failed with "nothing navigated", which reads like a wiring defect and was
     * entirely my error.
     *
     * `signedInContext` seeds the `sb-<ref>-auth-token` localStorage entry that
     * supabase-js actually reads, which is what makes the app treat the page as
     * signed in.
     *
     * FIXTURE B, NOT A. A is pinned `pro`, and /upgrade redirects a Pro user
     * away before rendering anything - `if (loading || isPro) return
     * <LoadingState/>`. Using A produced "no checkout button rendered", which
     * again reads like a defect and was again the fixture being wrong for the
     * question. B is pinned `free`, which is who actually sees this page. */
    const ctx = await signedInContext(browser, 'b', { viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    const page = await ctx.newPage();

    /* Capture the hand-off and STOP it. Aborting means the fake host is never
     * contacted, so this test makes no third-party request at all. */
    let handoff = '';
    await page.route(CHECKOUT_PATH, route => {
      handoff = route.request().url();
      return route.abort();
    });

    try {
      /* The env var is inlined at BUILD time, so if the webServer was built
       * without it, getCheckoutUrl returns the signup fallback and this test
       * would be asserting the unconfigured path while claiming otherwise.
       * Skipping loudly beats a green run that measured nothing. */
      /* gotoSignedIn asserts the page really rendered as a signed-in user
       * rather than an onboarding or signed-out screen - without it, "no button
       * found" is ambiguous between a defect and a bad fixture. */
      await gotoSignedIn(page, '/upgrade');

      const cta = page.locator('button', { hasText: /upgrade|pro|checkout|continue/i }).first();
      await expect(cta, 'no checkout button rendered on /upgrade').toBeVisible({ timeout: 20_000 });
      await cta.click();

      await expect
        .poll(() => handoff, {
          timeout: 15_000,
          message:
            'nothing navigated to a /checkout/buy/ URL. Either the button is not wired to ' +
            'getCheckoutUrl, or NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL was absent at BUILD time ' +
            'and the page fell back to /login?signup=1 - check the webServer build env before ' +
            'reading this as a product defect.',
        })
        .not.toBe('');

      const url = new URL(handoff);
      expect(url.searchParams.get('checkout[custom][user_id]'),
        'the checkout URL carries a different id than the signed-in user. That is the value the ' +
        'webhook reads as custom_data.user_id - see payments-webhook.spec.ts.',
      ).toBe(FIXTURES.bId);
      expect(url.searchParams.get('checkout[email]'),
        'the checkout URL carries a different email than the signed-in user',
      ).toBe(FIXTURES.bEmail);
    } finally { await ctx.close(); }
  });

  /* A signed-out visitor must not reach checkout at all - they are sent to
   * signup. Without this, the test above is satisfied by a page that sends
   * everyone to the same URL regardless of who they are. */
  test('a signed-out visitor is sent to signup, not to checkout', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    const page = await ctx.newPage();

    let reachedCheckout = false;
    await page.route(CHECKOUT_PATH, route => { reachedCheckout = true; return route.abort(); });

    try {
      await gotoGuarded(page, '/upgrade', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);

      const cta = page.locator('button', { hasText: /upgrade|pro|checkout|continue/i }).first();
      if (await cta.isVisible().catch(() => false)) {
        await cta.click();
        await page.waitForTimeout(2000);
      }

      expect(reachedCheckout,
        'a signed-out visitor reached the checkout host. getCheckoutUrl(null) must return ' +
        '/login?signup=1 - a checkout with no user_id produces a payment the webhook cannot ' +
        'match to an account.',
      ).toBe(false);
    } finally { await ctx.close(); }
  });
});
