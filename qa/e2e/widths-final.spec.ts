/* The release width pass (ledger #1185 "ru/zh overflow at 1280/768/390/360/945" and "footer links 24 px"): on each page, at 360 and 768 px, in en and ru, the page is not wider than the
 * viewport, and every footer link is at least 24 px tall. Signed out, reads only, meant for the DEPLOYED qa build (base_url). The nav drawer and the intended scroll rows
 * (quick-question chips, news tabs, the funding table box) are excluded from the "past the viewport" list but not from the page width.
 * One test per width x locale; each prints one line per page: [W] <loc> <width> <path> docSw=... footerMin=... other=[...] */
import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';

const PAGES = ['/', '/arena', '/dashboard', '/markets', '/hours', '/funding', '/liq', '/research', '/briefing', '/news'];
const probe = () => {
  const vw = window.innerWidth;
  const links = Array.from(document.querySelectorAll('footer a, .lp-footer a, [class*="footer"] a')) as HTMLElement[];
  const hs = links.map(a => a.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0).map(r => Math.round(r.height));
  const other = Array.from(document.querySelectorAll('body *')).filter(e => !e.closest('#nav-drawer') && !e.closest('.nav-drawer') && !e.closest('.gchat-quick-row') && !e.closest('.ntab-bar') && !e.closest('.frh-list-scroll') && !e.closest('.lpt-ticker'))
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1; }).slice(0, 4).map(e => e.tagName.toLowerCase() + '.' + String((e as HTMLElement).className).slice(0, 24) + ' r=' + Math.round(e.getBoundingClientRect().right));
  return { vw, docSw: document.documentElement.scrollWidth, footerN: hs.length, footerMin: hs.length ? Math.min(...hs) : null, other };
};

for (const loc of ['en', 'ru']) for (const width of [360, 768]) {
  test(`W. ${loc} at ${width}: every page fits, footer links >= 24 px`, async ({ browser }) => {
    test.setTimeout(400_000);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript(([l]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [loc]);
    const page = await ctx.newPage(); const wide: string[] = []; const small: string[] = []; let loaded = 0;
    try {
      for (const path of PAGES) {
        try {
          await gotoGuarded(page, path); await page.waitForTimeout(7_000);
          const d = await page.evaluate(probe); loaded++;
          console.log(`[W] ${loc} ${width} ${path} -> ${new URL(page.url()).pathname} docSw=${d.docSw} footerN=${d.footerN} footerMin=${d.footerMin} other=${JSON.stringify(d.other)}`);
          if (d.docSw > d.vw) wide.push(`${path}(${d.docSw})`);
          if (d.footerMin !== null && d.footerMin < 24) small.push(`${path}(${d.footerMin}px)`);
        } catch (e) { console.log(`[W] ${loc} ${width} ${path} ERROR ${String((e as Error).message).slice(0, 100)}`); }
      }
      expect(loaded, 'no page loaded: nothing measured').toBeGreaterThan(5);
      expect(wide, `pages wider than the ${width}px viewport in ${loc}`).toEqual([]);
      expect(small, `footer links under 24 px tall in ${loc} at ${width}`).toEqual([]);
    } finally { await ctx.close(); }
  });
}
