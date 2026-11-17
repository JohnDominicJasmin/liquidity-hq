/* RELEASE CELLS F (group run on qa): the cells that need a signed-in fixture. Nothing is written (every settings WRITE is stubbed; the settings READ is the real row, patched in the response only), no paid call leaves the browser (installPaidAiFence + a stub for the one read we want to see).
 *   gh workflow run ci.yml --ref test/group-run-specs -f e2e=true -f base_url=https://liquidity-hq-qa.onrender.com -f project=desktop -f spec=qa/e2e/release-cells-f-2026-11-17.spec.ts
 *   F1  #2466 paid-feature leak: fixture B (FREE) whose saved selection is SMA, SAR, MACD, BOLL -> /arena shows EXACTLY ONE chip pressed (SMA, the first saved), the panel says "Free: 1 at a time", and the Quick read the browser sends names ONE indicator (not Parabolic SAR / MACD / Bollinger). Control: fixture A (PRO) with the same saved list shows all four pressed.
 *   F2  #2419 /research Stablecoin card as Pro (fixture A): the FIGURES show while the AI summary is still loading (the summary request is held 6 s by a stub, the figures request is the real one and costs nothing), then the summary fills in; with the summary request failing (504) the card says it is unavailable and the figures stay
 * Each cell prints its numbers ([CELL] lines). */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';

/* the chart is a canvas: how many indicators it DRAWS is not in the DOM, so the chart component (toolbar + canvas, no account chrome) is shot for the visual check: qa/.shots, uploaded by the dispatch when screenshots=true */
const chartShot = async (page: Page, name: string) => { mkdirSync('qa/.shots', { recursive: true }); await page.locator('.klc-toolbar').first().locator('xpath=..').screenshot({ path: `qa/.shots/${name}.png` }).catch((e) => console.log('[CELL] shot failed ' + String(e).slice(0, 120))); };
const SAVED = ['SMA', 'SAR', 'MACD', 'BOLL'];
const IDS = SAVED;

async function seed(page: Page) {
  await page.route(/\/api\/settings(\?|$)/, async (route) => { if (route.request().method() === 'GET') return route.fallback(); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    const res = await route.fetch(); const body = await res.json().catch(() => null);
    if (body == null) return route.fulfill({ response: res });
    const patch = (r: Record<string, unknown>) => ({ ...r, strategy_selection: SAVED, arena_strategy: null });
    return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(body) ? body.map(patch) : patch(body)) });
  });
}
const pressed = (page: Page) => page.evaluate((ids) => ids.filter((id) => document.querySelector(`[data-testid="strategy-indicator-${id}"]`)?.getAttribute('aria-pressed') === 'true'), IDS);

test.describe('#2466 a Free account never gets a multi-indicator selection', () => {
  test.describe.configure({ timeout: 180_000, retries: 0 });
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('F1 Free fixture B: one chip pressed, "1 at a time", and the Quick read names one indicator; Pro fixture A keeps all four', async ({ browser }) => {
    // FREE
    const ctxB = await signedInContext(browser, 'b', { viewport: { width: 1280, height: 900 } }); const pageB = await ctxB.newPage(); await installPaidAiFence(pageB); await seed(pageB);
    let sent = '';
    await pageB.route(/\/api\/grok(\?|$)/, async (route) => { if (route.request().method() === 'POST') { sent = route.request().postData() ?? ''; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: 'stubbed by QA' }) }); } return route.fallback(); });
    try {
      await gotoSignedIn(pageB, '/arena?coin=btc&tf=1h');
      await expect(pageB.getByTestId('strategy-indicator-SMA')).toBeEnabled({ timeout: 60_000 });   // plan read settled (chips are disabled while it is being read)
      await pageB.waitForTimeout(3_000);
      const on = await pressed(pageB); const limitText = await pageB.locator('.strat-count').first().innerText().catch(() => '');
      await chartShot(pageB, 'f1-free-chart-1280'); console.log(`[CELL] F1 FREE pressed=${JSON.stringify(on)} panelCount="${limitText}"`);
      expect(on, 'a Free account has more than one indicator pressed (paid-feature leak)').toEqual(['SMA']); expect(limitText.toLowerCase()).toContain('1 at a time');
      const quick = pageB.getByRole('button', { name: /quick research/i }).first();
      if (await quick.isEnabled().catch(() => false)) {
        await quick.click(); await expect.poll(() => sent.length, { timeout: 30_000 }).toBeGreaterThan(0);
        const names = { SMA: /\bSMA\b/.test(sent), SAR: /Parabolic SAR|\bSAR\b/i.test(sent), MACD: /\bMACD\b/.test(sent), BOLL: /Bollinger/i.test(sent) };
        console.log(`[CELL] F1 FREE quick request names ${JSON.stringify(names)} (body ${sent.length} bytes)`);
        expect(names.SAR || names.MACD || names.BOLL, 'the Quick read context names a paid indicator for a Free account').toBe(false);
      } else console.log('[CELL] F1 FREE quick button not enabled (usage limit or lock): request-body half NOT measured');
      assertNoUnstubbedPaidAi(pageB, 'F1 free');
    } finally { await ctxB.close(); }
    // PRO control
    const ctxA = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const pageA = await ctxA.newPage(); await installPaidAiFence(pageA); await seed(pageA);
    try {
      await gotoSignedIn(pageA, '/arena?coin=btc&tf=1h'); await expect(pageA.getByTestId('strategy-indicator-SMA')).toBeEnabled({ timeout: 60_000 }); await pageA.waitForTimeout(3_000);
      const onA = await pressed(pageA); await chartShot(pageA, 'f1-pro-chart-1280'); console.log(`[CELL] F1 PRO pressed=${JSON.stringify(onA)}`);
      expect(onA.sort(), 'the Pro control lost its multi-indicator selection').toEqual([...SAVED].sort());
    } finally { await ctxA.close(); }
  });
});

test.describe('#2419 dry-powder figures before the AI summary', () => {
  test.describe.configure({ timeout: 180_000, retries: 0 });
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  const stubSummary = async (page: Page, mode: 'slow' | 'fail', calls: string[]) => page.route(/\/api\/dry-powder/, async (route) => {
    const url = route.request().url(); if (/part=numbers/.test(url)) return route.fallback();                         // the real, free, figures-only request
    calls.push(url);                                                                                                  // any OTHER dry-powder request is the paid AI summary: never let it through
    if (mode === 'slow') { await new Promise((r) => setTimeout(r, 6_000)); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ analysis: 'SIGNAL: BULLISH\nNARRATIVE: QA stub narrative\nKEY_LEVEL: 1.00' }) }); }
    return route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: 'timeout' }) });
  });
  test('F2a figures first, summary after', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); const calls: string[] = []; await stubSummary(page, 'slow', calls);
    try {
      await gotoSignedIn(page, '/research'); const loading = page.getByTestId('dry-powder-analysis-loading'); await expect(loading).toBeVisible({ timeout: 60_000 });
      const t0 = Date.now(); const figuresWhileLoading = await page.evaluate(() => /\$\s?\d/.test((document.body.innerText || '')));
      console.log('[CELL] F2a summary still loading=' + (await loading.isVisible()) + ' figuresVisible=' + figuresWhileLoading + ' summaryRequests=' + calls.length);
      expect(figuresWhileLoading, 'no stablecoin figures on screen while the summary is still loading').toBe(true);
      await expect(page.getByText('QA stub narrative')).toBeVisible({ timeout: 30_000 }); console.log('[CELL] F2a summary arrived after ' + (Date.now() - t0) + ' ms');
    } finally { await ctx.close(); }
  });
  test('F2b summary fails: unavailable line, figures stay', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); const calls: string[] = []; await stubSummary(page, 'fail', calls);
    try {
      await gotoSignedIn(page, '/research'); await expect(page.getByTestId('dry-powder-analysis-unavailable')).toBeVisible({ timeout: 60_000 });
      const figures = await page.evaluate(() => /\$\s?\d/.test((document.body.innerText || ''))); console.log('[CELL] F2b unavailable shown, figuresStillVisible=' + figures); expect(figures, 'the figures disappeared when the summary failed').toBe(true);
    } finally { await ctx.close(); }
  });
});
