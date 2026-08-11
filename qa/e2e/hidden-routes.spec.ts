import { test, expect } from '@playwright/test';
import { HIDDEN_ROUTES, gotoGuarded } from './_shared';

/* /backtest and /live-tracking are hidden (#264, shipped in #265).
 *
 * Removing them from `ROUTES` stops the sweeping specs measuring `/dashboard`
 * twice — but removal alone asserts nothing. Without this file, the redirect
 * could be dropped tomorrow and the only symptom would be two routes quietly
 * missing from every sweep, which is not a symptom at all.
 *
 * So: the sweeps no longer visit them, and this proves they are hidden rather
 * than merely unlisted.
 */

test.describe('hidden routes', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'routing, not viewport');
  });

  for (const route of HIDDEN_ROUTES) {
    test(`${route} does not serve its page`, async ({ page }) => {
      const res = await gotoGuarded(page, route, { waitUntil: 'domcontentloaded' });

      /* A redirect, not a 404 — the owner's call, and the reason is bookmarks:
         anyone who saved the page lands somewhere useful. Asserting the
         DESTINATION rather than just "not 200 here" is what makes this catch a
         redirect that starts pointing at the wrong place. */
      expect(page.url(), `${route} did not redirect away`).not.toContain(route);
      expect(page.url(), `${route} redirected somewhere unexpected`).toContain('/dashboard');
      expect(res?.status(), `${route} returned an error rather than redirecting`).toBeLessThan(400);
    });
  }

  /* THE CONTROL, and it is the one that matters.
   *
   * Every assertion above is satisfied by an app where NOTHING loads — a
   * catch-all redirect, a broken router, a service returning 302 for every path
   * would all pass. This proves a normal route still serves its own page, so the
   * redirect is specific rather than total.
   *
   * Same shape as the snapshot control that caught a fully dead endpoint
   * reporting as a correctly-handled partial failure. */
  test('control: a route that is NOT hidden still serves itself', async ({ page }) => {
    const res = await gotoGuarded(page, '/markets', { waitUntil: 'domcontentloaded' });
    expect(res?.status(), '/markets did not load').toBe(200);
    expect(page.url(), '/markets redirected - the hiding is not specific to the two routes, ' +
      'so every assertion above passes for the wrong reason').toContain('/markets');
  });

  /* The nav must not advertise a page that redirects. A visible link to a route
     that bounces is worse than no link: it reads as a broken feature rather than
     a removed one. */
  test('no navigation link points at a hidden route', async ({ page }) => {
    await gotoGuarded(page, '/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const offenders = await page.evaluate((hidden: readonly string[]) =>
      [...document.querySelectorAll('a[href]')]
        .map(a => a.getAttribute('href') || '')
        .filter(h => hidden.some(r => h === r || h.startsWith(r + '?') || h.startsWith(r + '#'))),
      HIDDEN_ROUTES as readonly string[]);

    expect(offenders, 'a nav link still points at a hidden route').toEqual([]);
  });
});
