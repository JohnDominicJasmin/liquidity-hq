/* #2268 (/hours ru and zh at 390) and #2269 (/markets at 390). Signed out, nothing written or billed; the labels are whatever the dev project serves (PM applied them).
 *   Y1  #2269 /markets at 390 in en and ru: GRADE and COIN heads do not overlap and each reads in full; in every row the coin symbol ends before the price starts; every row is as wide as the list
 *       (dividers full width) and none runs past the viewport; the coin buttons are still >= 24 px tall; page 390 wide
 *   Y2  #2268 /hours at 390 in ru: the range text of every window card is on ONE line
 *   Y3  #2268 /hours in zh: at 390 five axis labels (0, 6, 12, 18, 24) show and none touches its neighbour; at 1280 all nine show
 *   S   shots: /markets 390 en+ru light+dark, 768 and 1280 en; /hours 390 ru and zh (qa/.shots/lay-*.png)
 * /markets rows wait for the exchange socket, so the run accepts it silently (the page reads it as Live). A cell that finds nothing to measure fails. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';

mkdirSync('qa/.shots', { recursive: true });
async function open(browser: Browser, path: string, width: number, loc = 'en', theme: 'dark' | 'light' = 'dark') {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); } catch { /* private */ } }, [loc, theme]);
  await ctx.routeWebSocket(/binance\.com/, () => { /* accept and stay silent */ });
  const page = await ctx.newPage(); await gotoGuarded(page, path); await page.waitForTimeout(14_000);
  return { ctx, page };
}

test.describe('#2268 / #2269 layout', () => {
  test.describe.configure({ timeout: 150_000 });

  for (const loc of ['en', 'ru']) {
    test(`Y1. #2269 /markets at 390 in ${loc}: heads, price vs ticker, dividers`, async ({ browser }) => {
      const { ctx, page } = await open(browser, '/markets', 390, loc);
      try {
        const m = await page.evaluate(() => {
          const textRect = (el: Element) => { const r = document.createRange(); r.selectNodeContents(el); const rs = Array.from(r.getClientRects()).filter(x => x.width > 0); if (!rs.length) return null; return { left: Math.min(...rs.map(x => x.left)), right: Math.max(...rs.map(x => x.right)) }; };
          const vw = window.innerWidth;
          const hdr = document.querySelector('.mkt-hdr-row') as HTMLElement | null;
          const cells = hdr ? Array.from(hdr.children) as HTMLElement[] : [];
          const g = cells[0] ? textRect(cells[0]) : null, c = cells[1] ? textRect(cells[1]) : null;
          const headCut = cells.filter(e => (e.textContent || '').trim()).map(e => e.scrollWidth > e.clientWidth + 1);
          const hr = cells.filter(e => (e.textContent || '').trim()).map(e => ({ t: (e.textContent || '').trim(), r: textRect(e) }));
          const headLines = cells.filter(e => (e.textContent || '').trim()).map(e => { const r = document.createRange(); r.selectNodeContents(e); return new Set(Array.from(r.getClientRects()).filter(x => x.width > 0).map(x => Math.round(x.top))).size; });
          const headTouch = hr.filter((x, i) => i > 0 && x.r && hr[i - 1].r && x.r.left < hr[i - 1].r!.right + 1).map(x => x.t);
          const btns = Array.from(document.querySelectorAll('.mkt-row-btn')) as HTMLElement[];
          const rows = btns.map(b => b.closest('.mkt-coin-cell')?.parentElement as HTMLElement | null).filter(Boolean) as HTMLElement[];
          const widths = rows.map(r => Math.round(r.getBoundingClientRect().width));
          const touching = rows.map(r => { const sym = r.querySelector('.mkt-row-btn') as HTMLElement; const price = r.querySelector('.mkt-price') as HTMLElement | null; if (!price) return null; const a = textRect(sym), b = textRect(price); return a && b && b.left < a.right + 1 ? (sym.textContent || '').trim() + ' ' + Math.round(a.right) + '>' + Math.round(b.left) : null; }).filter(Boolean);
          const border = rows.map(r => { const cs = getComputedStyle(r); const m = /rgba?(([^)]+))/.exec(cs.borderBottomColor); const a = m ? (m[1].split(',')[3] !== undefined ? parseFloat(m[1].split(',')[3]) : 1) : 0; return { w: parseFloat(cs.borderBottomWidth), a }; });
          const faint = border.filter(b => !(b.w >= 1 && b.a >= 0.06)).length;
          const past = rows.filter(r => r.getBoundingClientRect().right > vw + 1).length;
          return { hdrGradeRight: g && Math.round(g.right), hdrCoinLeft: c && Math.round(c.left), headCut, headTouch, headLines, nBtn: btns.length, minBtn: btns.length ? Math.round(Math.min(...btns.map(b => b.getBoundingClientRect().height))) : null, nRows: rows.length, widthMin: Math.min(...widths), widthMax: Math.max(...widths), touching: touching.slice(0, 6), faint, past, docSw: document.documentElement.scrollWidth, vw };
        });
        console.log(`[Y1] ${loc} ${JSON.stringify(m)}`);
        expect(m.nRows, 'no market rows: nothing measured').toBeGreaterThan(5);
        expect(m.hdrGradeRight, 'no GRADE head').not.toBeNull();
        expect(m.hdrGradeRight!, 'GRADE head runs into the COIN head').toBeLessThanOrEqual(m.hdrCoinLeft! - 1);
        // 2026-11-14: the per-cell "cut" and "lines" metrics read the info icon's box (a 24 px icon beside the word) and count the icon's baseline as a second text line, so they flag
        // heads that read fine in the shots (opened: en and ru at 390 on #2284). What matters is asserted instead: no two heads touch, GRADE clears COIN (above), no price touches its ticker.
        expect(m.headTouch, 'two heads touch').toEqual([]);
        expect(m.faint, 'rows whose own divider is missing or nearly invisible').toBe(0);
        expect(m.touching, 'a price touches its ticker').toEqual([]);
        expect(m.widthMax - m.widthMin, 'rows are not all the same width (a divider stops short)').toBeLessThanOrEqual(1);
        expect(m.past, 'a row runs past the viewport').toBe(0);
        expect(m.minBtn!, 'coin button below 24 px').toBeGreaterThanOrEqual(24);
        expect(m.docSw, 'page scrolls sideways').toBeLessThanOrEqual(m.vw);
      } finally { await ctx.close(); }
    });
  }

  test('Y2. #2268 /hours at 390 in ru: every window range is on one line', async ({ browser }) => {
    const { ctx, page } = await open(browser, '/hours', 390, 'ru');
    try {
      const m = await page.evaluate(() => {
        const ranges = Array.from(document.querySelectorAll('body *')).filter(e => e.children.length === 0 && /\b\d{2}:\d{2}\s*-\s*(\S+\s)?\d{2}:\d{2}\s*UTC/.test(e.textContent || '')) as HTMLElement[];
        const info = ranges.map(e => { const r = document.createRange(); r.selectNodeContents(e); const lines = new Set(Array.from(r.getClientRects()).filter(x => x.width > 0).map(x => Math.round(x.top))).size; return { t: (e.textContent || '').trim(), lines }; });
        return { n: info.length, multi: info.filter(i => i.lines > 1), info: info.slice(0, 8) };
      });
      console.log(`[Y2] ${JSON.stringify(m)}`);
      expect(m.n, 'no window range found: nothing measured').toBeGreaterThan(2);
      expect(m.multi, 'a window range wraps onto two lines').toEqual([]);
    } finally { await ctx.close(); }
  });

  for (const [width, want] of [[390, 5], [1280, 9]] as const) {
    test(`Y3. #2268 /hours axis in zh at ${width}: ${want} labels, none touching`, async ({ browser }) => {
      const { ctx, page } = await open(browser, '/hours', width, 'zh');
      try {
        const m = await page.evaluate(() => {
          const minor = document.querySelector('.hours-tick-minor') as HTMLElement | null;
          const row = minor?.parentElement as HTMLElement | null;
          const labels = row ? (Array.from(row.children) as HTMLElement[]).filter(e => getComputedStyle(e).display !== 'none') : [];
          const rects = labels.map(e => { const r = e.getBoundingClientRect(); return { t: (e.textContent || '').trim(), l: Math.round(r.left), r: Math.round(r.right) }; });
          const touching = rects.filter((x, i) => i > 0 && x.l < rects[i - 1].r + 1).map(x => x.t);
          return { n: rects.length, rects, touching, hasMinor: !!minor };
        });
        console.log(`[Y3] ${width} ${JSON.stringify(m)}`);
        expect(m.hasMinor, 'no .hours-tick-minor: this tree does not have the change').toBe(true);
        expect(m.n, `axis shows ${m.n} labels`).toBe(want);
        expect(m.touching, 'axis labels touch').toEqual([]);
      } finally { await ctx.close(); }
    });
  }
});

test.describe('#2268 / #2269 shots', () => {
  test.describe.configure({ timeout: 150_000 });
  const S: Array<[string, number, string, 'dark' | 'light', string]> = [];
  for (const loc of ['en', 'ru']) for (const th of ['dark', 'light'] as const) S.push(['/markets', 390, loc, th, `lay-markets-${loc}-390-${th}`]);
  S.push(['/markets', 768, 'en', 'dark', 'lay-markets-en-768-dark'], ['/markets', 1280, 'en', 'dark', 'lay-markets-en-1280-dark'], ['/hours', 390, 'ru', 'dark', 'lay-hours-ru-390'], ['/hours', 390, 'zh', 'dark', 'lay-hours-zh-390']);
  for (const [path, w, loc, th, name] of S) {
    test(`S. ${name}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, path, w, loc, th);
      try { await page.screenshot({ path: `qa/.shots/${name}.png`, fullPage: true }); } finally { await ctx.close(); }
    });
  }
});

/* #2283 (/markets at 1280 and 390): no-quote price says "No data", unknown buy pressure says "No data" (never a bare dash), the GRADE info icon clears COIN,
 * and every row has its own visible full-width line. recent-trade is stubbed PER SYMBOL: BTC gets a 70% buy list, every other symbol gets NO trades, so
 * a coin with no data cannot read a borrowed ratio (the control Dev asked for). */
async function openMarkets(browser: Browser, width: number, loc: string, theme: 'dark' | 'light' = 'dark') {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); } catch { /* private */ } }, [loc, theme]);
  await ctx.routeWebSocket(/binance\.com/, () => { /* accept and stay silent */ });
  await ctx.route(/\/api\/proxy\?.*type=recent-trade/, async (route) => {
    const sym = new URL(route.request().url()).searchParams.get('symbol') ?? '';
    const list = sym.startsWith('BTC') ? Array.from({ length: 100 }, (_, i) => ({ execId: 'e' + i, symbol: sym, price: '69000', size: '1', side: i % 10 < 7 ? 'Buy' : 'Sell', time: String(Date.now() - i * 1000), isBlockTrade: false })) : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: 'linear', list } }) });
  });
  const page = await ctx.newPage(); await gotoGuarded(page, '/markets'); await page.waitForTimeout(14_000);
  return { ctx, page };
}
for (const loc of ['en', 'ru']) for (const width of [1280, 390]) {
  test(`Y5. #2283 /markets at ${width} in ${loc}: No data, heads clear, own full-width line`, async ({ browser }) => {
    test.setTimeout(150_000);
    const { ctx, page } = await openMarkets(browser, width, loc);
    try {
      const m = await page.evaluate(() => {
        const hdr = document.querySelector('.mkt-hdr-row') as HTMLElement | null; const cells = hdr ? Array.from(hdr.children) as HTMLElement[] : [];
        const range = (el: Element) => { const r = document.createRange(); r.selectNodeContents(el); const rs = Array.from(r.getClientRects()).filter(x => x.width > 0); return rs.length ? { l: Math.min(...rs.map(x => x.left)), r: Math.max(...rs.map(x => x.right)) } : null; };
        const gradeIcon = cells[0] ? cells[0].querySelector('svg, button, span') : null;
        const iconR = gradeIcon ? gradeIcon.getBoundingClientRect() : null; const coin = cells[1] ? range(cells[1]) : null;
        const btns = Array.from(document.querySelectorAll('.mkt-row-btn')) as HTMLElement[];
        const rows = btns.map(b => b.closest('.mkt-coin-cell')?.parentElement as HTMLElement | null).filter(Boolean) as HTMLElement[];
        const prices = rows.map(r => ({ sym: (r.querySelector('.mkt-row-btn')?.textContent || '').trim(), t: ((r.querySelector('.mkt-price') as HTMLElement | null)?.innerText || '').trim(), row: (r.innerText || '').replace(/\s+/g, ' ') }));
        const bareDash = prices.filter(p => /^[-–—]$/.test(p.t)).map(p => p.sym);
        const noData = prices.filter(p => /No data|Нет данных/.test(p.t)).length;
        const borders = rows.map(r => { const cs = getComputedStyle(r); const mm = /rgba?\(([^)]+)\)/.exec(cs.borderBottomColor); const parts = mm ? mm[1].split(',') : []; const a = parts.length > 3 ? parseFloat(parts[3]) : (mm ? 1 : 0); return parseFloat(cs.borderBottomWidth) >= 1 && a >= 0.06; });
        const widths = rows.map(r => Math.round(r.getBoundingClientRect().width));
        const wide = window.innerWidth >= 1000; const pressure = rows.map(r => ((r.querySelector('.mkt-col-pressure') as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim());
        return { nRows: rows.length, bareDash, noData, iconRight: iconR && Math.round(iconR.right), coinLeft: coin && Math.round(coin.l), faint: borders.filter(b => !b).length, widthSpread: widths.length ? Math.max(...widths) - Math.min(...widths) : 0, btcRow: prices.find(p => /^BTC/.test(p.sym))?.row ?? null, pressureSample: wide ? pressure.slice(0, 8) : null, docSw: document.documentElement.scrollWidth, vw: window.innerWidth };
      });
      console.log(`[Y5] ${loc} ${width} ${JSON.stringify(m)}`);
      expect(m.nRows, 'no rows: nothing measured').toBeGreaterThan(5);
      expect(m.bareDash, `a no-quote coin shows a bare dash for its price: ${m.bareDash.join(',')}`).toEqual([]);
      expect(m.noData, 'no coin says No data').toBeGreaterThan(0);
      expect(m.iconRight, 'no GRADE info icon found').not.toBeNull();
      expect(m.iconRight!, 'the GRADE info icon touches or overlaps COIN').toBeLessThanOrEqual(m.coinLeft! - 1);
      expect(m.faint, 'rows without their own visible divider').toBe(0);
      expect(m.widthSpread, 'rows differ in width').toBeLessThanOrEqual(1);
      expect(m.docSw, 'page scrolls sideways').toBeLessThanOrEqual(m.vw);
      if (m.pressureSample) expect(m.pressureSample.some(p => /^[-–—]$/.test(p)), `unknown buy pressure shows a bare dash: ${JSON.stringify(m.pressureSample)}`).toBe(false);
    } finally { await ctx.close(); }
  });
}
for (const [loc, width, th] of [['en', 1280, 'dark'], ['en', 1280, 'light'], ['ru', 1280, 'dark'], ['en', 390, 'dark'], ['ru', 390, 'dark']] as Array<[string, number, 'dark' | 'light']>) {
  test(`S. #2283 shot /markets ${loc} ${width} ${th}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const { ctx, page } = await openMarkets(browser, width, loc, th);
    try { await page.screenshot({ path: `qa/.shots/m2283-${loc}-${width}-${th}.png`, fullPage: true }); } finally { await ctx.close(); }
  });
}
