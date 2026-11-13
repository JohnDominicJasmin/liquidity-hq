/* #2254 sign-off shots for PM: /funding, /markets and /dashboard at 390 after the 24 px hit box on the coin-name buttons, light and dark, signed out.
 * Also measures the buttons themselves: height of button.frh-coin-btn, .mkt-row-btn, .csb2-name-btn (min across rows) and the page width. Output: qa/.shots/tap-*.png */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { gotoGuarded } from './_shared';

mkdirSync('qa/.shots', { recursive: true });
const PAGES = [{ path: '/funding', sel: 'button.frh-coin-btn', name: 'funding' }, { path: '/markets', sel: 'button.mkt-row-btn', name: 'markets' }, { path: '/dashboard', sel: 'button.csb2-name-btn', name: 'dashboard' }];
test.describe('#2254 tap-target shots', () => {
  test.describe.configure({ timeout: 150_000 });
  for (const p of PAGES) for (const theme of ['dark', 'light'] as const) {
    test(`S. ${p.name} at 390 ${theme}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
      await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* private */ } }, theme);
      await ctx.routeWebSocket(/binance.com/, () => { /* accept and stay silent: the page reads the socket as Live, so /markets draws its rows */ });
      const page = await ctx.newPage();
      try {
        await gotoGuarded(page, p.path); await page.waitForTimeout(12_000);
        await page.screenshot({ path: `qa/.shots/tap-${p.name}-390-${theme}.png`, fullPage: true });
        const m = await page.evaluate((sel) => { const hs = Array.from(document.querySelectorAll(sel)).map(e => e.getBoundingClientRect().height); return { n: hs.length, min: hs.length ? Math.round(Math.min(...hs)) : null, max: hs.length ? Math.round(Math.max(...hs)) : null, sw: document.documentElement.scrollWidth, w: window.innerWidth }; }, p.sel);
        console.log(`[T] ${p.name} ${theme} ${JSON.stringify(m)}`);
        expect(m.n, `no ${p.sel} on ${p.path}: nothing measured`).toBeGreaterThan(0);
        expect(m.min!, `smallest ${p.sel} is ${m.min} px`).toBeGreaterThanOrEqual(24);
        expect(m.sw, 'sideways scroll').toBeLessThanOrEqual(m.w);
      } finally { await ctx.close(); }
    });
  }
});
