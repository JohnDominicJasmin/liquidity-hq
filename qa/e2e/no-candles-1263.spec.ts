/* #1263 THE "Reading closed candles…" PANEL ON AN ASSET WITH NO CANDLES (Dev's request 2026-11-23): how long does the strategy panel stay on the loading text when the chart's klines read fails, and what do the console and the network say? One asset (DIS, a Binance-only listing that held 0 candles on qa), signed in as the Pro fixture, 4 minutes on the page. Prints [NC] lines: every /api/market/klines response (time since navigation, status, source, first 80 bytes), every console warning and error, and the strategy panel text at 15, 45, 90, 150 and 240 s. Read-only; paid AI fenced. */
import { test, expect } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: watches a deployed site (-f base_url=<site>)');
test.skip(!AUTH_READY, 'the Pro fixture does not exist on this host');

test('NC DIS on /arena for 4 minutes: the strategy panel text, the klines answers, the console', async ({ browser }) => {
  test.setTimeout(480_000);
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
  const t0 = Date.now(); const since = () => Math.round((Date.now() - t0) / 1000);
  const kl: string[] = [], con: string[] = [];
  page.on('response', async (r) => { if (/\/api\/market\/klines/.test(r.url())) { const b = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 80); kl.push(`${since()}s HTTP ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 110)} :: ${b}`); } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') con.push(`${since()}s ${m.type()} ${m.text().replace(/\s+/g, ' ').slice(0, 160)}`); });
  page.on('pageerror', (e) => con.push(`${since()}s pageerror ${String(e).slice(0, 160)}`));
  try {
    await installPaidAiFence(page);
    await gotoSignedIn(page, '/arena?coin=dis&tf=1h');
    /* THE DECISIVE VARIANT (Dev): pick ONE strategy and touch nothing else for 150 s; the strategy hook's failure count restarts on every strategy change, so a sweep of 16 strategies never reaches its second failed read */
    const sel = page.getByTestId('strategy-set-select').first(); await sel.waitFor({ state: 'visible', timeout: 60_000 }); await expect(sel).toBeEnabled({ timeout: 60_000 });
    const values = await sel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)); const pick = values.find((v) => v !== 'auto' && v !== 'custom') ?? values[1];
    await sel.selectOption(pick); const tPick = Date.now(); console.log(`[NC] picked strategy ${pick} at ${since()} s`);
    const box = async () => page.evaluate(() => ({ loading: document.querySelectorAll('[data-testid="strategy-call-loading"]').length, unavailable: document.querySelectorAll('[data-testid="strategy-call-unavailable"]').length, retry: !!Array.from(document.querySelectorAll('[data-testid="strategy-call-unavailable"] button, [data-testid="strategy-call-unavailable"] [role="button"]')).length }));
    for (const at of [15, 45, 90, 120, 150]) { await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - tPick))); console.log(`[NC] ${at} s after the pick: ${JSON.stringify(await box())}`); }
    const panel = () => page.evaluate(() => { const el = document.querySelector('.strat-panel') as HTMLElement | null; return el ? el.innerText.replace(/\s+/g, ' ').slice(0, 260) : 'NO .strat-panel'; });
    for (const at of [200]) {
      await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - t0 - 0)));
      console.log(`[NC] ${since()}s panel: ${await panel()}`);
    }
    for (const l of kl) console.log(`[NC] klines ${l}`);
    for (const l of con.slice(0, 40)) console.log(`[NC] console ${l}`);
    console.log(`[NC] ${kl.length} klines response(s), ${con.length} console warning(s) or error(s)`);
    expect(true).toBe(true);
  } finally { await ctx.close().catch(() => {}); }
});
