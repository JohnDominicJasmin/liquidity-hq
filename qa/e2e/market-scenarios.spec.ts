import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';
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
    await gotoGuarded(page, '/funding', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    /* Without this the whole file is worthless: if no route matched, every test
     * below would run against the LIVE market and still pass, which is exactly
     * the state §1 describes. */
    expect(served.count, 'no fixture route was hit — the specs below would be testing live data').toBeGreaterThan(0);
  });

  /* PRICES, WHICH THE ASSERTION ABOVE NEVER COVERED — #439.
   *
   * `served.count > 0` was satisfied by the funding endpoints while COIN PRICES
   * came from a WebSocket no `page.route` can touch. So this file has been
   * correctly reporting "fixtures are served" and incorrectly implying market
   * data was pinned: prices, and everything derived from them, were live.
   *
   * The visible cost was the Arena evidence grid — a pure function over
   * `CoinData` — rendering nothing at all in fixtured runs, which I spent five
   * attempts attributing to `lib/arenaEvidence.ts`.
   *
   * `installMarketFixtures` now closes the socket and serves `restPoll()` from
   * `proxy-binance-24hr`. This asserts a SENTINEL price reaches the screen,
   * because that is the only claim that distinguishes a pinned run from a lucky
   * one — see the note on the assertion itself for why the recorded price was
   * not good enough. A route being intercepted proves a request was answered; it
   * does not prove the answer was used. */
  test('coin prices on screen come from the fixture, not the live market', async ({ page }) => {
    test.setTimeout(180_000);
    const served = await installMarketFixtures(page, 'price-sentinel');
    await gotoGuarded(page, '/arena', { waitUntil: 'domcontentloaded' });

    /* WAIT ON THE ROUTE, NOT ON THE UI STRING.
     *
     * The first version waited for the app's `Live · backup feed` status text
     * and timed out at 90s on `/arena` — that indicator renders on `/`, which
     * is where the recorder happened to see it. So the wait was coupled to
     * which screen the test visits, for no reason: the thing being waited for
     * is the fallback firing, and `served.byKey` reports exactly that on every
     * route.
     *
     * The fallback needs the socket's retries to exhaust first, so this is a
     * poll rather than a sleep. */
    await expect.poll(() => served.byKey['proxy-binance-24hr'] ?? 0, {
      timeout: 120_000,
      message: 'restPoll never fired — the price socket did not fall back, so nothing pinned prices',
    }).toBeGreaterThan(0);
    await page.waitForTimeout(5000);

    const body = await page.evaluate(() => document.body.innerText);

    /* A SENTINEL, NOT THE RECORDED PRICE.
     *
     * The first version asserted the recorded BTC price, 62624.97 — and passed.
     * It was still a bad control: the fixture had been captured from the live
     * market hours earlier, so an entirely UNFIXTURED run would have shown
     * roughly the same number that day. It could only have started failing once
     * the market drifted, which makes "it passes" evidence of the date rather
     * than of the fixture.
     *
     * `price-sentinel` rewrites every `lastPrice` to 11111.11. No real print
     * rounds to that, so this can only pass if the fixture reached the screen —
     * and it fails the moment coin data slips back to the live socket.
     *
     * The separator is optional because how the number is formatted is a
     * presentation decision the redesign is actively changing, and not what
     * this test is about. */
    expect(body,
      'the sentinel price is not on screen — coin data is NOT under fixture control, ' +
      'and every "fixtured" visual sweep is measuring the live market',
    ).toMatch(/11[,\s]?111/);
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
    await gotoGuarded(page, '/funding', { waitUntil: 'domcontentloaded' });
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
    await gotoGuarded(page, '/funding', { waitUntil: 'domcontentloaded' });
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

    await gotoGuarded(page, '/funding', { waitUntil: 'domcontentloaded' });
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
