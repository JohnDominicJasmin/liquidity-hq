/* #2287 (CSS only): /dashboard and /markets fit a 360 px phone, and every footer link is at least 24 px tall; 390 and up unchanged.
 *   X1  /dashboard and /markets at 360 in en and ru: scrollWidth = 360; every element past the viewport is LISTED (tag, class, right edge, text, parents), outside the nav drawer
 *   X2  footer links at 390, 768 and 1280 on / and /arena: the shortest is >= 24 px
 *   S   shots: /markets at 360 en and ru, / at 1280 and 390 light and dark (landing render check, the change touches globals.css)
 * Signed out, reads only. */
import { test, expect, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';

mkdirSync('qa/.shots', { recursive: true });
async function open(browser: Browser, path: string, width: number, loc = 'en', theme: 'dark' | 'light' = 'dark') {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [loc, theme]);
  await ctx.routeWebSocket(/binance\.com/, () => { /* accept and stay silent so /markets draws rows */ });
  const page = await ctx.newPage(); await gotoGuarded(page, path); await page.waitForTimeout(12_000);
  return { ctx, page };
}
for (const path of ['/dashboard', '/markets']) for (const loc of ['en', 'ru']) {
  test(`X1. ${path} at 360 in ${loc}: page 360 wide`, async ({ browser }) => {
    test.setTimeout(150_000);
    const { ctx, page } = await open(browser, path, 360, loc);
    try {
      const m = await page.evaluate(() => {
        const vw = window.innerWidth; const desc = (e: Element) => e.tagName.toLowerCase() + '.' + String((e as HTMLElement).className).slice(0, 28);
        const off = Array.from(document.querySelectorAll('body *')).filter(e => !e.closest('#nav-drawer') && !e.closest('.nav-drawer') && !e.closest('.gchat-quick-row')).map(e => ({ e, r: e.getBoundingClientRect() })).filter(x => x.r.width > 0 && x.r.right > vw + 1)
          .map(x => ({ el: desc(x.e), right: Math.round(x.r.right), text: (x.e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24), parents: [x.e.parentElement, x.e.parentElement?.parentElement].filter(Boolean).map(p => desc(p!)) }));
        const clipped = Array.from(document.querySelectorAll('body *')).filter(e => !e.closest('#nav-drawer') && !e.closest('.nav-drawer') && !e.closest('.gchat-quick-row') && !e.closest('.ntab-bar') && !e.closest('.frh-list-scroll') && !e.closest('.lpt-ticker') && !e.closest('canvas') && !e.closest('svg')).filter(e => { const h = e as HTMLElement; const cs = getComputedStyle(h); const t = (h.textContent || '').trim(); return t.length > 0 && cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && h.clientWidth > 0 && h.scrollWidth > h.clientWidth + 1; }).map(e => {
            const h = e as HTMLElement; const full = (h.textContent || '').replace(/\s+/g, ' ').trim();
            let a: HTMLElement | null = h; let label = '';
            for (let i = 0; i < 3 && a; i++, a = a.parentElement) { label = a.getAttribute('title') || a.getAttribute('aria-label') || ''; if (label) break; }
            return { el: desc(e), sw: h.scrollWidth, cw: h.clientWidth, text: full.slice(0, 30), ellipsis: getComputedStyle(h).textOverflow === 'ellipsis', carriesFull: label.replace(/\s+/g, ' ').includes(full.slice(0, 14)) };
          });
        const hdr = document.querySelector('.mkt-hdr-row') as HTMLElement | null;
        const headClipped = hdr ? (Array.from(hdr.children) as HTMLElement[]).filter(c => (c.textContent || '').trim() && c.scrollWidth > c.clientWidth + 1).map(c => (c.textContent || '').trim().slice(0, 16)) : [];
        // /markets rows: the coin symbol must end before the price text starts (the ru "HYPEНет данных" collision)
        const range = (el: Element) => { const r = document.createRange(); r.selectNodeContents(el); const rs = Array.from(r.getClientRects()).filter(x => x.width > 0); return rs.length ? { l: Math.min(...rs.map(x => x.left)), r: Math.max(...rs.map(x => x.right)) } : null; };
        const touching = (Array.from(document.querySelectorAll('.mkt-row-btn')) as HTMLElement[]).map(b => {
          const row = b.closest('.mkt-coin-cell')?.parentElement as HTMLElement | null; const price = row?.querySelector('.mkt-price') as HTMLElement | null;
          const a = range(b), p = price ? range(price) : null; return a && p && p.l < a.r + 1 ? (b.textContent || '').trim() + ' ' + Math.round(a.r) + '>' + Math.round(p.l) : null;
        }).filter(Boolean) as string[];
        return { docSw: document.documentElement.scrollWidth, vw, n: off.length, off: off.slice(0, 12), clipped: clipped.slice(0, 12), headClipped, touching: touching.slice(0, 8) };
      });
      console.log(`[X1] ${path} ${loc} ${JSON.stringify(m)}`);
      expect(m.docSw, `page is ${m.docSw} wide at 360: ${JSON.stringify(m.off.slice(0, 5))}`).toBeLessThanOrEqual(360);
      // PM's bar: an ellipsis may stay if the FULL text is reachable (title / aria-label); any other clipped text fails. The sr-only h1 is visually hidden by design.
      const bad = m.clipped.filter(c => !(c.ellipsis && c.carriesFull) && !/^(Markets?|Рынки)$/.test(c.text));
      expect(bad, `text is cut off with no way to read it in full: ${JSON.stringify(bad.slice(0, 5))}`).toEqual([]);
      expect(m.touching, `a coin symbol touches its price text at 360: ${JSON.stringify(m.touching)}`).toEqual([]);
      // heads may wrap onto two lines (Dev's #2287 does); a head whose box is narrower than its word is judged in the shot (the icon box makes scrollWidth overstate), so only the touching check above is asserted for /markets rows.
    } finally { await ctx.close(); }
  });
}
for (const width of [390, 768, 1280]) for (const path of ['/', '/arena']) {
  test(`X2. footer links at ${width} on ${path}: >= 24 px`, async ({ browser }) => {
    test.setTimeout(150_000);
    const { ctx, page } = await open(browser, path, width);
    try {
      const m = await page.evaluate(() => { const links = Array.from(document.querySelectorAll('footer a, .lp-footer a, [class*="footer"] a')) as HTMLElement[]; const hs = links.map(a => ({ t: (a.textContent || '').trim().slice(0, 20), h: Math.round(a.getBoundingClientRect().height) })).filter(x => x.h > 0); return { n: hs.length, short: hs.filter(x => x.h < 24), docSw: document.documentElement.scrollWidth }; });
      console.log(`[X2] ${width} ${path} ${JSON.stringify(m)}`);
      expect(m.n, 'no footer links found: nothing measured').toBeGreaterThan(5);
      expect(m.short, 'footer links under 24 px tall').toEqual([]);
      expect(m.docSw, 'page scrolls sideways').toBeLessThanOrEqual(width);
    } finally { await ctx.close(); }
  });
}
for (const [path, w, loc, th] of [['/markets', 360, 'en', 'dark'], ['/markets', 360, 'ru', 'dark'], ['/dashboard', 360, 'en', 'dark'], ['/dashboard', 360, 'ru', 'dark'], ['/', 1280, 'en', 'dark'], ['/', 1280, 'en', 'light'], ['/', 390, 'en', 'dark'], ['/', 390, 'en', 'light']] as Array<[string, number, string, 'dark' | 'light']>) {
  test(`S. ${path} ${w} ${loc} ${th}`, async ({ browser }) => { test.setTimeout(150_000); const { ctx, page } = await open(browser, path, w, loc, th); try { await page.screenshot({ path: `qa/.shots/w2287-${path === '/' ? 'land' : path.slice(1)}-${w}-${loc}-${th}.png`, fullPage: true }); } finally { await ctx.close(); } });
}
