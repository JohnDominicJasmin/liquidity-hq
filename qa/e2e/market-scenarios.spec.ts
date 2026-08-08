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

  /* THE FUNDING SCENARIOS ARE STILL NOT ASSERTED ON. Five attempts, documented
   * so the next person does not repeat them.
   *
   *   1. Assert the page contains a negative number -> passed on POSITIVE data.
   *      The page already renders 18 strings like "-0".
   *   2. Narrow to funding percentages -> passed on unmodified data. The
   *      recorded Binance payload already had 9 of 42 rows negative.
   *   3. Force `fapi/v1/fundingRate` positive -> screen unchanged.
   *   4. Add `premiumIndex` (the 190KB endpoint skipped in recording, trimmed to
   *      48 symbols) -> screen unchanged.
   *   5. Add `bybit/v5/market/funding/history`, found by TRACING every request
   *      the page makes rather than reasoning about it -> screen unchanged.
   *
   * The tell throughout: the rendered values SHIFT BETWEEN RUNS. Fixtures are
   * static, so whatever produces them is still live. `/api/funding` is not even
   * requested by this page.
   *
   * `funding-positive` / `funding-negative` work in `_fixtures.ts` and both
   * endpoints are recorded — what is missing is knowing which source the number
   * on screen is derived from. Until that is known, an assertion here would only
   * report what the market did today.
   *
   * Deliberately left failing-by-absence rather than shipped green. See
   * qa/FIXTURES.md.
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
