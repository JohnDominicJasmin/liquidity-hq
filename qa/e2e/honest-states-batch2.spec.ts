/* Batch 2 (2026-11-14), signed out, nothing written or billed. Market reads stubbed: Bybit answers BTC, ETH (change exactly 0) and SOL; Binance refused, so every other coin has no quote.
 *   F1  #2262  /dashboard: a coin with no quote shows no "+0.00%" and no arrow beside "No data"; ETH with a REAL 0 change still shows "+0.00%" (the control)
 *   F2  #2263  /dashboard with /api/cmc refused: BTC.D and ALT say an ellipsis or a word, never a bare dash
 *   F3  #2264  /dashboard at 1280 and 390 in ru, ko, zh: the market-read tile values and notes wrap (no ellipsis, nothing cut), page not wider than the viewport
 * A cell that finds nothing to measure fails. /markets rows wait for the exchange socket, which a CI runner cannot reach, so the /markets half of #2262 is NOT covered here. */
import { test, expect, type Browser } from '@playwright/test';
import { gotoGuarded } from './_shared';

const BN = /\/api\/proxy\?.*type=(binance-24hr|binance-futures-24hr|premium-index)/;
const bybit = JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [['BTCUSDT', '69000', '0.01'], ['ETHUSDT', '3500', '0'], ['SOLUSDT', '150.5', '-0.015']].map(([symbol, last, pct]) => ({ symbol, lastPrice: last, price24hPcnt: pct, markPrice: last, indexPrice: last, openInterestValue: '5000000', openInterest: '100000', fundingRate: '0.0001', turnover24h: '90000000', volume24h: '2000000', nextFundingTime: '0' })) } });
const open = async (browser: Browser, path: string, width: number, loc = 'en', refuseCmc = false) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
  await ctx.route(BN, r => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' }));
  await ctx.routeWebSocket(/binance\.com/, ws => { ws.close(); });
  await ctx.route(/\/api\/proxy\?.*type=bybit-tickers/, r => r.fulfill({ status: 200, contentType: 'application/json', body: bybit }));
  if (refuseCmc) await ctx.route(/\/api\/cmc/, r => r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"down"}' }));
  const page = await ctx.newPage(); await gotoGuarded(page, path); await page.waitForTimeout(14_000);
  return { ctx, page };
};

test.describe('batch 2 2026-11-14', () => {
  test.describe.configure({ timeout: 150_000 });

  test('F1. #2262 no quote -> no +0.00% and no arrow; a real 0 still shows', async ({ browser }) => {
    const { ctx, page } = await open(browser, '/dashboard', 1280);
    try {
      const m = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('body *')).filter(e => { const t = (e as HTMLElement).innerText || ''; const r = e.getBoundingClientRect(); return e.children.length >= 2 && e.children.length <= 8 && t.length < 90 && r.height > 20 && r.height < 70 && /\b[A-Z]{2,6}\b/.test(t); }) as HTMLElement[];
        const noQuote = rows.filter(r => /No data/.test(r.innerText)).map(r => (r.innerText || '').replace(/\s+/g, ' ').trim());
        const zeroOnNoData = noQuote.filter(t => /[+\-]?0\.00%|[▲▼]/.test(t));
        const eth = rows.map(r => (r.innerText || '').replace(/\s+/g, ' ').trim()).filter(t => /^\W*ETH\b/.test(t));
        return { noQuote: noQuote.slice(0, 6), noQuoteN: noQuote.length, zeroOnNoData: zeroOnNoData.slice(0, 6), eth: eth.slice(0, 3) };
      });
      console.log(`[F1] ${JSON.stringify(m)}`);
      expect(m.noQuoteN, 'no row says No data: nothing measured').toBeGreaterThan(0);
      expect(m.zeroOnNoData, 'a coin with no quote shows a +0.00% or an arrow').toEqual([]);
      expect(m.eth.join(' | '), 'ETH (real 0 change) no longer shows +0.00%').toMatch(/0\.00%/);
    } finally { await ctx.close(); }
  });

  test('F2. #2263 BTC.D and ALT: an ellipsis or a word with /api/cmc refused, never a bare dash', async ({ browser }) => {
    const { ctx, page } = await open(browser, '/dashboard', 1280, 'en', true);
    try {
      const m = await page.evaluate(() => ['BTC.D', 'ALT'].map(label => {
        const el = Array.from(document.querySelectorAll('body *')).find(e => e.children.length === 0 && (e.textContent || '').trim() === label) as HTMLElement | undefined;
        const box = el?.parentElement as HTMLElement | null | undefined;
        return { label, text: box ? (box.innerText || '').replace(/\s+/g, ' ').trim() : null };
      }));
      console.log(`[F2] ${JSON.stringify(m)}`);
      for (const c of m) {
        expect(c.text, `${c.label} cell not found`).not.toBeNull();
        const rest = c.text!.replace(c.label, '').trim();
        expect(rest, `${c.label} shows a bare dash or nothing`).not.toMatch(/^[-–—]?$/);
      }
    } finally { await ctx.close(); }
  });

  for (const loc of ['ru', 'ko', 'zh']) for (const width of [1280, 390]) {
    test(`F3. #2264 market-read tiles wrap in ${loc} at ${width}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, '/dashboard', width, loc);
      try {
        const m = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('.mr-factor-v, .mr-factor-s')) as HTMLElement[];
          const info = els.map(e => { const cs = getComputedStyle(e); return { t: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), ws: cs.whiteSpace, ell: cs.textOverflow, cut: e.scrollWidth > e.clientWidth + 1 }; });
          return { n: els.length, bad: info.filter(i => i.ws === 'nowrap' || i.ell === 'ellipsis' || i.cut), docSw: document.documentElement.scrollWidth, vw: window.innerWidth };
        });
        console.log(`[F3] ${loc} ${width} ${JSON.stringify(m)}`);
        expect(m.n, 'no market-read tile values found: nothing measured').toBeGreaterThan(0);
        expect(m.bad, 'tile values that do not wrap or are cut off').toEqual([]);
        expect(m.docSw, 'page scrolls sideways').toBeLessThanOrEqual(m.vw);
      } finally { await ctx.close(); }
    });
  }
});
