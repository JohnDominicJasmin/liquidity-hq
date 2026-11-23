/* v2026.11.26 CANDIDATE CHECK, read-only: /changelog serves the new top entry (three lines, in order, dated 23 November 2026), then v2026.11.25 (one line), then v2026.11.24; no sideways scroll at 1280 and 390. GETs only. */
import { test, expect } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: measures a deployed site (-f base_url=<site>)');

const L26 = ['Tokenized prices show their last value and age during an exchange block.', 'Scanner filter counts wait for data instead of showing zero.', 'The Funding regime list can now be reached with the keyboard.'];
const L25 = 'Pro accounts no longer see an upgrade card while the plan loads.';
const L24 = 'Eight data pages now explain how they work, with a short FAQ.';
for (const width of [1280, 390]) {
  test(`CL26:${width} /changelog v2026.11.26 then v2026.11.25 then v2026.11.24`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } }); const page = await ctx.newPage();
    try {
      await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
      await page.goto('/changelog', { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.waitForTimeout(6_000);
      const text = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ')); const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      const at = (s: string) => text.indexOf(s); const p26 = L26.map(at), p25 = at(L25), p24 = at(L24);
      const d26 = text.lastIndexOf('23 November 2026', p26[0]);
      const ok = { lines26: p26.every((v) => v >= 0), order26: p26.every((v, i) => i === 0 || v > p26[i - 1]), date26: d26 >= 0 && p26[0] - d26 < 80, line25: p25 >= 0, sequence: p26[2] < p25 && p25 < p24 };
      console.log(`[CL26] ${width}: ${JSON.stringify(ok)} · scrollWidth ${sw} of ${width}`);
      for (const [k, v] of Object.entries(ok)) expect.soft(v, `${k} failed`).toBe(true);
      expect(sw, 'sideways scroll').toBeLessThanOrEqual(width);
    } finally { await ctx.close().catch(() => {}); }
  });
}
