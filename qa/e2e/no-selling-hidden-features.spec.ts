import { test, expect } from '@playwright/test';
import { HIDDEN_ROUTES } from './_shared';

/* Do not sell what nobody can reach.
 *
 * `/backtest` and `/live-tracking` are hidden (#264) because they are NOT READY.
 * `/upgrade` was still advertising **"Full strategy backtesting"** in its Pro
 * column at $25/mo, and `docs/PRICING_AND_LIMITS.md` still listed Backtesting as
 * a Trial/Pro entitlement.
 *
 * So a subscriber could pay partly for a feature that redirects to /dashboard.
 * That is a refund and trust problem, not a tidiness one.
 *
 * NO TEST WOULD HAVE CAUGHT IT. The redirect was correct. The pricing page was
 * correct. The defect lived in the gap between two things that were each
 * individually right — which is precisely the kind nothing catches unless
 * something is written to look across the seam. This is that something.
 *
 * It generalises: any future hidden feature that is still being advertised fails
 * here, without anyone remembering to check.
 */

/** What each hidden route is SOLD as. Explicit rather than derived from the path,
 *  because "/live-tracking" would never match copy that says "live tracking" and
 *  a clever slug-to-words transform is one refactor away from matching nothing
 *  at all — which would leave this file green and useless. */
const SOLD_AS: Record<string, string[]> = {
  '/backtest': ['backtest', 'back-test', 'back test'],
  '/live-tracking': ['live tracking', 'live-tracking'],
};

/* Pages a prospective customer reads before paying. `/upgrade` is the one that
   matters most - it is the page with the price on it. */
const SALES_SURFACES = ['/upgrade', '/', '/faq'];

test.describe('do not sell hidden features', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'copy, not layout');
  });

  for (const surface of SALES_SURFACES) {
    test(`${surface} does not advertise a hidden route`, async ({ page }) => {
      await page.goto(surface, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);

      const text = (await page.evaluate(() => document.body.innerText || '')).toLowerCase();

      /* THE CONTROL, and it runs on every surface rather than once.
       *
       * Every assertion below is "this word is absent". A page that rendered
       * nothing satisfies all of them perfectly - and a sales page that failed to
       * load is exactly the case where "we are not advertising it" is true for
       * the wrong reason. */
      expect(text.length,
        `${surface} rendered no text, so "does not mention a hidden feature" is vacuously true`)
        .toBeGreaterThan(200);

      const offenders: string[] = [];
      for (const route of HIDDEN_ROUTES) {
        for (const term of SOLD_AS[route] ?? []) {
          if (text.includes(term)) {
            const at = text.indexOf(term);
            offenders.push(`${route} sold as "${term}" — ...${text.slice(Math.max(0, at - 40), at + 40).trim()}...`);
          }
        }
      }

      expect(offenders,
        `${surface} advertises a route that is hidden. Either un-hide the feature or stop ` +
        `selling it — a customer paying for something that redirects to /dashboard is a refund ` +
        `problem, and the pricing page is the last place anyone thinks to check.`)
        .toEqual([]);
    });
  }
});
