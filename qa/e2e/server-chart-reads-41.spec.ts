/* QA #1263 item 41 on qa with GROK_SERVER_CHART=1. TWO BILLED READS, approved by PM 2026-11-25: one Quick, one Deep, no retry. Opt-in by E2E_ALLOW_BILLED_CALLS=1.
 * The page's own request is let through once per mode with its CHART HALF REPLACED (every price halved, every volume 123.45M): if the server builds the chart itself, the answer talks about the real market; if it used the
 * browser's, the answer talks about the halved one. Prints the page's real chart figures, the whole answer, and every other AI request is refused. */
import { test, expect } from '@playwright/test';
import { AUTH_READY, BILLED_CALLS_READY, BILLED_CALLS_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL?.includes('liquidity-hq-qa'), 'qa only: the switch is on there and nowhere else');
test.describe.configure({ retries: 0, timeout: 600_000 });
type Chart = { tf: string; ema9: number | null; sma200: number | null; rsi: number | null; recent20: string; hi: number; lo: number; lastClose: number; detectedPatterns?: string };

test('R41 one Quick and one Deep read', async ({ browser }) => {
  test.skip(!BILLED_CALLS_READY, BILLED_CALLS_SKIP_REASON);
  test.skip(!AUTH_READY, 'no fixtures on this host');
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
  const left: Record<string, number> = { quick: 1, deep: 1 }; const sent: Array<{ type: string; chart: Chart }> = []; let refused = 0;
  try {
    await installPaidAiFence(page);
    await page.route(/\/api\/grok(\?|$)/, async (route) => {
      const req = route.request(); if (req.method() !== 'POST') { await route.fallback(); return; }
      const body = req.postDataJSON() as { type?: string; chart?: Chart; context?: unknown };
      const type = String(body.type ?? '');
      if (!body.chart || !(left[type] > 0)) { refused++; console.log(`[R41] refused a request: type=${type} keys=${Object.keys(body).join(',')}`); await route.abort(); return; }
      left[type]--; const real = body.chart; sent.push({ type, chart: real });
      const half = (n: number | null) => (n == null ? n : n / 2);
      const fake: Chart = { tf: real.tf, ema9: half(real.ema9), sma200: half(real.sma200), rsi: real.rsi, hi: real.hi / 2, lo: real.lo / 2, lastClose: real.lastClose / 2,
        recent20: real.recent20.replace(/([OHLC]):([\d.]+)/g, (_m, k: string, v: string) => `${k}:${(Number(v) / 2).toFixed(2)}`).replace(/V:[\d.]+[KM]?/g, 'V:123.45M') };
      await route.continue({ postData: JSON.stringify({ ...body, chart: fake }) });
    });
    await gotoSignedIn(page, '/arena?coin=btc'); await page.waitForTimeout(20_000);
    for (const [type, name] of [['quick', /^\s*quick research/i], ['deep', /^\s*deep research/i]] as const) {
      const button = page.getByRole('button', { name }).first();
      await expect(button).toBeEnabled({ timeout: 90_000 });
      const answer = page.waitForResponse((r) => /\/api\/grok(\?|$)/.test(r.url()) && r.request().method() === 'POST', { timeout: 240_000 });
      await button.click();
      const r = await answer; const text = await r.text();
      const c = sent.at(-1)?.chart;
      console.log(`[R41] ${new Date().toISOString()} ${type}: HTTP ${r.status()}; page chart tf=${c?.tf} lastClose=${c?.lastClose} hi=${c?.hi} lo=${c?.lo} ema9=${c?.ema9} sma200=${c?.sma200}`);
      console.log(`[R41] ${type} last 3 candles on the page: ${c?.recent20.split(' | ').slice(-3).join(' | ')}`);
      for (let i = 0; i < Math.min(text.length, 6000); i += 700) console.log(`[R41] ${type} answer ${i / 700}: ${text.slice(i, i + 700).replace(/\s+/g, ' ')}`);
      await page.waitForTimeout(8_000);
    }
    console.log(`[R41] reads sent=${sent.map((s) => s.type).join(',')} refused=${refused}`);
  } finally { await ctx.close().catch(() => {}); }
});
