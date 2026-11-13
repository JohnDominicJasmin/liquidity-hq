/* #2252 (#1185): /ko /zh /ru landing: the START button, the live-read card and the cookie bar are in the visitor's language, and nothing clips or pushes the page sideways at 390.
 *   G1  /ko /zh /ru at 390 and 1280: the header, the hero and its live-read card (everything above y=900) and the cookie bar contain none of the English words the card used to show
 *   G2  /ru at 390: no element in the hero or the cookie bar is past the viewport or clipped in its own box (the ticker row scrolls by design and is excluded); docSw = 390
 *   G3  /: the English page still says Live read, Accept and Decline (unchanged)
 *   S   shots of /ru at 390/768/1280 light and dark, /ko and /zh at 390 (qa/.shots/loc-*.png)
 * Signed out, nothing written, the market reads are stubbed so the card has a stable state. */
import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';

mkdirSync('qa/.shots', { recursive: true });
const BN = /\/api\/proxy\?.*type=(binance-24hr|binance-futures-24hr|premium-index)/;
const bybit = JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [['BTCUSDT', '69000', '0.01'], ['ETHUSDT', '3500', '0.012'], ['SOLUSDT', '150.5', '-0.015']].map(([symbol, last, pct]) => ({ symbol, lastPrice: last, price24hPcnt: pct, markPrice: last, indexPrice: last, openInterestValue: '5000000', openInterest: '100000', fundingRate: '0.0001', turnover24h: '90000000', volume24h: '2000000', nextFundingTime: '0' })) } });
async function setup(ctx: BrowserContext) {
  await ctx.route(BN, r => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' }));
  await ctx.routeWebSocket(/binance\.com/, ws => { ws.close(); });
  await ctx.route(/\/api\/proxy\?.*type=bybit-tickers/, r => r.fulfill({ status: 200, contentType: 'application/json', body: bybit }));
  await ctx.route(/\/api\/coinbase-price/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ price: 69010, usdtUsd: 1 }) }));
}
/** English words the card, the START button and the cookie bar showed before #2252, as whole words. */
const ENGLISH = /\b(Live read|BULLISH|BEARISH|NO READ|Entry|Target|Above|Below|Balanced|Heavily|Accept|Decline|Privacy Policy|We use analytics|signals|START)\b/;
const regionText = (page: Page) => page.evaluate(() => {
  const leaves = Array.from(document.querySelectorAll('body *')).filter(e => e.children.length === 0 && (e.textContent || '').trim() && !e.closest('.lpt-ticker') && !e.closest('#nav-drawer'));
  const top = leaves.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.top + window.scrollY) < 900; }).map(e => (e.textContent || '').trim());
  const bar = document.querySelector('.consent-bar') as HTMLElement | null;
  return { hero: top.join(' | '), bar: bar ? bar.innerText.replace(/\s+/g, ' ').trim() : null };
});
const open = async (browser: Browser, loc: string, width: number, theme: 'dark' | 'light' = 'dark') => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.removeItem('lhq_analytics_consent_v1'); } catch { /* private */ } }, theme);
  await setup(ctx); const page = await ctx.newPage(); await gotoGuarded(page, loc === 'en' ? '/' : '/' + loc); await page.waitForTimeout(14_000);
  return { ctx, page };
};

test.describe('#2252 localized landing', () => {
  test.describe.configure({ timeout: 150_000 });
  for (const loc of ['ko', 'zh', 'ru']) for (const width of [390, 1280]) {
    test(`G1. /${loc} at ${width}: no English left in the hero card, START or the cookie bar`, async ({ browser }) => {
      const { ctx, page } = await open(browser, loc, width);
      try {
        const r = await regionText(page); console.log(`[G1] ${loc} ${width} bar=${JSON.stringify(r.bar)} hero=${JSON.stringify(r.hero).slice(0, 700)}`);
        expect(r.bar, 'no cookie bar on the page').not.toBeNull();
        const hit = (r.hero + ' ' + r.bar).match(ENGLISH); expect(hit, `English left on /${loc} at ${width}: "${hit?.[0]}"`).toBeNull();
      } finally { await ctx.close(); }
    });
  }
  test('G2. /ru at 390: nothing in the hero or cookie bar overflows its box or the viewport', async ({ browser }) => {
    const { ctx, page } = await open(browser, 'ru', 390);
    try {
      const m = await page.evaluate(() => {
        const vw = window.innerWidth;
        const els = Array.from(document.querySelectorAll('.lpt-root *, .consent-bar, .consent-bar *')).filter(e => !e.closest('.lpt-ticker') && !e.closest('#nav-drawer'));
        const bad = els.map(e => { const r = e.getBoundingClientRect(); const h = e as HTMLElement; return { e, r, over: h.scrollWidth > h.clientWidth + 1 && getComputedStyle(h).overflowX !== 'visible' }; })
          .filter(x => x.r.width > 0 && (x.r.right > vw + 1 || x.over) && (x.r.top + window.scrollY) < 1400)
          .map(x => ({ el: x.e.tagName.toLowerCase() + '.' + String((x.e as HTMLElement).className).slice(0, 30), right: Math.round(x.r.right), text: (x.e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), over: x.over }));
        return { docSw: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 8) };
      });
      console.log('[G2] ' + JSON.stringify(m));
      expect(m.docSw, 'page scrolls sideways').toBeLessThanOrEqual(m.vw);
      expect(m.bad, 'elements past the viewport or clipped in their own box').toEqual([]);
    } finally { await ctx.close(); }
  });
  test('G3. the English landing is unchanged', async ({ browser }) => {
    const { ctx, page } = await open(browser, 'en', 1280);
    try { const r = await regionText(page); console.log(`[G3] bar=${JSON.stringify(r.bar)}`); expect(r.hero).toMatch(/Live read/i); expect(r.bar ?? '').toMatch(/Accept/); expect(r.bar ?? '').toMatch(/Decline/); } finally { await ctx.close(); }
  });
});

test.describe('#2252 shots', () => {
  test.describe.configure({ timeout: 150_000 });
  const S: Array<[string, number, 'dark' | 'light']> = [];
  for (const t of ['dark', 'light'] as const) for (const w of [390, 768, 1280]) S.push(['ru', w, t]);
  S.push(['ko', 390, 'dark'], ['zh', 390, 'dark']);
  for (const [loc, w, t] of S) {
    test(`S. /${loc} at ${w} ${t}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, loc, w, t);
      try { await page.screenshot({ path: `qa/.shots/loc-${loc}-${w}-${t}.png` }); } finally { await ctx.close(); }
    });
  }
});
