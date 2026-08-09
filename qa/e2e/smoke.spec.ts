import { test, expect } from '@playwright/test';
import { ROUTES, settle } from './_shared';

// Does every route still load, render styled, and stay free of uncaught JS?
// This is the cheapest suite and the one most likely to catch a real break.

test.describe('smoke', () => {
  for (const route of ROUTES) {
    test(`${route} loads and renders styled`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', e => pageErrors.push(String(e.message)));

      // settle() throws on HTTP >=400 and on an unstyled render.
      await settle(page, route);

      /* THE /briefing EXEMPTION IS GONE, and removing it is the point.
       *
       * This branch exempted /briefing from the uncaught-JS assertion because it
       * trips React #418, citing briefing/page.tsx:194 - the correct line, known
       * since the audit. The annotation was honest and the exemption was not:
       * an annotation is invisible in a green run, so the suite reported clean
       * while that route threw on every single load.
       *
       * It cost 75 events in production and was the most frequent error in
       * GlitchTip - found by reading the dashboard, not by this suite, which had
       * the line number written down the whole time. Filed as #193.
       *
       * SEQUENCING, and dev raised it before I did: this assertion only proves
       * something if it goes RED while the bug is still present. Landing it after
       * the fix would assert a green state it had never seen fail. So it is
       * committed failing, deliberately, and #195 turns it green.
       *
       * If you are reading this because /briefing failed again: the cause is a
       * value that differs between server render and hydration - `useState(new
       * Date())` or equivalent - not something to exempt. */
      expect(pageErrors, `uncaught JS on ${route}`).toEqual([]);
    });
  }

  test('the app shell actually rendered, not just a Suspense fallback', async ({ page }) => {
    await settle(page, '/');
    // Guards the failure mode a stale .next produced during the audit: chunks
    // 404 -> React never hydrates -> the page sits on app/loading.tsx forever
    // while still returning HTTP 200.
    await expect(page.locator('body')).not.toHaveText(/^\s*EN\s*Loading…\s*$/);
    const count = await page.locator('a[href], button').count();
    expect(count, 'landing page should have real controls').toBeGreaterThan(10);
  });

  test('/login renders its form, not a stuck loading state', async ({ page }) => {
    await settle(page, '/login');
    await expect(page.locator('input[type="email"], input#email')).toHaveCount(1);
    await expect(page.getByText(/sign in to your account/i)).toBeVisible();
  });
});
