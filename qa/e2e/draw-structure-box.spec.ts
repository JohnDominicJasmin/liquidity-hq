/* #1263 L103 / L104 / L105: THE DRAW STRUCTURE RISK BOX (Channel strategy), on staging (= prod code), Pro fixture, the paid AI fenced, the candle feeds served from QA's SYNTHETIC CHANNEL FIXTURES (qa/fixtures/channelCandles.ts: price is a triangle wave between two exact rails, so the rails, the breakout close and the last swing are arithmetic, not the app's output).
 *   falling channel + breakout UP     -> a live BUY: the box (Target / Entry / Stop, R:R) is drawn
 *   rising channel  + breakout DOWN   -> a live SELL: the box is drawn
 *   falling channel + NO breakout     -> WAIT: channel and zones only, NO box
 * Per case at 390 (dark and light) and 1280 (dark): pick Channel in the strategy menu at 4h, click Draw Structure, shoot the chart. Measured / asserted:
 *   - the call (BUY / SELL / WAIT) is the oracle's verdict, and its stop ("Wrong if beyond") equals the fixture's last swing inside the channel (0.1 %)
 *   - CLS across the click that draws the box (shifts right after input counted) <= 0.1
 *   - no arrow / predicted-path element in the DOM (the box is canvas; the page has no svg/arrow overlay with "arrow" or "predict" in its class or test id)
 *   - the caption "Levels from the Channel strategy, not a prediction." is on the page when a box is drawn (printed whether it is)
 * The chart is a canvas: whether T / E / S and the price axis are readable is judged from the shots (qa/.shots/ds-*). Prints [DS] lines. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { channelCandles, channelCall, type ChannelSpec } from '../fixtures/channelCandles';

mkdirSync('qa/.shots', { recursive: true });
test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const TF = 4 * 3_600_000;
const CASES: Array<{ id: string; spec: ChannelSpec; dir: 'falling' | 'rising'; verdict: 'BUY' | 'SELL' | 'WAIT' }> = [
  { id: 'falling-up', spec: { dir: 'falling', breakout: 'up', tf: TF, t0: Date.now() - 130 * TF }, dir: 'falling', verdict: 'BUY' },
  { id: 'rising-down', spec: { dir: 'rising', breakout: 'down', tf: TF, t0: Date.now() - 130 * TF }, dir: 'rising', verdict: 'SELL' },
  { id: 'falling-none', spec: { dir: 'falling', breakout: 'none', tf: TF, t0: Date.now() - 130 * TF }, dir: 'falling', verdict: 'WAIT' },
];
const VARIANTS = [{ w: 390, h: 844, theme: 'dark' }, { w: 390, h: 844, theme: 'light' }, { w: 1280, h: 900, theme: 'dark' }] as const;

async function serve(page: Page, fxCandles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume?: number }>) {
  const rows = fxCandles; const lim = (u: string) => Number(new URL(u).searchParams.get('limit') ?? '300');
  await page.route('**/api/market/klines**', (r) => {
    const u = new URL(r.request().url()), n = rows.slice(-Math.min(lim(r.request().url()), rows.length));
    const body = u.searchParams.get('source') === 'bybit'
      ? { retCode: 0, retMsg: 'OK', result: { list: n.slice().reverse().map((k) => [String(k.timestamp), String(k.open), String(k.high), String(k.low), String(k.close), String(k.volume ?? 0), "0"]) } }
      : n.map((k) => [k.timestamp, String(k.open), String(k.high), String(k.low), String(k.close), String(k.volume ?? 0)]);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

for (const c of CASES) for (const v of VARIANTS) {
  test(`DS ${c.id} ${v.w} ${v.theme}: the risk box vs the oracle (${c.verdict})`, async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = channelCandles(c.spec); const oracle = channelCall(fx, c.dir, []);
    const ctx = await signedInContext(browser, 'a', { viewport: { width: v.w, height: v.h } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t as string); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, v.theme);
    const page = await ctx.newPage(); await installPaidAiFence(page); await serve(page, fx.candles);
    await page.route(/\/api\/settings(\?|$)/, async (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [] }) })));
    await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => { if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' }); return route.fallback(); });
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=4h');
      const sel = page.getByTestId('strategy-set-select').first(); await sel.waitFor({ state: 'visible', timeout: 60_000 }); await expect(sel).toBeEnabled({ timeout: 90_000 }); await page.waitForTimeout(5_000);
      await sel.selectOption('channel', { timeout: 20_000 }); await page.waitForTimeout(5_000);
      const call = await page.evaluate(() => { const b = document.querySelector('[data-testid="strategy-call-box"]') as HTMLElement | null; const v = document.querySelector('[data-testid="strategy-call-verdict"]') as HTMLElement | null; return { text: (b?.innerText || '').replace(/\s+/g, ' ').slice(0, 260), verdict: (v?.dataset.verdict || v?.innerText || '').toUpperCase() }; });
      await page.evaluate(() => { const w = window as unknown as { __ls: number[] }; w.__ls = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ value: number }>) w.__ls.push(e.value); }).observe({ type: 'layout-shift', buffered: false }); } catch { /* unsupported */ } });
      const btn = page.getByRole('button', { name: /draw structure/i }).first(); const have = await btn.count(); expect(have, 'no Draw Structure button').toBeGreaterThan(0);
      await btn.click(); await page.waitForTimeout(9_000);
      const after = await page.evaluate(() => { const w = window as unknown as { __ls: number[] }; const body = (document.body.innerText || '').replace(/\s+/g, ' '); const arrowEls = Array.from(document.querySelectorAll('[class*="arrow" i], [data-testid*="arrow" i], [class*="predict" i], [data-testid*="predict" i], [class*="path" i][class*="predict" i]')).filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0 && !/chevron|tnav|nav|menu|select|caret|dropdown/i.test(String((e as HTMLElement).className) + String((e as HTMLElement).dataset.testid)); }).map((e) => `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).split(/\s+/)[0]}`); return { cls: (w.__ls || []).reduce((a, b) => a + b, 0), caption: /levels from the channel strategy, not a prediction/i.test(body), arrowEls: arrowEls.slice(0, 5), notDrawable: /couldn.t draw|cannot draw|nothing to draw|undrawable/i.test(body) }; });
      const m = /Wrong if beyond \$([\d,]+(?:\.\d+)?)/.exec(call.text); const stop = m ? Number(m[1].replace(/,/g, '')) : null;
      console.log(`[DS] ${c.id} ${v.w} ${v.theme}: oracle ${oracle.verdict}${oracle.entry ? ` entry ${oracle.entry.toFixed(2)} stop ${oracle.stop?.toFixed(2)}` : ''} · app verdict ${call.verdict} "${call.text.slice(0, 150)}" · stop read ${stop} · CLS across Draw Structure ${after.cls.toFixed(4)} · caption on page ${after.caption} · arrow-like elements ${JSON.stringify(after.arrowEls)} · undrawable ${after.notDrawable}`);
      await page.screenshot({ path: `qa/.shots/ds-${c.id}-${v.w}-${v.theme}.png` }).catch(() => {});
      expect(call.verdict, `${c.id}: the app's call is not the oracle's`).toBe(c.verdict);
      if (oracle.stop != null && stop != null) expect(Math.abs(stop - oracle.stop) / oracle.stop, `${c.id}: the stop ${stop} is not the last swing inside the channel ${oracle.stop}`).toBeLessThan(0.001);
      expect(after.cls, `${c.id}: layout shift when the box appears: ${after.cls.toFixed(4)}`).toBeLessThanOrEqual(0.1);
      expect(after.arrowEls, `${c.id}: an arrow / predicted-path element is on the page`).toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}
