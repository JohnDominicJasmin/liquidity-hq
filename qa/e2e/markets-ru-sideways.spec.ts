/* READ-ONLY probe (signed out, GETs only): does /markets scroll sideways at 390 px in Russian? Compares production with a build under test.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f base_url=<site> -f project=desktop -f "spec=qa/e2e/markets-ru-sideways.spec.ts"
 * Prints scrollWidth, the viewport and the elements that stick out past the right edge (class + text start + right edge). Fails when the page is wider than 390. */
import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';

for (const [loc, path] of [['en', '/markets'], ['ru', '/markets'], ['en', '/dashboard'], ['en', '/arena']] as const) {
  test(`MS:${loc}:${path}: at 390 does not scroll sideways`, async ({ browser }) => {
    test.setTimeout(120_000); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, loc);
    const page = await ctx.newPage();
    try {
      await gotoGuarded(page, path); await page.waitForTimeout(15_000);
      const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        /* a REAL culprit: its right edge is past the viewport, and no ancestor clips it (overflow hidden / clip / auto / scroll) and it is not in a fixed-position subtree */
        const clipped = (el: Element) => { for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.position === 'fixed') return true; if (/hidden|clip|auto|scroll/.test(cs.overflowX)) return true; } return getComputedStyle(el).position === 'fixed'; };
        const past = Array.from(document.querySelectorAll('body *')).map((el) => ({ el, r: el.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.right > vw + 1 && !clipped(x.el))
          .map((x) => ({ tag: x.el.tagName.toLowerCase(), cls: String((x.el as HTMLElement).className).slice(0, 40), text: ((x.el as HTMLElement).innerText || '').replace(/\s+/g, ' ').slice(0, 28), right: Math.round(x.r.right), w: Math.round(x.r.width) }));
        return { vw, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, n: past.length, culprits: past.slice(0, 10) };
      });
      console.log(`[MKT] ${loc} ${path}: ${JSON.stringify(m)}`);
      expect(m.doc, `${path} in ${loc} is ${m.doc}px wide at a 390 viewport`).toBeLessThanOrEqual(390);
    } finally { await ctx.close(); }
  });
}
