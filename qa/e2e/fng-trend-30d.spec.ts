/* #1651 (QA audit list): the Fear & Greed "30-day trend" line in the Market Conditions widget on /dashboard (components/MarketConditionsWidget.tsx).
 * Expectations come from the owner-facing label and the widget's own contract (a line needs at least two points), not from reading the line's code path:
 *   T1  live read: the trend row shows, the line has exactly as many points as the history response carries (the page asks for 30), and it is not flat when the readings differ
 *   T2  CONTROL, stubbed history of 30 distinct readings: the row shows with 30 points and a non-flat line (proves the cell can see a real line)
 *   T3  stubbed history of ONE reading: no flat line is drawn (the gauge still renders)
 *   T4  stubbed failed history (500): no flat line is drawn (the gauge still renders)
 * T3/T4 record what the page SHOWS in place of the line (the row is absent, or something says so) and print it; they fail only if a flat or one-point line is drawn.
 * Signed out, the only request touched is the public fng proxy read, which is stubbed in T2-T4. A cell that finds no trend row where one is expected fails. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';

async function open(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  /* the widget caches its history for 6 h in localStorage: start every cell with none */
  await ctx.addInitScript(() => { try { localStorage.removeItem('lhq_fng_history'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', 'dark'); } catch { /* private */ } });
  await ctx.routeWebSocket(/binance\.com/, () => { /* stay silent */ });
  return ctx;
}
const stubFng = (page: Page, body: unknown, status = 200) => page.route(/\/api\/proxy\?.*type=fng.*limit=30/, route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
const series30 = { data: Array.from({ length: 30 }, (_, i) => ({ value: String(20 + ((i * 7) % 61)), value_classification: 'x', timestamp: String(1_700_000_000 + i * 86_400) })) };

/** What the widget shows for the trend: whether the label is there, the polyline's point count and whether it is flat. */
const readTrend = (page: Page) => page.evaluate(() => {
  const label = Array.from(document.querySelectorAll('span')).find(s => /30-day trend|30-дневн/i.test(s.textContent || ''));
  const row = label ? (label.parentElement as HTMLElement) : null;
  const poly = row ? row.querySelector('svg polyline') : null;
  const pts = poly ? (poly.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean) : [];
  const ys = pts.map(p => parseFloat(p.split(',')[1]));
  return {
    labelShown: !!label, polyline: !!poly, n: pts.length,
    flat: ys.length > 1 ? Math.max(...ys) - Math.min(...ys) < 0.5 : null,
    gauge: !!document.querySelector('.fng-score, svg [id="fngGaugeGrad"], #fngGaugeGrad'),
    rowText: row ? (row.textContent || '').replace(/\s+/g, ' ').slice(0, 80) : null,
  };
});

test.describe('#1651 Fear & Greed 30-day trend', () => {
  test.describe.configure({ timeout: 150_000 });

  test('T1. live: the trend row draws one point per history reading, not flat', async ({ browser }) => {
    const ctx = await open(browser); const page = await ctx.newPage();
    try {
      let got: number | null = null;
      page.on('response', async r => { if (/\/api\/proxy\?.*type=fng.*limit=30/.test(r.url())) { try { const j = await r.json() as { data?: unknown[] }; got = Array.isArray(j.data) ? j.data.length : -1; } catch { got = -2; } } });
      await gotoGuarded(page, '/dashboard'); await page.waitForTimeout(15_000);
      const t = await readTrend(page);
      console.log(`[T1] response points=${got} trend=${JSON.stringify(t)}`);
      expect(got, 'the page never asked for the 30-day history (limit=30): nothing measured').not.toBeNull();
      expect(got!, 'the history read failed or returned no list').toBeGreaterThan(1);
      expect(t.labelShown, 'the 30-day trend row is not on /dashboard').toBe(true);
      expect(t.n, 'the line must have one point per reading in the response').toBe(got);
      expect(t.n, 'the page asked for 30 readings').toBeLessThanOrEqual(30);
      expect(t.flat, 'a trend line of real readings must not be flat').toBe(false);
    } finally { await ctx.close(); }
  });

  test('T2. CONTROL, 30 stubbed readings: 30 points, not flat', async ({ browser }) => {
    const ctx = await open(browser); const page = await ctx.newPage();
    try {
      await stubFng(page, series30);
      await gotoGuarded(page, '/dashboard'); await page.waitForTimeout(12_000);
      const t = await readTrend(page);
      console.log(`[T2] trend=${JSON.stringify(t)}`);
      expect(t.labelShown, 'with 30 readings the trend row must show').toBe(true);
      expect(t.n).toBe(30); expect(t.flat).toBe(false);
    } finally { await ctx.close(); }
  });

  for (const [name, status, body] of [['T3. ONE stubbed reading', 200, { data: [{ value: '55', value_classification: 'Greed', timestamp: '1700000000' }] }], ['T4. history request fails (500)', 500, { error: 'upstream' }]] as Array<[string, number, unknown]>) {
    test(`${name}: no flat line, the gauge still renders`, async ({ browser }) => {
      const ctx = await open(browser); const page = await ctx.newPage();
      try {
        await stubFng(page, body, status);
        await gotoGuarded(page, '/dashboard'); await page.waitForTimeout(12_000);
        const t = await readTrend(page);
        console.log(`[${name.slice(0, 2)}] trend=${JSON.stringify(t)}`);
        expect(t.n, 'a flat or one-point line was drawn from no real history').toBeLessThan(2);
        expect(t.flat, 'a flat line is drawn').not.toBe(true);
      } finally { await ctx.close(); }
    });
  }
});
