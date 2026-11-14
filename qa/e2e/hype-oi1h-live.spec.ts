/* #2275 (#1651): after the Bybit OI 1h span check, a Bybit-only coin (HYPE) must still show an OI 1h VALUE in a healthy market - the regression the PR names:
 * if the card goes to "Not enough history yet" on a healthy HYPE, the Bybit timestamps are not arriving.
 * Meant for the DEPLOYED qa build (set base_url): a CI runner cannot reach Bybit, the deployed service can. Signed out, reads only.
 * The card is the coin snapshot's Open Interest edge-card on /arena (components/CoinMarketSnapshot.tsx): value "+1.23%" or "-", note "... · 1h" or "Not enough history yet".
 *   H1  control: BTC (Binance) shows a percentage in its Open Interest card
 *   H2  HYPE shows a percentage and not the short-window note
 * If the control shows neither, the cell reports "nothing measured" instead of blaming the PR. Every edge-card found is printed. */
import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';

test.describe('#2275 HYPE OI 1h on a live build', () => {
  test.describe.configure({ timeout: 150_000 });
  test.use({ viewport: { width: 1440, height: 1000 } });
  for (const coin of ['btc', 'hype']) {
    test(`${coin === 'btc' ? 'H1 control' : 'H2'}. /arena?coin=${coin}: the Open Interest card shows a figure`, async ({ page }) => {
      await gotoGuarded(page, `/arena?coin=${coin}&tf=1h`); await page.waitForTimeout(30_000);
      const cards = await page.evaluate(() => Array.from(document.querySelectorAll('.edge-card')).map(c => ({ label: ((c.querySelector('.edge-card-label') as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim(), value: ((c.querySelector('.edge-card-value') as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim(), note: ((c.querySelector('.edge-card-signal') as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim() })));
      console.log(`[OI1h] ${coin} cards=${JSON.stringify(cards)}`);
      const oi = cards.find(c => /open interest|oi\b/i.test(c.label) && /1h|hour|1ч/i.test(c.label + ' ' + c.note)) ?? cards.find(c => /Not enough history|· 1h/i.test(c.note));
      expect(oi, `no Open Interest 1h card found on /arena for ${coin}: nothing measured`).toBeTruthy();
      expect(oi!.note, `${coin}: OI 1h reads "Not enough history yet" on a healthy market`).not.toMatch(/Not enough history/i);
      expect(oi!.value, `${coin}: OI 1h shows no percentage (value "${oi!.value}")`).toMatch(/[-+]?\d+(\.\d+)?\s?%/);
    });
  }
});
