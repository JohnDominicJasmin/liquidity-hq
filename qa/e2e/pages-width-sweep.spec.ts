/* One-off sweep (#2253 follow-up): at 390 px in ru and ko, for each page, the page width, the final URL and every element past the viewport
 * outside the off-canvas nav drawer. Signed out, reads only. The one assertion is the control: the page must load at 390. */
import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';

const PAGES = ['/arena', '/arena?coin=btc&tf=1h', '/dashboard', '/liq', '/research', '/briefing', '/funding', '/news'];
const dump = () => {
  const vw = window.innerWidth;
  const desc = (e: Element) => e.tagName.toLowerCase() + (typeof (e as HTMLElement).className === 'string' && (e as HTMLElement).className ? '.' + (e as HTMLElement).className.trim().split(/\s+/).slice(0, 3).join('.') : '');
  const out = Array.from(document.querySelectorAll('body *')).filter(e => !e.closest('#nav-drawer') && !e.closest('.nav-drawer')).map(e => ({ e, r: e.getBoundingClientRect() })).filter(x => x.r.width > 0 && x.r.right > vw + 1)
    .map(x => { const chain: string[] = []; let p: Element | null = x.e.parentElement; for (let i = 0; i < 3 && p; i++, p = p.parentElement) chain.push(desc(p)); return { el: desc(x.e), right: Math.round(x.r.right), width: Math.round(x.r.width), text: (x.e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), chain }; }).sort((a, b) => b.right - a.right);
  const notScrollRow = out.filter(o => !/gchat-quick/.test(o.el));
  return { vw, docSw: document.documentElement.scrollWidth, count: out.length, other: notScrollRow.slice(0, 8) };
};

for (const loc of ['ru', 'ko']) {
  test.describe(`width sweep at 390 in ${loc}`, () => {
    test.describe.configure({ timeout: 200_000 });
    test(`P. ${loc}: every page`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
      await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
      const page = await ctx.newPage(); let loaded = 0;
      try {
        for (const path of PAGES) {
          try { await gotoGuarded(page, path); await page.waitForTimeout(8_000); const d = await page.evaluate(dump); loaded++; console.log(`[P] ${loc} ${path} -> ${new URL(page.url()).pathname} ${JSON.stringify(d)}`); }
          catch (e) { console.log(`[P] ${loc} ${path} ERROR ${String((e as Error).message).slice(0, 100)}`); }
        }
        expect(loaded, 'no page loaded').toBeGreaterThan(0);
      } finally { await ctx.close(); }
    });
  });
}
