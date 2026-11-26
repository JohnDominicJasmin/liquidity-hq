/* QA: PR #2854 in a browser (runner build): the unmatched-address page takes the visitor's theme. Test ref only. Prints [NF54] lines. */
import { test, expect } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

test.describe.configure({ timeout: 180_000, retries: 0 });
const CASES = [['stored light, device dark', 'light', 'dark', 'light'], ['stored dark, device light', 'dark', 'light', 'dark'], ['nothing stored, device light', null, 'light', 'light'], ['nothing stored, device dark', null, 'dark', 'dark']] as const;
for (const path of ['/qa-no-such-page', '/ko/nope']) for (const width of [390, 1280] as const) {
  test(`${path} ${width}`, async ({ browser }) => {
    for (const [name, stored, device, want] of CASES) {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: device });
      await ctx.addInitScript((t) => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (t) localStorage.setItem('theme', t); document.addEventListener('DOMContentLoaded', () => { (window as unknown as { __atReady?: string }).__atReady = document.documentElement.getAttribute('data-theme') ?? ''; }); } catch { /* private */ } }, stored);
      const page = await ctx.newPage(); const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error' && !/status of 404|Failed to load resource/i.test(m.text())) errors.push(m.text().slice(0, 150)); });
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 150)));
      try {
        await installPaidAiFence(page); const r = await page.goto(path, { waitUntil: 'load', timeout: 120_000 }); await page.waitForTimeout(3_000);
        const m = await page.evaluate(() => ({ atReady: (window as unknown as { __atReady?: string }).__atReady, theme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 50), scrollWidth: document.documentElement.scrollWidth }));
        console.log(`[NF54] ${path} ${width} ${name}: status=${r?.status()} ${JSON.stringify(m)} errors=${errors.length ? JSON.stringify(errors.slice(0, 2)) : 'none'}`);
        expect.soft(m.atReady, name).toBe(want); expect.soft(m.theme, name).toBe(want); expect.soft(errors, name).toEqual([]); expect.soft(r?.status()).toBe(404);
        await page.screenshot({ path: `qa/.shots/pr2854-404${path.replace(/\//g, '_')}-${width}-${name.replace(/[^a-z]+/g, '-')}.png` });
      } finally { await ctx.close().catch(() => {}); }
    }
  });
}
