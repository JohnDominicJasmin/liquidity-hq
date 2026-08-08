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

  /** Every funding percentage on screen, signed.
   *
   *  The character class is `[+-]?`, not `-?`. The page renders positive rates
   *  as "+0.0027%" with an explicit plus, and an earlier version of this helper
   *  matched only a minus - so every positive rate was invisible to the
   *  collector, and `funding-positive` reported "no rates rendered at all".
   *
   *  Six attempts went into hunting the data source. The final failure was not
   *  the source at all - it was this regex. */
  async function renderedRates(page: import('@playwright/test').Page): Promise<number[]> {
    return page.evaluate(() => {
      const out: number[] = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (el.children.length) continue;
        const t = (el as HTMLElement).innerText?.trim() ?? '';
        if (/^[+-]?\d+\.\d{3,4}\s*%$/.test(t)) out.push(parseFloat(t.replace('+', '')));
      }
      return out;
    });
  }

  /* POSITIVE CONTROL. Every earlier version of the pair below passed while
   * proving nothing - either the transformed endpoint did not feed the page, or
   * the collector could not see the values it asserted on. This fails if either
   * is ever true again. */
  test('funding-positive puts POSITIVE rates on screen', async ({ page }) => {
    const served = await installMarketFixtures(page, 'funding-positive');
    await page.goto('/funding', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(10000);

    expect(served.byKey['bybit-tickers'] ?? 0,
      'bybit tickers was not intercepted - the rates on screen are live data').toBeGreaterThan(0);

    const rates = await renderedRates(page);
    expect(rates.length, 'no funding percentages rendered at all').toBeGreaterThan(0);
    expect(rates.some(r => r > 0),
      `every rate positive upstream, yet none rendered positive (${rates.length} values: ${rates.slice(0, 8).join(', ')})`,
    ).toBe(true);
  });

  test('funding-negative puts NO positive rate on screen', async ({ page }) => {
    const served = await installMarketFixtures(page, 'funding-negative');
    await page.goto('/funding', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(10000);

    expect(served.byKey['bybit-tickers'] ?? 0, 'bybit tickers was not intercepted').toBeGreaterThan(0);

    const rates = await renderedRates(page);
    expect(rates.length, 'no funding percentages rendered').toBeGreaterThan(0);

    const positives = rates.filter(r => r > 0);
    expect(positives,
      `funding is negative everywhere upstream, but ${positives.length} positive rate(s) rendered: ${positives.join(', ')}`,
    ).toEqual([]);
  });

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
