/* v2026.11.27 CANDIDATE CHECK, read-only: /changelog serves the new top entry (three lines, in order, dated 23 November 2026), then v2026.11.25 (one line), then v2026.11.24; no sideways scroll at 1280 and 390. GETs only. */
import { test, expect } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: measures a deployed site (-f base_url=<site>)');

const L27 = 'The Confluence Score no longer counts missing RSI readings as neutral.';
const L26 = 'Tokenized prices show their last value and age during an exchange block.';
const L25 = 'Pro accounts no longer see an upgrade card while the plan loads.';
for (const width of [1280, 390]) {
  test(`CL27:${width} /changelog v2026.11.27 then v2026.11.26 then v2026.11.25`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } }); const page = await ctx.newPage();
    try {
      await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
      await page.goto('/changelog', { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.waitForTimeout(6_000);
      const text = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ')); const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      const at = (x: string) => text.indexOf(x); const p27 = at(L27), p26 = at(L26), p25 = at(L25);
      const d27 = text.lastIndexOf('23 November 2026', p27);
      const ok = { line27: p27 >= 0, date27: d27 >= 0 && p27 - d27 < 80, line26: p26 >= 0, line25: p25 >= 0, sequence: p27 < p26 && p26 < p25 };
      console.log(`[CL27] ${width}: ${JSON.stringify(ok)} · scrollWidth ${sw} of ${width}`);
      for (const [k, v] of Object.entries(ok)) expect.soft(v, `${k} failed`).toBe(true);
      expect(sw, 'sideways scroll').toBeLessThanOrEqual(width);
    } finally { await ctx.close().catch(() => {}); }
  });
}
