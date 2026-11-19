/* #2534 /dashboard narrow-width fix (.dash-conditions-row single column = minmax(0,1fr)): does the page still scroll sideways, and is the Economic Calendar / Market conditions content still FULLY visible (not clipped)?
 * Signed out, Free and Pro, 360 / 390 / 768, light and dark. Per cell: document width vs viewport, the unclipped elements past the right edge, and every text element inside the conditions row / av-rail whose right edge is past the viewport or whose text is cut (scrollWidth > clientWidth with overflow hidden).
 * Fails when the document is wider than the viewport, or when text inside the conditions row / av-rail is cut. Prints a screenshot per cell. */
import { test, expect } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { mkdirSync } from 'node:fs';
mkdirSync('qa/.shots', { recursive: true });

const measure = () => {
  const vw = document.documentElement.clientWidth;
  const clipped = (el: Element) => { for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.position === 'fixed') return true; if (/hidden|clip|auto|scroll/.test(cs.overflowX)) return true; } return getComputedStyle(el).position === 'fixed'; };
  const past = Array.from(document.querySelectorAll('body *')).map((el) => ({ el, r: el.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.right > vw + 1 && !clipped(x.el)).map((x) => `${x.el.tagName.toLowerCase()}.${String((x.el as HTMLElement).className).slice(0, 26)} r${Math.round(x.r.right)}`);
  const scopes = Array.from(document.querySelectorAll('.dash-conditions-row, .av-rail-panel, .av-rail'));
  const cut: string[] = [];
  for (const sc of scopes) for (const el of Array.from(sc.querySelectorAll('*'))) {
    const h = el as HTMLElement; const r = h.getBoundingClientRect(); if (r.width < 4 || !(h.innerText || '').trim()) continue;
    const ov = getComputedStyle(h).overflowX; const isCut = h.scrollWidth > h.clientWidth + 1 && /hidden|clip/.test(ov) && getComputedStyle(h).textOverflow !== 'ellipsis';   /* an ellipsis is the DESIGNED truncation (the calendar event name carries the full text in its title); a hard clip is not */ const outside = r.right > vw + 1 || r.left < -1;
    if (isCut || outside) cut.push(`${h.tagName.toLowerCase()}.${String(h.className).slice(0, 22)} "${(h.innerText || '').replace(/\s+/g, ' ').slice(0, 24)}" ${isCut ? `CUT sw${h.scrollWidth}>cw${h.clientWidth}` : `r${Math.round(r.right)}`}`);
  }
  return { vw, doc: document.documentElement.scrollWidth, past: past.slice(0, 6), nPast: past.length, calendar: !!document.querySelector('.av-rail-panel'), cut: cut.slice(0, 10), nCut: cut.length };
};

for (const who of ['out', 'free', 'pro'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [360, 390, 768]) {
  test(`DF:${who}:${theme}:${width}`, async ({ browser }) => {
    test.setTimeout(150_000); test.skip(who !== 'out' && !AUTH_READY, 'no fixtures');
    const opts = { viewport: { width, height: 900 } };
    const ctx = who === 'out' ? await browser.newContext(opts) : await signedInContext(browser, who === 'free' ? 'b' : 'a', opts);
    await ctx.addInitScript(([t]) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); } catch { /* private */ } }, [theme]);
    const page = await ctx.newPage();
    try {
      if (who === 'out') await page.goto('/dashboard', { waitUntil: 'domcontentloaded' }); else await gotoSignedIn(page, '/dashboard');
      await page.waitForTimeout(16_000); const m = await page.evaluate(measure);
      console.log(`[DF] ${who} ${theme} ${width}: ${JSON.stringify(m)}`);
      await page.screenshot({ path: `qa/.shots/dash-${who}-${theme}-${width}.png`, timeout: 20_000 }).catch(() => {});
      expect(m.doc, `/dashboard is ${m.doc}px wide at a ${m.vw}px viewport (${m.past.join(' | ')})`).toBeLessThanOrEqual(m.vw);
      expect(m.cut, `text cut or outside the viewport inside the conditions row / av-rail`).toEqual([]);
    } finally { await ctx.close(); }
  });
}
