/* QA: PR #2828 in a browser: the live-liquidations stats row at 390, 768 and 1280, both themes. Prints [LS] lines; screenshots of the signed-out panel. */
import { test, expect } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

test.describe.configure({ timeout: 240_000 });
for (const width of [390, 768, 1280] as const) for (const theme of ['dark', 'light'] as const) {
  test(`LS ${width} ${theme}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); await page.goto('/liq', { waitUntil: 'domcontentloaded', timeout: 150_000 });
      const row = page.locator('.liqfeed-stats').first();
      const there = await row.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false);
      if (!there) { console.log(`[LS] ${width} ${theme}: no stats row; page says ${JSON.stringify((await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))).slice(0, 200))}`); expect(there).toBe(true); return; }
      await page.waitForTimeout(6_000);
      const m = await row.evaluate((r) => ({ kids: Array.from(r.children).map((c) => { const b = (c as HTMLElement).getBoundingClientRect(); return { cls: c.className, x: Math.round(b.x), mid: Math.round(b.y + b.height / 2), w: Math.round(b.width), cut: Array.from(c.querySelectorAll('span')).some((s) => (s as HTMLElement).scrollWidth > (s as HTMLElement).clientWidth + 1), text: (c as HTMLElement).innerText.replace(/\s+/g, ' ') }; }), page: document.documentElement.scrollWidth }));
      console.log(`[LS] ${width} ${theme}: ${JSON.stringify(m)}`);
      const figures = m.kids.filter((k) => k.cls === 'liqfeed-stat');
      expect.soft(m.kids.length).toBe(5);
      expect.soft(Math.max(...m.kids.map((k) => k.mid)) - Math.min(...m.kids.map((k) => k.mid)), 'not on one line').toBeLessThanOrEqual(2);
      expect.soft(Math.max(...figures.map((k) => k.w)) - Math.min(...figures.map((k) => k.w)), 'unequal columns').toBeLessThanOrEqual(2);
      expect.soft(figures.some((k) => k.cut), 'a figure is cut off').toBe(false);
      expect.soft(m.page).toBeLessThanOrEqual(width);
      await row.screenshot({ path: `qa/.shots/pr2828-liq-stats-${width}-${theme}.png` });
    } finally { await ctx.close().catch(() => {}); }
  });
}
