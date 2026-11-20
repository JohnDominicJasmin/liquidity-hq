/* v2026.11.22 STAGING CHECK, read-only: the /changelog page serves the new top entry, in order, with the seven lines the release carries and the date 20 November 2026, above the v2026.11.21 entry. GETs only, nothing written. */
import { test, expect } from '@playwright/test';

const LINES = [
  'Every strategy now draws on the chart, even with no setup.',
  'Strategy lines off the visible price range show an edge label.',
  "Pages keep the last good value instead of 'unavailable' text.",
  'PEPE, BONK and other 1000x coins use one price unit.',
  'The SMA line is now a true simple moving average.',
  "Stock VWAP reclaim keeps the last session's line when the market closes.",
  "The Setup card no longer covers the Arena's strategy panel.",
];
for (const width of [1280, 390]) {
  test(`CL:${width} /changelog top entry`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } }); const page = await ctx.newPage();
    try {
      await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
      await page.goto('/changelog', { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.waitForTimeout(5_000);
      const text = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
      const at = (s: string) => text.indexOf(s);
      const missing = LINES.filter((l) => at(l) < 0); const order = LINES.map(at);
      const first21 = at('Markets: very small coin prices keep their digits.');
      const datePos = text.lastIndexOf('20 November 2026', at(LINES[0]));
      console.log(`[CL] ${width}: missing ${JSON.stringify(missing)} · in order ${order.every((v, i) => i === 0 || v > order[i - 1])} · above the v2026.11.21 entry ${first21 < 0 ? 'n/a' : at(LINES[6]) < first21} · date "20 November 2026" before the first line ${datePos >= 0 && at(LINES[0]) - datePos < 60} · the dropped liquidation line absent ${at('Liquidation levels hidden') < 0} · SAR claim absent ${at('Parabolic SAR and SMA') < 0}`);
      expect(missing, 'lines of the v2026.11.22 entry missing from /changelog').toEqual([]);
      expect(order.every((v, i) => i === 0 || v > order[i - 1]), 'lines out of order').toBe(true);
      expect(first21 < 0 || at(LINES[6]) < first21, 'the new entry must sit above v2026.11.21').toBe(true);
      expect(at('Liquidation levels hidden'), 'the dropped line is on the page').toBeLessThan(0); expect(at('Parabolic SAR and SMA'), 'the unverified SAR claim is on the page').toBeLessThan(0);
      expect(datePos >= 0 && at(LINES[0]) - datePos < 60, 'the entry is not dated 20 November 2026').toBe(true);
    } finally { await ctx.close().catch(() => {}); }
  });
}
