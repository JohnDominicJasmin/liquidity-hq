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
          const headTouch = hr.filter((x, i) => i > 0 && x.r && hr[i - 1].r && x.r.left < hr[i - 1].r!.right + 1).map(x => x.t);
          const btns = Array.from(document.querySelectorAll('.mkt-row-btn')) as HTMLElement[];
          const rows = btns.map(b => b.closest('.mkt-coin-cell')?.parentElement as HTMLElement | null).filter(Boolean) as HTMLElement[];
          const widths = rows.map(r => Math.round(r.getBoundingClientRect().width));
          const touching = rows.map(r => { const sym = r.querySelector('.mkt-row-btn') as HTMLElement; const price = r.querySelector('.mkt-price') as HTMLElement | null; if (!price) return null; const a = textRect(sym), b = textRect(price); return a && b && b.left < a.right + 1 ? (sym.textContent || '').trim() + ' ' + Math.round(a.right) + '>' + Math.round(b.left) : null; }).filter(Boolean);
          const border = rows.map(r => { const cs = getComputedStyle(r); const m = /rgba?(([^)]+))/.exec(cs.borderBottomColor); const a = m ? (m[1].split(',')[3] !== undefined ? parseFloat(m[1].split(',')[3]) : 1) : 0; return { w: parseFloat(cs.borderBottomWidth), a }; });
          const faint = border.filter(b => !(b.w >= 1 && b.a >= 0.06)).length;
          const past = rows.filter(r => r.getBoundingClientRect().right > vw + 1).length;
          return { hdrGradeRight: g && Math.round(g.right), hdrCoinLeft: c && Math.round(c.left), headCut, headTouch, nBtn: btns.length, minBtn: btns.length ? Math.round(Math.min(...btns.map(b => b.getBoundingClientRect().height))) : null, nRows: rows.length, widthMin: Math.min(...widths), widthMax: Math.max(...widths), touching: touching.slice(0, 6), faint, past, docSw: document.documentElement.scrollWidth, vw };
        });
        console.log(`[Y1] ${loc} ${JSON.stringify(m)}`);
        expect(m.nRows, 'no market rows: nothing measured').toBeGreaterThan(5);
        expect(m.hdrGradeRight, 'no GRADE head').not.toBeNull();
        expect(m.hdrGradeRight!, 'GRADE head runs into the COIN head').toBeLessThanOrEqual(m.hdrCoinLeft! - 1);
        expect(m.headCut.filter(Boolean).length, `a head is cut off in its own cell: ${JSON.stringify(m.headCut)}`).toBe(0);
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
