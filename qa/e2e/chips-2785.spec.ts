/* PINS FOR #2785 (Dev's list), the Setup Scanner filter chips: until a coin has a price the four chips show the loading mark where the count goes ("All (…)"), never "(0)"; the counts return with the first price. Signed out, a runner build of the head; nothing written.
 *   CH1 every market read failing (snapshot, proxy, klines, news aborted, sockets closed): the four chips read All (…) / Long Liq (…) / Short Squeeze (…) / Neutral (…), and none reads (0)
 *   CH2 reads working: the "All" chip carries a count above 0 and no chip shows the loading mark */
import { test, expect, type Page } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

async function failReads(page: Page) {
  for (const g of ['**/api/market/**', '**/api/proxy**', '**/api/news**']) await page.route(g, (r) => r.abort('failed'));
  const ws = (page as unknown as { routeWebSocket?: (u: RegExp, h: (w: { close: () => void }) => void) => Promise<void> }).routeWebSocket;
  if (ws) await ws.call(page, /.*/, (w) => w.close());
}
const chipTexts = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').match(/(All|Long Liq|Short Squeeze|Neutral) \([^)]{1,6}\)/g) ?? []);

for (const [id, fail] of [['CH1', true], ['CH2', false]] as const) {
  test(`${id} /scanner chips with ${fail ? 'every read failing' : 'the reads working'}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); if (fail) await failReads(page);
      await page.goto('/scanner', { waitUntil: 'domcontentloaded', timeout: 60_000 }); await page.waitForTimeout(fail ? 25_000 : 20_000);
      const chips = await chipTexts(page); console.log(`[CH] ${id}: ${JSON.stringify(chips)}`);
      expect(chips.length, 'no filter chip found').toBeGreaterThanOrEqual(4);
      if (fail) { expect(chips.filter((c) => /\(0\)/.test(c)), 'a chip shows (0) while every read fails').toEqual([]); expect(chips.every((c) => /\(…\)/.test(c)), `not every chip shows the loading mark: ${JSON.stringify(chips)}`).toBe(true); }
      else { const all = chips.find((c) => /^All/.test(c)) ?? ''; expect(Number(/\((\d+)\)/.exec(all)?.[1] ?? 0), `the All chip has no count: ${all}`).toBeGreaterThan(0); expect(chips.filter((c) => /…/.test(c)), 'a chip still shows the loading mark with working reads').toEqual([]); }
    } finally { await ctx.close().catch(() => {}); }
  });
}
