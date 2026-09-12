import { test, expect, type Page, type Route } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

/* Regression coverage for #1176 (#1168 slice): `saveArenaAlert()`'s success UI
 * used to fire UNCONDITIONALLY, even on a failed `/api/price-alerts` save - a
 * 401/500/PRO_REQUIRED response told the user "Alert set", fired
 * `onboarding:done`, and auto-closed the form on a request that never reached
 * the database. Same defect family as #1107/#1166/#278/#279: a non-OK response
 * falling into the generic (here, the only) success path instead of its own.
 *
 * `handleAlertMove()`'s companion bug (an optimistic drag update left un-rolled-
 * back on a failed PATCH) is NOT covered here. It requires driving a
 * `klinecharts` canvas overlay's pointer-drag state machine - no `data-testid`,
 * no exposed hook, and the overlay's screen position depends on the chart's
 * internal price-to-pixel mapping, which is not something a black-box test can
 * compute without the app exposing it. Recorded as an accepted gap in
 * `qa/TEST_GAPS.md` §9 rather than forcing a fragile pixel-coordinate test.
 *
 * THE CONTROL IS LOAD-BEARING, same reasoning as `arena-read-card.spec.ts`: a
 * build where the error path always fires (or never fires) would make the
 * other test meaningless on its own. The success case is asserted first so it
 * is not read as incidental.
 */

const OPEN_ALERT_FORM = { name: 'Set Alert', exact: true };
const SAVE_CTA        = /Set Alert - /;
const PRICE_INPUT     = '0.00';

async function installPriceAlertsSave(
  page: Page,
  outcome: { ok: boolean; errorBody?: unknown },
): Promise<{ posts: () => number }> {
  let posts = 0;
  await page.route('**/api/price-alerts*', (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    if (outcome.ok) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ alert: { id: 'qa-fixture-alert-1' } }),
      });
    }
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify(outcome.errorBody ?? { error: 'fixture: db unavailable' }),
    });
  });
  return { posts: () => posts };
}

/** Registers a window listener BEFORE the click, so a false negative (event
 *  fired before the listener existed) is not possible. */
async function armOnboardingDoneWatch(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __onboardingDoneFired: boolean }).__onboardingDoneFired = false;
    window.addEventListener('onboarding:done', () => {
      (window as unknown as { __onboardingDoneFired: boolean }).__onboardingDoneFired = true;
    });
  });
}

test.describe('arena price-alert save resilience (#1176, #1168)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('CONTROL: a successful save shows "Alert set" and closes the form', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      const fixture = await installPriceAlertsSave(page, { ok: true });
      await gotoSignedIn(page, '/arena');
      await armOnboardingDoneWatch(page);

      await page.getByRole('button', OPEN_ALERT_FORM).click();
      await page.getByPlaceholder(PRICE_INPUT).fill('999999');
      await page.getByRole('button', { name: SAVE_CTA }).click();

      await expect.poll(() => fixture.posts(), {
        message: 'the click never reached /api/price-alerts - this test measured nothing',
        timeout: 15_000,
      }).toBeGreaterThan(0);

      await expect(page.getByText(/Alert set/), 'a real save must show success').toBeVisible({ timeout: 10_000 });
      const fired = await page.evaluate(() => (window as unknown as { __onboardingDoneFired: boolean }).__onboardingDoneFired);
      expect(fired, 'onboarding:done must fire on a real save').toBe(true);

      // 1.5s auto-close, per saveArenaAlert()'s own setTimeout.
      await expect(page.getByPlaceholder(PRICE_INPUT), 'the form should auto-close after a real save').toHaveCount(0, { timeout: 5_000 });
    } finally {
      await ctx.close();
    }
  });

  test('#1176: a failed save shows the error, not "Alert set", and does not close', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      const fixture = await installPriceAlertsSave(page, {
        ok: false,
        errorBody: { error: 'fixture: db unavailable' },
      });
      await gotoSignedIn(page, '/arena');
      await armOnboardingDoneWatch(page);

      await page.getByRole('button', OPEN_ALERT_FORM).click();
      await page.getByPlaceholder(PRICE_INPUT).fill('999999');
      await page.getByRole('button', { name: SAVE_CTA }).click();

      await expect.poll(() => fixture.posts(), {
        message: 'the click never reached /api/price-alerts - this test measured nothing',
        timeout: 15_000,
      }).toBeGreaterThan(0);

      await expect(page.getByText('fixture: db unavailable'),
        'the server error message must surface, not a generic swallow').toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/Alert set/),
        'a failed save must never show the success message - #1176').toHaveCount(0);

      const fired = await page.evaluate(() => (window as unknown as { __onboardingDoneFired: boolean }).__onboardingDoneFired);
      expect(fired, 'onboarding:done must not fire on a failed save - #1176').toBe(false);

      // The form must still be open, and the price the user typed must not
      // have been thrown away, since nothing was actually saved.
      await expect(page.getByPlaceholder(PRICE_INPUT),
        'a failed save must not auto-close the form - #1176').toBeVisible();
      await expect(page.getByPlaceholder(PRICE_INPUT)).toHaveValue('999999');
    } finally {
      await ctx.close();
    }
  });
});
