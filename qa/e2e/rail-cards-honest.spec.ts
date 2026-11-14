/* #2285: the /arena rail cards (VWAP, Open Interest, Funding Rate; components/CoinMarketSnapshot.tsx) never show a bare "-".
 * Signed out, nothing written or billed. Binance refused, Bybit answers BTC, ETH and SOL only, the Bybit recent-trade and open-interest reads for HYPE answer nothing,
 * so HYPE (a universe coin with no core-50 snapshot) has no VWAP, no funding rate and no 1h OI reading.
 *   R1  HYPE at 1280 and 390: none of the three cards has the bare value "-"; VWAP and Funding read an ellipsis or "Unavailable"; no card note repeats the word "Unavailable" when the VALUE already says it
 *   R2  BTC (control) at 1280 and 390: the cards show real values (VWAP a $ figure) and none says "Unavailable"
 *   S   shots of /arena at 1280 and 390, light and dark, HYPE and BTC (qa/.shots/rail-*.png)
 * A cell that finds no cards fails. Every card found is printed. */
import { test, expect, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';

mkdirSync('qa/.shots', { recursive: true });
const BN = /\/api\/proxy\?.*type=(binance-24hr|binance-futures-24hr|premium-index)/;
const bybit = JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [['BTCUSDT', '69000', '0.01'], ['ETHUSDT', '3500', '0.012'], ['SOLUSDT', '150.5', '-0.015']].map(([symbol, last, pct]) => ({ symbol, lastPrice: last, price24hPcnt: pct, markPrice: last, indexPrice: last, openInterestValue: '5000000', openInterest: '100000', fundingRate: '0.0001', turnover24h: '90000000', volume24h: '2000000', nextFundingTime: '0' })) } });
async function open(browser: Browser, coin: string, width: number, theme: 'dark' | 'light' = 'dark') {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
  await ctx.route(BN, r => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' }));
  await ctx.routeWebSocket(/binance\.com/, () => { /* accept and stay silent */ });
  await ctx.route(/\/api\/proxy\?.*type=bybit-tickers/, r => r.fulfill({ status: 200, contentType: 'application/json', body: bybit }));
  if (coin === 'hype') await ctx.route(/\/api\/proxy\?.*type=(recent-trade|open-interest)/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [] } }) }));
  const page = await ctx.newPage(); await gotoGuarded(page, `/arena?coin=${coin}&tf=1h`); await page.waitForTimeout(25_000);
  return { ctx, page };
}
const cardsOf = (page: import('@playwright/test').Page) => page.evaluate(() => Array.from(document.querySelectorAll('.edge-card')).map(c => ({ label: ((c.querySelector('.edge-card-label') as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim(), value: ((c.querySelector('.edge-card-value') as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim(), note: ((c.querySelector('.edge-card-signal') as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim() })));

test.describe('#2285 rail cards honest states', () => {
  test.describe.configure({ timeout: 150_000 });
  for (const width of [1280, 390]) {
    test(`R1. HYPE at ${width}: no bare dash in VWAP, Open Interest or Funding; no duplicated Unavailable`, async ({ browser }) => {
      const { ctx, page } = await open(browser, 'hype', width);
      try {
        const cards = await cardsOf(page); console.log(`[R1] ${width} ${JSON.stringify(cards)}`);
        const rail = cards.filter(c => /vwap|open interest|funding/i.test(c.label));
        expect(rail.length, 'no VWAP / Open Interest / Funding card found: nothing measured').toBe(3);
        expect(rail.filter(c => /^[-–—]$/.test(c.value)).map(c => c.label), 'a rail card shows a bare dash').toEqual([]);
        expect(rail.filter(c => /unavailable/i.test(c.value) && /unavailable/i.test(c.note)).map(c => c.label), 'a card says Unavailable in its value AND its note').toEqual([]);
        const vwap = rail.find(c => /vwap/i.test(c.label))!; expect(vwap.value, 'HYPE has no VWAP: the value must be an ellipsis or the word').toMatch(/^(…|\.\.\.|Unavailable)$/);
      } finally { await ctx.close(); }
    });
    test(`R2. BTC at ${width}: the cards show real values, none says Unavailable`, async ({ browser }) => {
      const { ctx, page } = await open(browser, 'btc', width);
      try {
        const cards = await cardsOf(page); console.log(`[R2] ${width} ${JSON.stringify(cards)}`);
        const rail = cards.filter(c => /vwap|open interest|funding/i.test(c.label));
        expect(rail.length, 'no rail cards for BTC: nothing measured').toBe(3);
        expect(rail.find(c => /vwap/i.test(c.label))!.value, 'BTC VWAP is a $ figure').toMatch(/^\$[\d,]+/);
        expect(rail.filter(c => /unavailable/i.test(c.value)).map(c => c.label), 'a BTC rail card says Unavailable').toEqual([]);
      } finally { await ctx.close(); }
    });
  }
});

test.describe('#2285 shots', () => {
  test.describe.configure({ timeout: 150_000 });
  for (const coin of ['hype', 'btc']) for (const width of [1280, 390]) for (const th of ['dark', 'light'] as const) {
    test(`S. /arena ${coin} ${width} ${th}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, coin, width, th);
      try { await page.screenshot({ path: `qa/.shots/rail-${coin}-${width}-${th}.png`, fullPage: true }); } finally { await ctx.close(); }
    });
  }
});
