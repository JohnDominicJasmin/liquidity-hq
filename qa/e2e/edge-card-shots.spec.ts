/* #2253 sign-off shots for PM: the edge cards after the wrap change. Signed out, nothing written.
 *   /dashboard at 390 in en and ru, light and dark; /dashboard at 768 and 1280 in en (must look unchanged); /arena rail at 390 in ru.
 * Each shot also asserts the page is not wider than the viewport. Output: qa/.shots/edge-*.png */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';

mkdirSync('qa/.shots', { recursive: true });
const SHOTS: Array<{ path: string; loc: string; width: number; theme: 'dark' | 'light'; name: string }> = [];
for (const loc of ['en', 'ru']) for (const theme of ['dark', 'light'] as const) SHOTS.push({ path: '/dashboard', loc, width: 390, theme, name: `edge-dashboard-${loc}-390-${theme}` });
for (const width of [768, 1280]) for (const theme of ['dark', 'light'] as const) SHOTS.push({ path: '/dashboard', loc: 'en', width, theme, name: `edge-dashboard-en-${width}-${theme}` });
for (const theme of ['dark', 'light'] as const) SHOTS.push({ path: '/arena?coin=btc&tf=1h', loc: 'ru', width: 390, theme, name: `edge-arena-ru-390-${theme}` });

test.describe('#2253 edge-card shots', () => {
  test.describe.configure({ timeout: 150_000 });
  for (const s of SHOTS) {
    test(`S. ${s.name}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: s.width, height: 900 } });
      await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); } catch { /* private */ } }, [s.loc, s.theme]);
      const page = await ctx.newPage();
      try {
        await gotoGuarded(page, s.path); await page.waitForTimeout(12_000);
        await page.screenshot({ path: `qa/.shots/${s.name}.png`, fullPage: true });
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth, theme: document.documentElement.getAttribute('data-theme'), cards: document.querySelectorAll('.edge-card').length }));
        console.log(`[S] ${s.name} ${JSON.stringify(m)}`);
        expect(m.sw, 'sideways scroll').toBeLessThanOrEqual(m.w);
      } finally { await ctx.close(); }
    });
  }
});
