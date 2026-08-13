import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

/* When perps vs spot CANNOT be measured, does Arena SAY so? (#340)
 *
 * `lib/perpSpot.ts` deliberately returns a neutral multiplier for `unknown`:
 *
 *     `unknown` returns 1 and the CALLER must say the input is missing. It does
 *     not silently discount, because a quietly-lowered number is its own
 *     misstatement - the user sees a reduced figure and reasonably assumes the
 *     evidence was weighed and found wanting, when it was never available.
 *
 * That reasoning is right, and better than the "lower it anyway" position I
 * argued for on #340. It also means the entire guarantee now rests on the
 * second half of the sentence: **the caller must say the input is missing.**
 *
 * WHICH IS A COMMENT DESCRIBING AN INVARIANT - the exact construct qa/STATUS.md
 * records as the thing that goes stale, three separate times on 2026-08-12,
 * each correct when written. The unit tests pin `perpConfidenceMultiplier
 * ('unknown') === 1`; nothing pins that anyone TELLS the user why.
 *
 * If the disclosure is missing, the failure is silent and total: the score and
 * the confidence read exactly as they would on a coin that was measured and
 * found normal. There is no visible difference between "checked, nothing
 * unusual" and "never checked" - which is the failure this whole feature was
 * commissioned to prevent, reappearing inside its own implementation.
 */

const KLINES = '**/api/market/klines**';
const HOUR = 3_600_000;

const bar = (t: number, v: number) =>
  [t, '60000', '60500', '59500', '60000', '100', t + HOUR - 1, String(v), 1000, '50', String(v / 2), '0'];

/** Perp side only. No spot pair -> computePerpSpot returns lean 'unknown'. */
function perpOnly() {
  const f = Math.floor(Date.now() / HOUR) * HOUR;
  const p: unknown[][] = [];
  for (let i = 167; i >= 1; i--) p.push(bar(f - i * HOUR, 100_000_000));
  p.push(bar(f, 3_000_000));
  return p;
}

test.describe('an unmeasurable perps reading is disclosed, not absorbed', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('Arena says the perps input could not be checked', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      const perp = perpOnly();
      await page.route(KLINES, async route => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('interval') !== '1h' || url.searchParams.get('limit') !== '168') {
          return route.continue();
        }
        if (url.searchParams.get('source') === 'binance-futures') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(perp) });
        }
        /* No Binance spot pair for this coin - the real-world case, and the one
           the whole `unknown` path exists for. */
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no such symbol"}' });
      });

      await gotoSignedIn(page, '/arena');
      await page.waitForTimeout(25_000);

      const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

      /* POSITIVE CONTROL. Every assertion here is about text being PRESENT, but
         a signed-out or half-rendered page would fail them for the wrong
         reason - so prove the Pro surface actually rendered first. */
      expect(body, 'the Pro surfaces did not render - this run measured nothing')
        .not.toMatch(/part of Pro|Unlock with Pro/i);

      expect(body,
        `perps vs spot could not be measured for this coin, and NOTHING on Arena says so. ` +
        `The confidence multiplier is 1 and the score penalty is 0 by design - which is ` +
        `correct only if the surface discloses it. Without that, an unmeasured coin reads ` +
        `exactly like one that was checked and found normal, and the user cannot tell them ` +
        `apart. lib/perpSpot.ts says "the CALLER must say the input is missing"; this is the ` +
        `check for that sentence.`)
        .toMatch(/cannot measure|could not be measured|not measurable|unavailable/i);
    } finally { await ctx.close(); }
  });
  test('CONTROL: a MEASURABLE coin does not show that wording', async ({ browser }) => {
    /* THE TEST ABOVE IS WORTH NOTHING WITHOUT THIS.
     *
     * The matcher is broad - /cannot measure|could not be measured|not
     * measurable|unavailable/ - and Arena has other text that can satisfy it.
     * `10Y real yield unavailable - cannot check the rates backdrop` is on the
     * same page whenever FRED is quiet, and it would make the assertion above
     * pass on a build with no perps disclosure at all.
     *
     * So: serve BOTH sides, making the reading measurable, and require the
     * wording to be absent. If it is present here too, the test above is
     * matching something else and proves nothing. */
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      const f = Math.floor(Date.now() / HOUR) * HOUR;
      const spot: unknown[][] = [], perp: unknown[][] = [];
      for (let i = 167; i >= 1; i--) {
        const t = f - i * HOUR;
        spot.push(bar(t, 10_000_000));
        perp.push(bar(t, 100_000_000));
      }
      spot.push(bar(f, 300_000)); perp.push(bar(f, 3_000_000));

      await page.route(KLINES, async route => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('interval') !== '1h' || url.searchParams.get('limit') !== '168') {
          return route.continue();
        }
        const futures = url.searchParams.get('source') === 'binance-futures';
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify(futures ? perp : spot),
        });
      });

      await gotoSignedIn(page, '/arena');
      await page.waitForTimeout(25_000);
      const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      expect(body, 'the Pro surfaces did not render - this control measured nothing')
        .not.toMatch(/part of Pro|Unlock with Pro/i);

      const hit = /cannot measure|could not be measured|not measurable/i.exec(body);
      expect(hit,
        `the unmeasurable wording is on the page even though perps IS measurable here ` +
        `(matched: "${hit?.[0]}"). The test above is matching something other than the perps ` +
        `disclosure, so it does not prove what it claims.`)
        .toBeNull();
    } finally { await ctx.close(); }
  });
});
