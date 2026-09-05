import { test, expect } from '@playwright/test';

/* DOES THE UPGRADE BUTTON ACTUALLY HAVE A CHECKOUT URL? (#243)
 *
 * `/api/version` cannot answer this, and it is the natural place to look:
 *
 *   /api/version   lib/configured.ts, runs SERVER-side per request,
 *                  reads live process.env
 *
 *   /upgrade       'use client', and isCheckoutConfigured() is called at
 *                  MODULE SCOPE (app/upgrade/page.tsx:13), so
 *                  NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL is baked into the
 *                  client bundle at BUILD time
 *
 * Set the variable after a build and the two disagree: `/api/version` reports
 * `configured.checkout: true` while the shipped bundle still holds `'#'` and
 * the button is dead. #243 names that as the most likely way the task fails
 * quietly - and the check meant to rule it out would confirm the wrong thing.
 *
 * SO THIS COMPARES THE TWO SOURCES rather than trusting either. It is a
 * config-agreement check, not a UI test.
 *
 * NO SESSION NEEDED, contrary to where this started. `/upgrade` gates only on
 * `loading || isPro` (page.tsx:105) and deliberately shows pricing to anonymous
 * visitors - login is required at the click, not to see the price. So an
 * unauthenticated check is sufficient AND is the cleaner instrument: it removes
 * the fixture, the fake session and the Supabase interception from a test whose
 * subject is a build-time constant.
 *
 * QA loaded /upgrade on staging signed out, found no CTA, and concluded an
 * authenticated session was required. It was not - the CTA was missing because
 * of the #243 inlining defect this spec now guards. Worth recording: "the
 * button is absent" and "I am not allowed to see the button" looked identical
 * from outside.
 *
 * RUN IT AGAINST A DEPLOYED HOST:
 *
 *   E2E_BASE_URL=https://liquidity-hq-staging.onrender.com \
 *     npx playwright test qa/e2e/checkout-config-agrees.spec.ts --project=desktop
 *
 * The fixture routes Supabase by absolute URL, so it works on any app origin
 * pointing at the same Supabase project.
 */

interface VersionPayload {
  commit?: string;
  configured?: { checkout?: boolean };
}

test.describe('#243 checkout config', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the server and the shipped bundle agree about whether checkout is configured', async ({ page, baseURL }) => {
    /* The server's claim, from the same read the app gates on (#282). */
    const res = await page.request.get('/api/version');
    expect(res.ok(), `/api/version returned ${res.status()}`).toBe(true);
    const version = (await res.json()) as VersionPayload;
    const serverSaysConfigured = version.configured?.checkout === true;

    /* Anonymous. A 'pro' session would be REDIRECTED to /arena
       (page.tsx:84) - my first version used one and reported a config
       disagreement that was really the wrong session state. */
    await page.goto('/upgrade');

    /* THE CTA IS A <button>, NOT AN <a>. It navigates via
       `window.location.href = getCheckoutUrl(user)` in an onClick
       (page.tsx:96), so there is no href to read - which is also why QA's
       sweep for anchors matching `lemon` or `href="#"` found neither and
       could not settle this.
       Matched on a testid rather than text or styling: the labels are
       DB-driven through useLabels(), so matching copy binds this to whatever
       the labels table says today, in one locale. Same reasoning as #441's
       `locked-feature` marker. */
    const cta = page.getByTestId('checkout-cta-monthly');
    const appeared = await cta.waitFor({ state: 'attached', timeout: 20_000 })
      .then(() => true).catch(() => false);

    /* The button's PRESENCE is the bundle's `CHECKOUT_CONFIGURED`, evaluated at
       module scope from the inlined build-time value. That is exactly the
       reading `/api/version` cannot give. */
    const bundleHasUrl = appeared;

    /* Report both readings whichever way this goes - a bare pass/fail here
       tells whoever runs it nothing about which side was wrong. */
    const readings = `/api/version commit=${version.commit ?? 'unknown'} configured.checkout=${serverSaysConfigured} | checkout CTA rendered=${appeared} | base=${baseURL}`;

    if (serverSaysConfigured) {
      expect(
        bundleHasUrl,
        `THE SERVER AND THE BUNDLE DISAGREE. ${readings}\n` +
        'The environment has NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL set, but the ' +
        'shipped client bundle does not carry it - so the button is dead while ' +
        '/api/version reports it configured. The variable was almost certainly ' +
        'set after this build: redeploy so it is inlined, then re-run. This is ' +
        'the exact silent failure #243 warns about.',
      ).toBe(true);
    } else {
      /* Not configured is a legitimate state - most environments have never had
         a store. What must NOT happen is the bundle carrying a live URL the
         server does not know about, which would mean buyers reaching a checkout
         nothing else in the app believes exists. */
      expect(
        bundleHasUrl,
        `The bundle carries a checkout URL but the server reports none. ${readings}\n` +
        'Inverted form of the same drift - the build has a URL the current ' +
        'environment does not.',
      ).toBe(false);
    }

    /* Not an assertion - the run's own record, so a green result still says
       WHICH state was verified. "Agrees" is meaningless without it. */
    console.log(`[#243] ${readings} | verdict=${serverSaysConfigured ? 'configured, bundle agrees' : 'not configured, bundle agrees'}`);
  });
});
