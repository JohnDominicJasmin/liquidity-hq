import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded, marketDataUnavailable } from './_shared';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

/* Are the gated timeframes hidden from FREE accounts and visible to PRO? (#310)
 *
 * THE PRO DIRECTION IS THE POINT. Dev built this and could not verify that half
 * - they have no Pro session, so "blur everything for everyone" passed
 * everything they ran, and they said so rather than implying otherwise.
 *
 * A gate that hides the feature from EVERYONE satisfies every free-account
 * assertion perfectly. That is the same shape as the four econ-staleness tests
 * that all pointed one way, and as the /ops gate that denied everyone while
 * passing the whole suite.
 *
 * IT READS COMPUTED COLOUR, NOT CLASS NAMES. The owner's requirement was that
 * the red/green goes away, not that a class is renamed - a blur with the colour
 * still underneath leaks the direction, which is most of what these cells say.
 */

const GATED = ['5m', '15m'] as const;
const OPEN  = ['1h', '4h'] as const;

/** `--txt3` - what a stripped bias resolves to. Measured by dev on a free run. */
const NEUTRAL_GREY = 'rgb(123, 130, 151)';

/**
 * PIN BOTH GATED ROWS TO A DEFINITE BIAS.
 *
 * Without this the colour assertion is unsound, and I nearly shipped it that
 * way: `rsi5m` was 55 on qa and the bias bands are >57 / <43, so the row was
 * legitimately NEUTRAL GREY and the Pro control went red on a build that did
 * not even have the feature. Third time today an uncontrolled live input
 * produced a difference that looked like the effect under test.
 *
 * The two rows come from different places, and the naming is the trap:
 *
 *   5m    /api/market/rsi                             field rsi5m
 *   15m   /api/market/klines?...&interval=15          RSI(14) computed IN THE
 *                                                     BROWSER from the closes.
 *                                                     `rsi14` is the PERIOD,
 *                                                     not the timeframe.
 *
 * A monotonically rising close series gives RSI(14) = 100 - far outside the
 * neutral band, so there is no need to reverse the maths. Bybit returns
 * newest-first and MarketProvider reverses it, so the order here is irrelevant
 * to the result but the SHAPE is not: index 4 is the close, 2 high, 3 low,
 * 6 turnover.
 */
async function pinBullish(page: Page) {
  await page.route('**/api/market/rsi**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ rsi: { btc: { rsi5m: 75, rsi1h: 69, rsi4h: 38, rsiDaily: 51, rsiWeekly: 26, rsiMonthly: 29 } } }),
  }));

  await page.route('**/api/market/klines**interval=15**', route => {
    const list = Array.from({ length: 100 }, (_, i) => {
      const c = 1000 + i;
      return [String(1_700_000_000_000 + i * 900_000), String(c - 1), String(c + 1), String(c - 2), String(c), '10', '10000'];
    }).reverse();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { list } }) });
  });
}

/** Per-timeframe blur and colour, read from the Multi-TF rows. */
async function readRows(page: Page) {
  return page.evaluate(() => {
    const out: Record<string, { blur: string; colour: string }> = {};
    /* RsiRow is a grid: span(tf) | div(bar) | span(value) | span(badge).
       The first version looked for `:scope > div` as the label and read 0 rows -
       the label is a SPAN. The guard caught it rather than passing vacuously,
       which is the only reason this is a corrected selector and not a green
       test that measured nothing. */
    for (const row of Array.from(document.querySelectorAll('div'))) {
      const kids = Array.from(row.children);
      if (kids.length < 3) continue;
      const label = (kids[0].textContent || '').trim();
      if (!/^(5m|15m|1h|4h|1D|1W|1M)$/.test(label) || out[label]) continue;
      const value = kids[2] as HTMLElement;
      const cs = getComputedStyle(value);
      /* The blur may sit on the value or on an ancestor, so walk up a little. */
      let blur = cs.filter;
      for (let n: HTMLElement | null = value, i = 0; n && i < 3 && (!blur || blur === 'none'); n = n.parentElement, i++) {
        blur = getComputedStyle(n).filter;
      }
      out[label] = { blur: blur || 'none', colour: cs.color };
    }
    return out;
  });
}

/** Load /arena and prove the Multi-TF card rendered before reading anything. */
async function multiTf(page: Page, signedIn: boolean) {
  if (signedIn) await gotoSignedIn(page, '/arena');
  else await gotoGuarded(page, '/arena');
  await page.waitForTimeout(9000);

  const card = page.locator('div').filter({ hasText: /MULTI-TIMEFRAME ALIGNMENT/i }).first();
  await expect(card, 'the Multi-TF card did not render - nothing below is meaningful')
    .toBeVisible({ timeout: 20_000 });

  const rows = await readRows(page);
  expect(Object.keys(rows).length,
    `read ${Object.keys(rows).length} timeframe rows - the selector is not finding them, so ` +
    `every assertion below would pass vacuously`).toBeGreaterThanOrEqual(4);
  return rows;
}

test.describe('gated timeframes', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
  });

  test('a FREE visitor gets the gated timeframes blurred AND uncoloured', async ({ page }) => {
    /* The RSI route is pinned below, but the 15m row also needs KLINES, which
       come from Binance. On a runner that cannot reach it the row renders the
       neutral grey for lack of data - which looks exactly like the gating bug
       this file exists to catch. Skip rather than report it. */
    const down = await marketDataUnavailable(page.request);
    test.skip(down !== null, down ?? '');

    const rows = await multiTf(page, false);

    for (const tf of GATED) {
      expect(rows[tf], `no ${tf} row found`).toBeDefined();
      expect(rows[tf].blur, `${tf} is not blurred for a free visitor`).toMatch(/blur\(/);
      /* The colour half, and the one the owner called out. A blur with red or
         green underneath still leaks the direction. */
      expect(rows[tf].colour,
        `${tf} is blurred but still carries a directional colour (${rows[tf].colour}) - ` +
        `the value is hidden and the signal is not`)
        .not.toMatch(/rgb\(52, 211, 153\)|rgb\(248, 113, 113\)/);
    }
  });

  test('CONTROL: the ungated timeframes are NOT blurred for a free visitor', async ({ page }) => {
    /* Stops "blur everything" passing the test above. */
    const rows = await multiTf(page, false);
    for (const tf of OPEN) {
      expect(rows[tf], `no ${tf} row found`).toBeDefined();
      expect(rows[tf].blur, `${tf} is blurred for a free visitor and should not be`).toBe('none');
    }
  });

  test('CONTROL: a PRO account sees the gated timeframes sharp AND coloured', async ({ browser }) => {
    /* THE HALF DEV COULD NOT RUN. Without it, hiding the feature from everyone
       passes both tests above. */
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    try {
      await pinBullish(page);
      const rows = await multiTf(page, true);
      for (const tf of GATED) {
        expect(rows[tf], `no ${tf} row found`).toBeDefined();
        expect(rows[tf].blur,
          `${tf} is blurred for a PRO account - the gate is hiding the feature from everyone, ` +
          `which passes every free-account assertion and delivers nothing`).toBe('none');

        /* THE COLOUR MUST COME BACK TOO. Dev caught that a blur-only control
           passes a build that unblurs for Pro while leaving the bias forced to
           neutral - two separate lines in their implementation, so one can be
           touched without the other. The colour is the half the owner was
           specific about, so it is the worse one to lose silently.

           Sound only because the input is pinned above: both rows are fed a
           definitively bullish reading, so grey here means the bias was
           stripped rather than the market being quiet. */
        expect(rows[tf].colour,
          `${tf} is unblurred for Pro but renders the neutral grey on a pinned BULLISH input - ` +
          `the bias is being stripped when it should not be, which is half the feature missing`)
          .not.toBe(NEUTRAL_GREY);
      }
    } finally { await ctx.close(); }
  });
});
