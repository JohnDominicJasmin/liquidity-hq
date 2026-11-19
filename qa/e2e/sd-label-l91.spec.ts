/* L91: DOES THE "DEMAND" / "SUPPLY" LABEL SIT ON TOP OF THE BUY / SELL MARKER? (tracker #1263 L91: "check in QA's 16-strategy drawing shots first; fix only if still overlapping".) The 16-strategy shots (run 44443967104) were all WAIT on the stand-in series, so
 * no S/D zone and no marker was on screen. This spec serves a CRAFTED series (the unit fixture of __tests__/strategy4SupplyDemand.test.mts scaled to BTC prices: 70 quiet candles, a bullish impulse, a move away, then a retest that closes back above the demand
 * zone = BUY; the mirror = SELL) to BOTH candle feeds the page reads (the chart's /api/market/klines and the strategy's direct Binance / Bybit klines), picks Supply / demand as the Pro fixture, and shoots the chart at 1280 and 390 (dark and light) plus a zoomed
 * crop of the last candles. The chart is a canvas, so the overlap is judged from the crop; the spec asserts the call is BUY / SELL (so the marker exists) and prints [L91] lines. Nothing is run on the paid AI route. */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });
test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const H = 3_600_000, SCALE = 700;
type K = [number, number, number, number, number, number];   // time, open, high, low, close, volume
const UP: Array<[number, number, number, number]> = [[100, 104, 104.5, 99.8], [104, 105, 105.5, 103], [103, 102, 103.2, 100.5]];            // impulse, away, retest (BUY)
const DN: Array<[number, number, number, number]> = [[100, 96, 100.2, 95.5], [96, 95, 97, 94.5], [97, 98.3, 99.2, 97]];                     // impulse, away, retest (SELL)
function craft(extra: Array<[number, number, number, number]>): K[] {
  const quiet: Array<[number, number, number, number]> = Array.from({ length: 70 }, () => [100, 100.3, 101, 99]);
  const all = [...quiet, ...extra], lastOpen = Math.floor(Date.now() / H) * H - H;
  return all.map(([o, c, h, l], i) => [lastOpen - (all.length - 1 - i) * H, o * SCALE, h * SCALE, l * SCALE, c * SCALE, 100]);
}

for (const [dir, extra] of [['buy', UP], ['sell', DN]] as const) for (const [width, theme] of [[1280, 'dark'], [390, 'dark'], [1280, 'light'], [390, 'light']] as const) {
  test(`L91 ${dir} ${width} ${theme}: the Supply/Demand zone label vs the ${dir} marker`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ks = craft(extra);
    const ctx = await signedInContext(browser, 'a');
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
    const page = await ctx.newPage(); await page.setViewportSize({ width, height: width < 600 ? 900 : 1000 }); await installPaidAiFence(page);
    const upto = (limit: number) => ks.slice(-Math.min(limit, ks.length));
    const lim = (u: string) => Number(new URL(u).searchParams.get('limit') ?? '300');
    /* ONE route, shaped by ?source=: bybit keeps its {retCode, result:{list}} envelope (newest first, strings); every other source is the raw array of [time, open, high, low, close, volume] (the strategy hook reads Bybit first, the chart another source) */
    await page.route('**/api/market/klines**', (r) => {
      const u = new URL(r.request().url()), rows = upto(lim(r.request().url()));
      const body = u.searchParams.get('source') === 'bybit' ? { retCode: 0, retMsg: 'OK', result: { list: rows.slice().reverse().map((k) => [String(k[0]), String(k[1]), String(k[2]), String(k[3]), String(k[4]), String(k[5]), '0']) } } : rows.map((k) => [k[0], String(k[1]), String(k[2]), String(k[3]), String(k[4]), String(k[5])]);
      console.log(`[L91] klines source=${u.searchParams.get('source')} interval=${u.searchParams.get('interval')} limit=${u.searchParams.get('limit')} -> ${rows.length} rows`);
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route(/\/api\/settings(\?|$)/, async (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [] }) })));
    await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => { if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' }); return route.fallback(); });
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
      const sel = page.locator('[data-testid="strategy-set-select"]').first(); await sel.waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(4_000);
      await sel.selectOption('supply_demand', { timeout: 20_000 }); await page.waitForTimeout(6_000);
      const r = await page.evaluate(() => { const v = document.querySelector('[data-testid="strategy-call-verdict"]'); const box = document.querySelector('[data-testid="strategy-call-box"]'); return { verdict: v ? ((v as HTMLElement).dataset.verdict || (v as HTMLElement).innerText) : null, text: box ? ((box as HTMLElement).innerText || '').replace(/\s+/g, ' ').slice(0, 200) : null }; });
      console.log(`[L91] ${dir} ${width} ${theme}: verdict ${r.verdict} · box "${r.text}"`);
      await page.screenshot({ path: `qa/.shots/l91-${dir}-${width}-${theme}.png` });
      const wrap = page.locator('.klc-canvas-wrap').first(); const bb = await wrap.boundingBox().catch(() => null);
      if (bb) await page.screenshot({ path: `qa/.shots/l91-${dir}-${width}-${theme}-crop.png`, clip: { x: bb.x + bb.width * 0.55, y: bb.y, width: bb.width * 0.45, height: Math.min(bb.height, 520) } });
      expect(String(r.verdict).toLowerCase(), `the crafted ${dir} series did not give a ${dir} call (box: ${r.text})`).toBe(dir);
    } finally { await ctx.close().catch(() => {}); }
  });
}
