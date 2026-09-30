import { test, expect } from '@playwright/test';

/* DO THE UPGRADE BUTTONS MATCH WHAT THE SERVER SAYS IS FOR SALE? (#243, #1259)
 *
 * `/api/version` cannot answer this on its own, and it is the natural place to look:
 *
 *   /api/version   lib/configured.ts, runs SERVER-side per request, reads live
 *                  process.env
 *
 *   /upgrade       'use client'; its CHECKOUT_* constants are computed at MODULE
 *                  SCOPE from NEXT_PUBLIC_* payment links, so the links are baked
 *                  into the client bundle at BUILD time
 *
 * Set a link after a build and the two disagree: `/api/version` reports the plan
 * configured while the shipped page still has no button for it. #243 named that
 * as the way checkout fails quietly. So this compares the two sources rather than
 * trusting either. It is a config-agreement check, not a UI test.
 *
 * REWRITTEN 2026-09-30 (#1259). The first version compared `configured.checkout`
 * (the Lemon Squeezy monthly link) with the monthly button. Since #861/#1468 the
 * buttons are gated on the crypto links instead - Lemon Squeezy rejected the store
 * - so that comparison asked about a link no button reads any more, and went red
 * on every host where the Lemon Squeezy variable was still set. It now compares each
 * button with the flag the deployed build itself gates it on - see expectedButtons()
 * below. On a current build:
 *
 *   monthly button      <=>  configured.proBuyable
 *   annual button       <=>  proBuyable AND cryptoCheckoutAnnual
 *   two-weekly button   <=>  proBuyable AND cryptoCheckoutFortnightly
 *
 * (annual and two-weekly only render in the states where monthly does - page.tsx's
 * CTA block - hence the AND.) The first rewrite read proBuyable alone, and failed on
 * staging, whose build (c67a61b) predates that flag - QA's own premise error, caught
 * by running it there.
 *
 * NO SESSION. `/upgrade` shows pricing to anonymous visitors; login is required at
 * the click, not to see the price. Nothing is clicked here, so nothing leaves the
 * app for a payment host.
 *
 * RUN IT AGAINST A DEPLOYED HOST:
 *
 *   E2E_BASE_URL=https://liquidity-hq-qa.onrender.com \
 *     npx playwright test qa/e2e/checkout-config-agrees.spec.ts --project=desktop
 */

interface VersionPayload {
  commit?: string;
  configured?: {
    proBuyable?: boolean; cryptoCheckout?: boolean; cryptoCheckoutAnnual?: boolean; cryptoCheckoutFortnightly?: boolean;
    checkout?: boolean; checkoutAnnual?: boolean; checkoutFortnightly?: boolean;
  };
}

/* THREE GENERATIONS OF THE PAGE ARE DEPLOYED AT ONCE, and this spec runs against
 * all of them (qa, staging, and production through qa/prod-readonly.ts). Each gates
 * its buttons on a different flag, so the flag compared is the one THAT build
 * reports and gates on - chosen by which flags its /api/version carries:
 *
 *   has proBuyable            (#1468 on)   buttons gate on proBuyable + crypto links
 *   has cryptoCheckout only   (#1466)      buttons gate on the crypto monthly link
 *   has neither               (before)     buttons gate on the Lemon Squeezy links
 *
 * In all three, annual and two-weekly render only in the states where monthly does
 * (the CTA block in app/upgrade/page.tsx, the same in each generation). */
function expectedButtons(c: NonNullable<VersionPayload['configured']>) {
  if (typeof c.proBuyable === 'boolean') {
    return { era: 'proBuyable (#1468+)', monthly: c.proBuyable, annual: c.proBuyable && c.cryptoCheckoutAnnual === true, fortnightly: c.proBuyable && c.cryptoCheckoutFortnightly === true };
  }
  if (typeof c.cryptoCheckout === 'boolean') {
    return { era: 'crypto links (#1466)', monthly: c.cryptoCheckout, annual: c.cryptoCheckout && c.cryptoCheckoutAnnual === true, fortnightly: c.cryptoCheckout && c.cryptoCheckoutFortnightly === true };
  }
  expect(typeof c.checkout, '/api/version reports none of proBuyable, cryptoCheckout or checkout - re-derive this spec from lib/configured.ts').toBe('boolean');
  return { era: 'Lemon Squeezy links (pre-#1466)', monthly: c.checkout === true, annual: c.checkout === true && c.checkoutAnnual === true, fortnightly: c.checkout === true && c.checkoutFortnightly === true };
}

test.describe('#243 checkout config', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the server and the shipped bundle agree about which plans are for sale', async ({ page, baseURL }) => {
    const res = await page.request.get('/api/version');
    expect(res.ok(), `/api/version returned ${res.status()}`).toBe(true);
    const version = (await res.json()) as VersionPayload;
    const c = version.configured ?? {};
    const expected = expectedButtons(c);

    await page.goto('/upgrade');
    /* Wait for the page to settle into ONE of its states before reading: either a
       plan button, or the coming-soon block. Reading earlier would record "no
       button" for a page that simply had not rendered yet. */
    await page.locator('[data-testid^="checkout-cta"], h1').first().waitFor({ state: 'attached', timeout: 20_000 });
    await page.waitForTimeout(1_500);

    /* THE BUTTONS ARE <button>s with test ids, not links: the page navigates in an
       onClick, so there is no href to read. Matched on test ids, not text - the
       labels are DB-driven and differ by locale. */
    const rendered = {
      monthly: await page.getByTestId('checkout-cta-monthly').count() > 0,
      annual: await page.getByTestId('checkout-cta-annual').count() > 0,
      fortnightly: await page.getByTestId('checkout-cta-fortnightly').count() > 0,
    };

    const readings = `/api/version commit=${version.commit ?? 'unknown'} gating=${expected.era} expects=${JSON.stringify({ monthly: expected.monthly, annual: expected.annual, fortnightly: expected.fortnightly })} | buttons rendered: ${JSON.stringify(rendered)} | base=${baseURL}`;

    for (const plan of ['monthly', 'annual', 'fortnightly'] as const) {
      expect(rendered[plan],
        expected[plan]
          ? `THE SERVER AND THE BUNDLE DISAGREE on ${plan}. ${readings}\nThe server says this plan is for sale, but the shipped page has no button for it. Its NEXT_PUBLIC_ payment link was almost certainly set after this build: redeploy so it is inlined, then re-run (#243).`
          : `The page offers ${plan} but the server says it is not for sale. ${readings}\nThe build carries a payment link the current environment does not - buyers could reach a checkout nothing else in the app believes exists.`,
      ).toBe(expected[plan]);
    }

    /* Not an assertion - the run's own record, so a green result still says WHICH
       state was verified. "Agrees" is meaningless without it. */
    console.log(`[#243] ${readings} | verdict=agree`);
  });
});
