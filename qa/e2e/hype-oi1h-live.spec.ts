/* #2275 (#1651): after the Bybit OI 1h span check, a Bybit-only coin (HYPE) must still show an OI 1h VALUE in a healthy market - the regression the PR names:
 * if the card goes to "Not enough history yet" on a healthy HYPE, the Bybit timestamps are not arriving.
 * Meant for the DEPLOYED qa build (set base_url): a CI runner cannot reach Bybit, the deployed service can. Signed out, reads only.
 * The coin snapshot prints the figure as "... · +1.2% 1h" (COIN_MARKET_SNAPSHOT_OI_1H_PCT_SUFFIX) or "Not enough history yet" (..._SHORT_WINDOW).
 *   H1  control: BTC (Binance) shows a "% 1h" figure, so the card renders and the page text carries it
 *   H2  HYPE shows a "% 1h" figure and not the short-window wording
 * If the control itself shows neither, the cell reports "nothing measured" instead of blaming the PR. */
import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';

test.describe('#2275 HYPE OI 1h on a live build', () => {
  test.describe.configure({ timeout: 150_000 });
  test.use({ viewport: { width: 1440, height: 1000 } });
  for (const coin of ['btc', 'hype']) {
    test(`${coin === 'btc' ? 'H1 control' : 'H2'}. /arena?coin=${coin}: OI 1h shows a figure`, async ({ page }) => {
      await gotoGuarded(page, `/arena?coin=${coin}&tf=1h`); await page.waitForTimeout(25_000);
      const t = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
      const fig = /([-+]?\d+(?:\.\d+)?%)\s*1h\b/.exec(t); const shortWin = /Not enough history yet/i.test(t);
      console.log(`[OI1h] ${coin} figure=${JSON.stringify(fig && fig[0])} shortWindow=${shortWin}`);
      expect(fig !== null || shortWin, `no OI 1h figure and no short-window text for ${coin}: nothing measured`).toBe(true);
      expect(shortWin && fig === null, `${coin}: OI 1h reads "Not enough history yet" on a healthy market`).toBe(false);
      expect(fig, `${coin}: OI 1h shows no percentage`).not.toBeNull();
    });
  }
});
