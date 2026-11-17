/* RSI(21) SHOT for PM sign-off: Pro fixture with a SAVED RSI length of 21 (the settings read is patched to a row carrying strategy_params RSI length 21), and the same with 14 for comparison, /arena BTC at 1280 light.
 * Writes the whole page and a crop of the chart for each; it asserts nothing (CI cannot read the chart legend). */
import { test } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { settleForShot } from './_settle';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
test('SHOT rsi21 and rsi14 arena btc 1280 light', async ({ browser }) => {
  test.setTimeout(240_000);
  for (const len of [21, 14]) {
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 1500 } }); const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('theme', 'light'); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback(); const res = await route.fetch(); const b = await res.json().catch(() => null); if (b == null) return route.fulfill({ response: res });
      const patch = (r: Record<string, unknown>) => ({ ...r, strategy_selection: ['SMA'], strategy_params: { RSI: { length: len, overbought: 70, oversold: 30 } } });
      return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(b) ? b.map(patch) : patch(b as Record<string, unknown>)) });
    });
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(14_000); await settleForShot(page, 'rsi').catch(() => {});
      await page.screenshot({ path: `qa/.shots/rsi-${len}-arena-btc-1280-light.png`, timeout: 25_000 }).catch(() => {});
      const box = await page.evaluate(() => {
        const cs = (Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[]).map((c) => c.getBoundingClientRect()).filter((r) => r.width > 400 && r.height > 20);
        if (!cs.length) return null; const x = Math.min(...cs.map((r) => r.x)), y = Math.min(...cs.map((r) => r.y)), r2 = Math.max(...cs.map((r) => r.x + r.width)), b2 = Math.max(...cs.map((r) => r.y + r.height));
        return { x: Math.max(0, x), y: Math.max(0, y), width: Math.min(r2 - x, 1280), height: Math.min(b2 - y, 1480) };
      });
      if (box) await page.screenshot({ path: `qa/.shots/rsi-${len}-chart-crop-1280-light.png`, clip: box, timeout: 25_000 }).catch(() => {});
    } finally { await ctx.close(); }
  }
});
