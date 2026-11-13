/* #2275 (#1651): after the Bybit OI 1h span check, a Bybit-only coin (HYPE) must still show an OI 1h VALUE in a healthy market - the regression the PR names:
 * if the card goes to "Not enough history yet" on a healthy HYPE, the Bybit timestamps are not arriving.
 * Meant for the DEPLOYED qa build (set base_url): a CI runner cannot reach Bybit, the deployed service can. Signed out, reads only.
 *   H1  /arena?coin=btc is the control: BTC (Binance) shows an OI 1h figure, so the card renders at all
 *   H2  /arena?coin=hype shows an OI 1h figure (a percentage), not the "not enough history" wording and not a dash
 * If the control itself shows no figure the cell reports "nothing measured" instead of blaming the PR. */
import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';

const oiBlock = (page: Page) => page.evaluate(() => {
  const t = (document.body.innerText || '').replace(/\s+/g, ' ');
  const i = t.search(/OI\s*(%|1h|1H)/i); return { around: i >= 0 ? t.slice(Math.max(0, i - 20), i + 140) : null, all: /Not enough history/i.test(t) };
});

test.describe('#2275 HYPE OI 1h on a live build', () => {
  test.describe.configure({ timeout: 150_000 });
  for (const coin of ['btc', 'hype']) {
    test(`${coin === 'btc' ? 'H1 control' : 'H2'}. /arena?coin=${coin}: OI 1h shows a figure`, async ({ page }) => {
      await gotoGuarded(page, `/arena?coin=${coin}&tf=1h`); await page.waitForTimeout(25_000);
      const b = await oiBlock(page); console.log(`[OI1h] ${coin} ${JSON.stringify(b)}`);
      expect(b.around, `no OI 1h element found for ${coin}: nothing measured`).not.toBeNull();
      expect(b.around!, `${coin}: OI 1h reads "not enough history" on a healthy market`).not.toMatch(/Not enough history/i);
      expect(b.around!, `${coin}: OI 1h shows no percentage`).toMatch(/[-+]?\d+(\.\d+)?\s?%/);
    });
  }
});
