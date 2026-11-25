/* QA: PR #2848 in a browser (runner build): the ring appears when the chart takes keyboard focus, not on a click, and the chart keeps its size, at 390, 768 and 1280, dark and light. Prints [FR] lines. */
import { test, expect } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

test.describe.configure({ timeout: 240_000 });
for (const width of [390, 768, 1280] as const) for (const theme of ['dark', 'light'] as const) {
  test(`FR ${width} ${theme}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); await page.goto('/arena', { waitUntil: 'domcontentloaded', timeout: 150_000 });
      const host = page.locator('.klc-canvas').first(); await host.waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(12_000);
      const read = () => host.evaluate((h) => { const a = getComputedStyle(h, '::after'); const r = h.getBoundingClientRect(); return { ring: a.content !== 'none' ? `${a.borderTopWidth} ${a.borderTopStyle} ${a.borderTopColor}` : null, size: `${Math.round(r.width)}x${Math.round(r.height)}`, focused: !!h.querySelector(':focus') }; });
      const before = await read();
      await host.click({ position: { x: 40, y: 40 } }); await page.waitForTimeout(600); const clicked = await read();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      let reached = false; for (let i = 0; i < 120 && !reached; i++) { await page.keyboard.press('Tab'); reached = await host.evaluate((h) => !!h.querySelector(':focus')); }
      await page.waitForTimeout(400); const keyed = await read();
      console.log(`[FR] ${width} ${theme}: reached=${reached} before=${JSON.stringify(before)} clicked=${JSON.stringify(clicked)} keyboard=${JSON.stringify(keyed)} scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
      expect.soft(reached).toBe(true); expect.soft(before.ring).toBeNull(); expect.soft(clicked.ring, 'a click drew the ring').toBeNull(); expect.soft(keyed.ring ?? '').toMatch(/^2px solid/); expect.soft(keyed.size).toBe(before.size);
      await host.scrollIntoViewIfNeeded(); await host.screenshot({ path: `qa/.shots/pr2848-chart-focus-${width}-${theme}.png` });
    } finally { await ctx.close().catch(() => {}); }
  });
}
