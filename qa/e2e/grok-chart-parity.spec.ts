/* #2280 (#1605): the chart object the SERVER would build from candles (chartFromCandles) equals the one the BROWSER sends, over the SAME candles. No flag, no billed call:
 * fixture A signed in, every AI call stubbed behind the paid-AI fence (the /api/grok POST is captured and answered with a fixture, never forwarded), the klines stubbed
 * with a deterministic varied series, so the browser's readMarket and the server's chartFromCandles read identical input.
 *   G1  tf 15m (the Arena default) and 1h: ema9, sma200, rsi, hi, lo, recent20 and tf agree exactly (the series carries no spot/futures basis, so "within a basis" is 0)
 *   G2  CONTROL: the comparison can fail - a series with one altered candle changes at least one field
 * The comparison is only meaningful if the browser's POST really carried a chart: a missing body.chart fails the cell instead of passing it. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { chartFromCandles } from '../../lib/arenaChartServer';

const N = 320;
const BASE_T = 1_760_000_000_000;
const series = (alter = false) => Array.from({ length: N }, (_, i) => {
  const base = 100 + Math.sin(i / 9) * 6 + i * 0.04 + (alter && i === N - 5 ? 7 : 0);
  const o = base, c = base + Math.cos(i / 5) * 0.8, h = Math.max(o, c) + 0.9 + (i % 3) * 0.1, l = Math.min(o, c) - 0.9 - (i % 4) * 0.1, v = 500 + (i * 37) % 900;
  return { t: BASE_T + i * 900_000, o, h, l, c, v };
});
const asKlines = (s: ReturnType<typeof series>) => s.map(b => [b.t, String(b.o), String(b.h), String(b.l), String(b.c), String(b.v), b.t + 899_999, '0', 0, '0', '0', '0']);
const asOhlcv = (s: ReturnType<typeof series>) => s.map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));

async function browserChart(page: Page, tf: string, alter: boolean): Promise<Record<string, unknown> | null> {
  const posts: Array<Record<string, unknown>> = [];
  await installPaidAiFence(page);
  await page.route('**/api/grok', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usage: null }) });
    posts.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usage: { quick_used: 1, quick_limit: 50, deep_used: 0, deep_limit: 20 }, result: { signal: 'FLAT', confidence: 50, entryLow: null, entryHigh: null, tp: null, sl: null, levels: [], chartAnalysis: 'f', patterns: [], reasoning: 'f', catalysts: [], waitFor: null, bias: 'NEUTRAL', raidSetup: null, raidTarget: null, raidTrigger: null, analyzedAt: Date.now(), tf, session: 'London' } }) });
  });
  await page.route('**/api/grok-chat', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'stub', followUps: [], citations: [], _usage: null }) }));
  await page.route('**/api/market/klines**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(asKlines(series(alter))) }));
  await gotoSignedIn(page, `/arena?coin=btc&tf=${tf}`);
  const quick = page.getByRole('button', { name: 'QUICK', exact: true }); await expect(quick).toBeVisible({ timeout: 20_000 }); await quick.click();
  await expect.poll(() => posts.length, { timeout: 30_000, message: 'QUICK never reached the stubbed /api/grok: nothing measured' }).toBeGreaterThan(0);
  return (posts[0].chart as Record<string, unknown>) ?? null;
}
const FIELDS = ['tf', 'ema9', 'sma200', 'rsi', 'hi', 'lo', 'recent20'] as const;
const close = (a: unknown, b: unknown) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9) : a === b;

test.describe('#2280 server chart parity (no flag, no billed call)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 150_000 });

  for (const tf of ['15m', '1h']) {
    test(`G1. browser chart equals chartFromCandles over the same candles at ${tf}`, async ({ browser }) => {
      const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage();
      try {
        const b = await browserChart(page, tf, false);
        expect(b, 'the browser POST carried no chart object: nothing to compare').not.toBeNull();
        const s = chartFromCandles(tf, asOhlcv(series(false))) as unknown as Record<string, unknown> | null;
        expect(s, 'chartFromCandles returned null for 320 candles').not.toBeNull();
        const diffs = FIELDS.filter(k => !close(b![k], s![k])).map(k => `${k}: browser=${JSON.stringify(b![k])?.slice(0, 120)} server=${JSON.stringify(s![k])?.slice(0, 120)}`);
        console.log(`[G1] ${tf} diffs=${JSON.stringify(diffs)} browser ema9=${b!.ema9} rsi=${b!.rsi} hi=${b!.hi} lo=${b!.lo}`);
        expect(diffs, `browser and server charts differ at ${tf}`).toEqual([]);
      } finally { await ctx.close(); }
    });
  }

  test('G2. CONTROL: one altered candle makes the server chart differ from the browser chart', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage();
    try {
      const b = await browserChart(page, '15m', false);
      expect(b).not.toBeNull();
      const s = chartFromCandles('15m', asOhlcv(series(true))) as unknown as Record<string, unknown>;
      expect(FIELDS.some(k => !close(b![k], s[k])), 'an altered series produced an identical chart: the comparison cannot fail').toBe(true);
    } finally { await ctx.close(); }
  });
});
