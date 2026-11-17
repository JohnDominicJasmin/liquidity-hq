/* #2515 THE AI READ USES THE TRADER'S SAVED INDICATOR SETTINGS (owner 2026-11-17). Pro fixture, /arena?coin=btc 1h, the saved settings stubbed on the settings read (strategy_params), the Quick read's POST to the paid AI route CAPTURED and answered locally (nothing is billed).
 *   gh workflow run ci.yml --ref <branch> -f e2e=true [-f base_url=<url>] -f project=desktop -f "spec=qa/e2e/ai-read-settings-2515.spec.ts"
 *   RS1  defaults: the chart's RSI legend reads RSI(14) and the Quick read's request carries NO RSI / EMA-ribbon override line
 *   RS2  saved RSI length 21 (overbought 70, oversold 30): the chart's RSI legend recomputes to RSI(21) AND the request carries "RSI(21)" with its two lines; the strategy verdict text is the same as in RS1
 *   RS3  saved EMA ribbon e1 = 5: the request carries a ribbon reading that names the changed length (printed, matched loosely); verdict text unchanged
 * The request body is the browser-built prompt (the server forwards it), so it is searched as text. One [AIREAD] JSON line per cell. */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

async function open(browser: Browser, params: Record<string, Record<string, number>>) {
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ }
    const w = window as unknown as { __legend: string[] }; w.__legend = []; const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, mw?: number) { if (/^RSI\(\d+/.test(String(text))) { w.__legend.push(String(text).slice(0, 24)); if (w.__legend.length > 200) w.__legend.splice(0, 100); } return mw === undefined ? orig.call(this, text, x, y) : orig.call(this, text, x, y, mw); };
  });
  const page = await ctx.newPage(); await installPaidAiFence(page);
  const bodies: string[] = [];
  await page.route(/\/api\/grok(\?|$)/, async (route) => {
    const req = route.request(); if (req.method() !== 'POST') return route.fallback();
    bodies.push(req.postData() ?? '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { signal: 'WAIT', confidence: 50, bias: 'NEUTRAL', levels: [], catalysts: [], chartAnalysis: '', patterns: [], waitFor: null, raidSetup: null, raidTarget: null } }) });
  });
  const saved = Object.keys(params).length > 0;
  const patch = (r: Record<string, unknown>) => ({ ...r, arena_strategy: 'ema_stack', strategy_selection: ['SMA'], ...(saved ? { strategy_params: params } : {}) });
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(body) ? body.map(patch) : patch(body)) });
  });
  await page.route(/\/api\/settings(\?|$)/, async (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [], settings: null }) })));
  await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.locator('.strat-panel').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(12_000);
  return { ctx, page, bodies };
}
const legend = (page: Page) => page.evaluate(() => Array.from(new Set((window as unknown as { __legend: string[] }).__legend)));
const verdict = async (page: Page) => ((await page.locator('[data-testid="strategy-call-verdict"]').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
async function quick(page: Page, bodies: string[]) {
  const btn = page.locator('.arena-quick-btn').first(); await expect(btn, 'the top Quick Research button is not there').toBeVisible({ timeout: 30_000 }); await expect(btn).toBeEnabled({ timeout: 30_000 });
  await btn.click(); await expect.poll(() => bodies.length, { timeout: 40_000, message: 'the Quick read made no request' }).toBeGreaterThan(0);
  return bodies[bodies.length - 1];
}

let baseVerdict = '';
test('RS1. defaults: RSI(14) on the chart, no RSI / EMA override lines in the read', async ({ browser }) => {
  test.setTimeout(180_000); const { ctx, page, bodies } = await open(browser, {});
  try {
    const lg = await legend(page); baseVerdict = await verdict(page); const body = await quick(page, bodies);
    const has = { rsiOverride: /RSI\(\d+\)[^"]{0,60}overbought line/i.test(body), ema: /EMA ribbon|EMA\(\d+,\s*\d+,\s*\d+,\s*\d+\)/i.test(body) };
    console.log(`[AIREAD] RS1 legend ${JSON.stringify(lg)} verdict "${baseVerdict}" body ${body.length} chars has ${JSON.stringify(has)}`);
    expect(lg.some((l) => /RSI\(14\)/.test(l)), `the RSI legend should read RSI(14); saw ${JSON.stringify(lg)}`).toBe(true);
    expect(has.rsiOverride, 'a default RSI setting produced an RSI override line in the read').toBe(false); expect(has.ema, 'default EMA lengths produced an EMA override line in the read').toBe(false);
  } finally { await ctx.close(); }
});

test('RS2. saved RSI length 21: chart legend RSI(21), the read states RSI(21), verdict unchanged', async ({ browser }) => {
  test.setTimeout(180_000); const { ctx, page, bodies } = await open(browser, { RSI: { length: 21, overbought: 70, oversold: 30 } });
  try {
    const lg = await legend(page); const v = await verdict(page); const body = await quick(page, bodies);
    const i = body.search(/RSI\(21\)/); console.log(`[AIREAD] RS2 legend ${JSON.stringify(lg)} verdict "${v}" (RS1 "${baseVerdict}") read says: ${i >= 0 ? body.slice(i, i + 140) : '(no RSI(21))'}`);
    expect(lg.some((l) => /RSI\(21\)/.test(l)), `the chart RSI did not recompute to 21; legend ${JSON.stringify(lg)}`).toBe(true);
    expect(i, 'the read does not state RSI(21)').toBeGreaterThanOrEqual(0); expect(/overbought line 70/.test(body) && /oversold line 30/.test(body), 'the RSI line does not name its overbought / oversold lines').toBe(true);
    if (baseVerdict) expect(v, 'the strategy verdict changed with the RSI setting').toBe(baseVerdict);
  } finally { await ctx.close(); }
});

test('RS3. saved EMA ribbon e1 = 5: the read names the changed ribbon, verdict unchanged', async ({ browser }) => {
  test.setTimeout(180_000); const { ctx, page, bodies } = await open(browser, { EMA_RIBBON: { e1: 5, e2: 20, e3: 50, e4: 200 } });
  try {
    const v = await verdict(page); const body = await quick(page, bodies); const m = /EMA[^"]{0,80}\b5\b[^"]{0,80}/i.exec(body);
    console.log(`[AIREAD] RS3 verdict "${v}" (RS1 "${baseVerdict}") ribbon text: ${m ? m[0].slice(0, 160) : '(none found)'}`);
    expect(!!m, 'the read does not mention the changed EMA ribbon length').toBe(true); if (baseVerdict) expect(v, 'the strategy verdict changed with the EMA setting').toBe(baseVerdict);
  } finally { await ctx.close(); }
});
