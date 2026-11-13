/* One-off (#2247 / ru sideways scroll): at 390 px, list every element whose right edge is past the viewport on /arena, in ru and en,
 * with and without the unknown-coin note. Output is the console dump only; the one assertion is the control (en without a note must have a measurable page). Signed out, nothing written. */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';
mkdirSync('qa/.shots', { recursive: true });

const dump = () => {
  const vw = window.innerWidth;
  const desc = (e: Element) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof (e as HTMLElement).className === 'string' && (e as HTMLElement).className ? '.' + (e as HTMLElement).className.trim().split(/\s+/).slice(0, 3).join('.') : '') + ((e as HTMLElement).dataset && (e as HTMLElement).dataset.testid ? '[testid=' + (e as HTMLElement).dataset.testid + ']' : '');
  const out = Array.from(document.querySelectorAll('body *')).filter(e => !e.closest('#nav-drawer') && !e.closest('.nav-drawer')).map(e => ({ e, r: e.getBoundingClientRect() })).filter(x => x.r.width > 0 && x.r.right > vw + 1)
    .map(x => { const chain: string[] = []; let p: Element | null = x.e.parentElement; for (let i = 0; i < 3 && p; i++, p = p.parentElement) chain.push(desc(p)); return { el: desc(x.e), right: Math.round(x.r.right), width: Math.round(x.r.width), text: (x.e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), chain }; });
  return { vw, docSw: document.documentElement.scrollWidth, bodySw: document.body.scrollWidth, count: out.length, wide: out.sort((a, b) => b.right - a.right).slice(0, 25) };
};

test.describe('arena elements past the 390 viewport', () => {
  test.describe.configure({ timeout: 150_000 });
  for (const loc of ['en', 'ru']) for (const coin of ['btc', 'zzzz']) {
    test(`W. ${loc} /arena?coin=${coin} at 390`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
      await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, loc);
      const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/arena?coin=' + coin); await page.waitForTimeout(9_000);
        const d = await page.evaluate(dump);
        console.log(`[W] ${loc} ${coin} ` + JSON.stringify(d));
        if (coin === 'btc') { const card = page.locator('.edge-card').first(); if (await card.count()) { await card.scrollIntoViewIfNeeded().catch(() => {}); await card.screenshot({ path: `qa/.shots/edge-card-${loc}-390.png` }).catch(() => {}); } await page.screenshot({ path: `qa/.shots/arena-${loc}-390.png` }); }
        expect(d.vw, 'the page did not load at 390').toBe(390);
      } finally { await ctx.close(); }
    });
  }
});
