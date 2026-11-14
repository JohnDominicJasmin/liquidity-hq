import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { installMarketFixtures } from './_fixtures';

/* #2186 / #1651: the Arena funding chip falls back to Binance when the Bybit read FAILS.
 *
 * Three cells, in the order that makes the result readable:
 *   F0 control   Bybit answers, Binance premium index carries a sentinel rate. The chip must NOT show the
 *                sentinel: the fallback fires only on a failed read, never over a figure we hold. Without
 *                this, F1 passing could just mean "the chip always shows Binance".
 *   F1           Bybit tickers 500, premium index carries the sentinel. The chip shows the sentinel.
 *   F2           Both 500. The chip stays unknown ("Unavailable" since the honest-states batch; it was a bare "-"), never 0.
 *
 * Fixtures serve the rest of the market deterministically; the two routes under test are registered AFTER
 * installMarketFixtures so they win over it. Nothing is billed, nothing is written. */

const SENTINEL_RATE = '0.00037000';              // 0.037% - no recorded Bybit BTC rate rounds to this
const SENTINEL_CHIP = '+0.0370%';

const isProxy = (u: URL, type: string) => u.pathname === '/api/proxy' && u.searchParams.get('type') === type;

async function arrangeBtc(page: Page, opts: { bybit: 'ok' | '500'; binance: 'sentinel' | '500' }) {
  await installMarketFixtures(page, 'as-recorded', { socket: 'synthetic' });
  const calls = { bybit: 0, binance: 0 };
  if (opts.bybit === '500') {
    await page.route(u => isProxy(u, 'bybit-tickers'), (r) => { calls.bybit++; return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stubbed"}' }); });
  }
  await page.route(u => isProxy(u, 'premium-index'), (r) => {
    calls.binance++;
    if (opts.binance === '500') return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stubbed"}' });
    return r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ symbol: 'BTCUSDT', lastFundingRate: SENTINEL_RATE, markPrice: '70000', nextFundingTime: Date.now() + 3_600_000 }]),
    });
  });
  return calls;
}

/** The funding card's value on /arena (CoinMarketSnapshot): the card whose label mentions funding. */
const fundingValue = async (page: Page) => {
  const card = page.locator('.edge-card').filter({ has: page.locator('.edge-card-label', { hasText: /funding/i }) }).first();
  await card.waitFor({ state: 'visible', timeout: 30_000 });
  return (await card.locator('.edge-card-value').first().innerText()).trim();
};

test.describe('Arena funding chip - Binance fallback (#2186)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('F0 control: Bybit answers, so the chip does not show the Binance sentinel', async ({ page }) => {
    const calls = await arrangeBtc(page, { bybit: 'ok', binance: 'sentinel' });
    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(12_000);
    const v = await fundingValue(page);
    console.log(`[funding F0] chip=${v} premiumIndexCalls=${calls.binance}`);
    expect(v, 'the chip shows the Binance sentinel although Bybit answered - the fallback fires on a healthy read').not.toBe(SENTINEL_CHIP);
  });

  test('F1: Bybit tickers 500 -> BTC funding equals Binance lastFundingRate', async ({ page }) => {
    const calls = await arrangeBtc(page, { bybit: '500', binance: 'sentinel' });
    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(12_000);
    const v = await fundingValue(page);
    console.log(`[funding F1] chip=${v} bybit500Calls=${calls.bybit} premiumIndexCalls=${calls.binance}`);
    expect(calls.bybit, 'the Bybit failure was never served - the page did not request bybit-tickers').toBeGreaterThan(0);
    await expect.poll(async () => fundingValue(page), { timeout: 20_000, message: 'chip never showed the Binance rate' }).toBe(SENTINEL_CHIP);
  });

  test('F2: both venues 500 -> the chip stays unknown, not 0', async ({ page }) => {
    const calls = await arrangeBtc(page, { bybit: '500', binance: '500' });
    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(12_000);
    const v = await fundingValue(page);
    console.log(`[funding F2] chip=${v} bybit500Calls=${calls.bybit} premiumIndexCalls=${calls.binance}`);
    expect(calls.bybit, 'bybit-tickers was never requested').toBeGreaterThan(0);
    expect(v, 'with both venues failing the chip must stay unknown: it says Unavailable, never a number and never 0').toBe('Unavailable');
  });
});
