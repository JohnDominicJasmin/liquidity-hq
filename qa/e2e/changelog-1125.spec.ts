/* v2026.11.25 CANDIDATE CHECK, read-only: /changelog serves the new top entry (one line, dated 23 November 2026), then v2026.11.24 with its eight lines in order dated 23 November 2026 (the date fix of PR 2771), then v2026.11.23; no sideways scroll at 1280 and 390. GETs only. */
import { test, expect } from '@playwright/test';

const L25 = 'Pro accounts no longer see an upgrade card while the plan loads.';
const L24 = [
  'Eight data pages now explain how they work, with a short FAQ.', 'Shared links show a large Arena chart preview image.', 'A failed first chart load no longer draws a single live candle.', 'Strategy labels on the chart stay clear of support and resistance tags.',
  'Small texts on the liquidation and Arena pages are easier to read.', 'The news page lists only the sources it reads.', 'Economic calendar dates and source line follow your language.', 'The correlation page sends about 290 KB less data.',
];
const L23 = 'Liquidation levels now show for PEPE, BONK and other low-priced coins.';
for (const width of [1280, 390]) {
  test(`CL25:${width} /changelog v2026.11.25 then v2026.11.24 then v2026.11.23`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } }); const page = await ctx.newPage();
    try {
      await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
      await page.goto('/changelog', { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.waitForTimeout(6_000);
      const text = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ')); const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      const at = (s: string) => text.indexOf(s); const p25 = at(L25), order24 = L24.map(at), p23 = at(L23);
      const d25 = text.lastIndexOf('23 November 2026', p25), d24 = text.lastIndexOf('23 November 2026', at(L24[0]));
      const ok = { line25: p25 >= 0, date25: d25 >= 0 && p25 - d25 < 80, order24: order24.every((v, i) => v >= 0 && (i === 0 || v > order24[i - 1])), date24: d24 >= 0 && at(L24[0]) - d24 < 80 && d24 !== d25, sequence: p25 >= 0 && p25 < order24[0] && order24[7] < p23, missing24: L24.filter((l) => at(l) < 0) };
      console.log(`[CL25] ${width}: ${JSON.stringify(ok)} · scrollWidth ${sw} of ${width}`);
      expect(ok.line25, 'the v2026.11.25 line is missing').toBe(true); expect(ok.date25, 'v2026.11.25 is not dated 23 November 2026').toBe(true);
      expect(ok.missing24).toEqual([]); expect(ok.order24, 'v2026.11.24 lines out of order').toBe(true); expect(ok.date24, 'v2026.11.24 is not dated 23 November 2026').toBe(true);
      expect(ok.sequence, 'entries are not in the order .25, .24, .23').toBe(true); expect(sw, 'sideways scroll').toBeLessThanOrEqual(width);
    } finally { await ctx.close().catch(() => {}); }
  });
}
