/* The 2026-11-14 dashboard / funding / picker batch, one spec, signed out, nothing written or billed. Market reads are stubbed (Bybit answers BTC, ETH and SOL only; Binance refused),
 * so every other coin has no quote and the "missing reading" states are reachable.
 *   E1  #2255  /dashboard at 390 in en and ru: every .edge-card-signal wraps (white-space normal), none is cut off, and the values of cards in one row sit level
 *   E2  #2256  /dashboard with Binance refused: no bare dash is the whole text of any card value or note; the OI 1h and coin-price cells say a word or an ellipsis
 *   E3  #2261  /funding at 390 with Binance refused: no table cell is a bare dash; coins with no rate say the narrow word once; page 390 wide
 *   E4  #2260  /ru: the landing picker reads Русский (RU at 390) and offers English, 한국어, 中文, Русский; /, /ko, /zh read English, 한국어, 中文
 * A cell that finds nothing to measure fails (it never passes silently). */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { gotoGuarded } from './_shared';

const BN = /\/api\/proxy\?.*type=(binance-24hr|binance-futures-24hr|premium-index)/;
const bybit = JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: 'linear', list: [['BTCUSDT', '69000', '0.01'], ['ETHUSDT', '3500', '0.012'], ['SOLUSDT', '150.5', '-0.015']].map(([symbol, last, pct]) => ({ symbol, lastPrice: last, price24hPcnt: pct, markPrice: last, indexPrice: last, openInterestValue: '5000000', openInterest: '100000', fundingRate: '0.0001', turnover24h: '90000000', volume24h: '2000000', nextFundingTime: '0' })) } });
const open = async (browser: Browser, path: string, width: number, loc = 'en') => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
  await ctx.route(BN, r => r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' }));
  await ctx.routeWebSocket(/binance\.com/, ws => { ws.close(); });
  await ctx.route(/\/api\/proxy\?.*type=bybit-tickers/, r => r.fulfill({ status: 200, contentType: 'application/json', body: bybit }));
  const page = await ctx.newPage(); await gotoGuarded(page, path); await page.waitForTimeout(14_000);
  return { ctx, page };
};
const dashes = (page: Page, scope: string) => page.evaluate((sel) => Array.from(document.querySelectorAll(sel + ' *')).filter(e => e.children.length === 0 && /^[-–—]$/.test((e.textContent || '').trim()))
  .map(e => { const p = e.parentElement; return { cls: String((e as HTMLElement).className).slice(0, 30), parent: ((p?.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 50) }; }), scope);

test.describe('batch 2026-11-14', () => {
  test.describe.configure({ timeout: 150_000 });

  for (const loc of ['en', 'ru']) {
    test(`E1. #2255 /dashboard at 390 in ${loc}: card notes wrap and are not cut off, values level`, async ({ browser }) => {
      const { ctx, page } = await open(browser, '/dashboard', 390, loc);
      try {
        const m = await page.evaluate(() => {
          const sig = Array.from(document.querySelectorAll('.edge-card-signal')) as HTMLElement[];
          const info = sig.map(e => { const cs = getComputedStyle(e); return { text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), ws: cs.whiteSpace, ell: cs.textOverflow, cut: e.scrollWidth > e.clientWidth + 1 }; });
          const cards = Array.from(document.querySelectorAll('.edge-card')) as HTMLElement[];
          const rows = new Map<number, number[]>(); for (const c of cards) { const v = c.querySelector('.edge-card-value') as HTMLElement | null; if (!v) continue; const top = Math.round(c.getBoundingClientRect().top); const arr = rows.get(top) ?? []; arr.push(Math.round(v.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom)); rows.set(top, arr); }
          const geo = cards.map(c => { const v = c.querySelector('.edge-card-value') as HTMLElement | null; const g = c.querySelector('.edge-card-signal') as HTMLElement | null; const r = c.getBoundingClientRect(); const vr = v?.getBoundingClientRect(); const gr = g?.getBoundingClientRect(); return { title: (c.querySelector('.edge-card-label')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22), top: Math.round(r.top), h: Math.round(r.height), vTop: vr ? Math.round(vr.top - r.top) : null, vBot: vr ? Math.round(r.bottom - vr.bottom) : null, sTop: gr ? Math.round(gr.top - r.top) : null, sH: gr ? Math.round(gr.height) : null }; });
          return { geo, n: sig.length, bad: info.filter(i => i.ws === 'nowrap' || i.cut), sample: info.slice(0, 4), unlevel: Array.from(rows.values()).filter(a => a.length > 1 && Math.max(...a) - Math.min(...a) > 1), docSw: document.documentElement.scrollWidth };
        });
        console.log(`[E1] ${loc} ${JSON.stringify(m)}`);
        expect(m.n, 'no .edge-card-signal found: nothing measured').toBeGreaterThan(0);
        expect(m.bad, 'notes that do not wrap or are cut off').toEqual([]);
        expect(m.unlevel, 'cards in one row have values at different heights').toEqual([]);
        expect(m.docSw, 'page scrolls sideways').toBeLessThanOrEqual(390);
      } finally { await ctx.close(); }
    });
  }

  test('E2. #2256 /dashboard with Binance refused: no bare dash in the cards or notes', async ({ browser }) => {
    const { ctx, page } = await open(browser, '/dashboard', 390);
    try {
      const d = await dashes(page, '.edge-card'); const all = await dashes(page, 'main, body');
      const text = (await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ')));
      console.log(`[E2] dashes in .edge-card=${JSON.stringify(d)} dashes anywhere=${all.length} sample=${JSON.stringify(all.slice(0, 10))} noData=${(text.match(/No data/g) || []).length} unavailable=${(text.match(/Unavailable/g) || []).length}`);
      expect(await page.locator('.edge-card').count(), 'no cards on the page: nothing measured').toBeGreaterThan(0);
      expect(d, 'a card shows a bare dash').toEqual([]);
      expect(text, 'no missing-reading word anywhere, so the stubbed refusal did not reach the page').toMatch(/No data|Unavailable/);
    } finally { await ctx.close(); }
  });

  test('E3. #2261 /funding at 390 with Binance refused: no bare dash cell, the narrow word once, page 390 wide', async ({ browser }) => {
    const { ctx, page } = await open(browser, '/funding', 390);
    try {
      const m = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('table.frh-table tbody td')) as HTMLElement[];
        const dash = cells.filter(c => /^[-–—]$/.test((c.innerText || '').trim()));
        const rows = Array.from(document.querySelectorAll('table.frh-table tbody tr')) as HTMLElement[];
        const twice = rows.filter(r => ((r.innerText || '').match(/No data/g) || []).length > 1).map(r => (r.innerText || '').replace(/\s+/g, ' ').slice(0, 60));
        const noData = rows.filter(r => /No data/.test(r.innerText || '')).length;
        return { rows: rows.length, cells: cells.length, dash: dash.length, noData, twice: twice.slice(0, 5), docSw: document.documentElement.scrollWidth };
      });
      console.log(`[E3] ${JSON.stringify(m)}`);
      expect(m.rows, 'no table rows: nothing measured').toBeGreaterThan(0);
      expect(m.dash, 'bare dash cells in the table').toBe(0);
      expect(m.twice, 'a row says "No data" more than once').toEqual([]);
      expect(m.docSw, 'page scrolls sideways').toBeLessThanOrEqual(390);
    } finally { await ctx.close(); }
  });

  const PICKER: Array<[string, number, string]> = [['/ru', 1280, 'Русский'], ['/ru', 390, 'RU'], ['/', 1280, 'English'], ['/ko', 1280, '한국어'], ['/zh', 1280, '中文']];
  for (const [path, width, label] of PICKER) {
    test(`E4. #2260 ${path} at ${width}: the picker reads ${label}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, path, width);
      try {
        const head = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(e => e.children.length === 0 && (e.getBoundingClientRect().top + window.scrollY) < 80 && (e.textContent || '').trim()).map(e => (e.textContent || '').trim()));
        console.log(`[E4] ${path} ${width} header leaves=${JSON.stringify(head)}`);
        expect(head, `the picker does not read ${label}`).toContain(label);
        if (path === '/ru' && width === 1280) {
          await page.getByText('Русский', { exact: true }).first().click(); await page.waitForTimeout(800);
          const hrefs = await page.evaluate(() => ['/', '/ko', '/zh', '/ru'].map(h => ({ h, n: document.querySelectorAll(`a[href="${h}"]`).length })));
          console.log(`[E4] menu links ${JSON.stringify(hrefs)}`);
          for (const x of hrefs) expect(x.n, `the menu has no link to ${x.h}`).toBeGreaterThan(0);
        }
      } finally { await ctx.close(); }
    });
  }
});
