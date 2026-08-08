import { test, expect } from '@playwright/test';
import { installMarketFixtures } from './_fixtures';

/* The first tests in this suite that assert against a KNOWN market input.
 *
 * `qa/TEST_GAPS.md` §1: every other spec runs against whatever the live market
 * is doing, so a green run means "nothing crashed given today's prices" and
 * never "the calculation is right". These three run against recorded payloads,
 * so the input is fixed and the assertion means something.
 *
 * Deliberately modest in what they claim. They assert the RENDER PATH survives a
 * controlled input and displays it — not that any domain calculation is correct,
 * because the correct output for a given funding rate is a product decision
 * nobody has written down. Asserting current behaviour as if it were intended
 * would produce a change-detector, not a test.
 */

test.describe('market data scenarios', () => {
  // Interception is at the network layer, so viewport is irrelevant. Running
  // both projects would double the requests for nothing.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'network-level, viewport irrelevant');
  });

  test('fixtures are actually served (guards against a vacuous pass)', async ({ page }) => {
    const served = await installMarketFixtures(page, 'as-recorded');
    await page.goto('/funding', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    /* Without this the whole file is worthless: if no route matched, every test
     * below would run against the LIVE market and still pass, which is exactly
     * the state §1 describes. */
    expect(served.count, 'no fixture route was hit — the specs below would be testing live data').toBeGreaterThan(0);
  });

  /* THE FUNDING SCENARIOS ARE NOT HERE YET, DELIBERATELY.
   *
   * `funding-negative` / `funding-positive` exist in `_fixtures.ts` and are not
   * asserted on, because three successive controls showed the assertion would
   * have been vacuous:
   *
   *   1. First version asserted the page contained /-\s?\d/. It passed against
   *      POSITIVE data - the page already renders 18 strings like "-0".
   *   2. Narrowed to funding percentages only. Still passed on unmodified data:
   *      the recorded Binance payload has 9 of 42 rows already negative.
   *   3. Forced every Binance row positive. The 18 rendered rates were STILL all
   *      negative - so they do not come from `fapi/v1/fundingRate` at all.
   *
   * (3) is the finding: the endpoint feeding the rates on screen is not yet
   * intercepted. `fapi/v1/premiumIndex` is the likely source and is the one
   * endpoint `qa/FIXTURES.md` records as too large to capture (190KB, all
   * symbols) - so the gap is exactly where the shortcut was taken.
   *
   * Shipping a green "funding is negative" test now would assert that the market
   * was negative today. See qa/FIXTURES.md.
   */

  test('an upstream 500 does not blank the page', async ({ page }) => {
    const served = await installMarketFixtures(page, 'upstream-500');
    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));

    await page.goto('/funding', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    expect(served.count, 'fixtures were not served').toBeGreaterThan(0);

    /* TEST_GAPS §1: "what the app does when Binance/CMC returns an error" has
     * never been tested, and it is the failure most likely to happen in public.
     * A data source being down should degrade, not white-screen. */
    const body = await page.locator('body').innerText();
    expect(body.trim().length, 'upstream 500 produced an empty page').toBeGreaterThan(50);
    expect(pageErrors, `upstream 500 threw in the page:\n${pageErrors.join('\n')}`).toEqual([]);
  });
});
