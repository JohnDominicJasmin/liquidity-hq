/* QA for PR #2821 on a runner build of the PR head (dispatch with no base_url; lives on the test ref only). The live price sockets and the backup price read are stand-ins, so each state is forced; no exchange is involved. Prints [FC] lines and saves shot-2821-*.png at 390 and 1280, light and dark, for PM. */
import { test, expect, type Browser } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!!process.env.E2E_BASE_URL, 'runner build only: forces the feed states of one branch');
test.describe.configure({ timeout: 180_000 });
const TICK = JSON.stringify({ stream: 'x', data: { s: 'BTCUSDT', c: '60000', P: '1.2', h: '61000', l: '59000' } });
const ROWS = JSON.stringify(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].map((symbol) => ({ symbol, lastPrice: '100', priceChangePercent: '1', highPrice: '101', lowPrice: '99' })));
type Mode = 'live' | 'backup' | 'delayed';

async function open(browser: Browser, width: number, theme: string, mode: { now: Mode }, path: string) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await ctx.addInitScript(([t]) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [theme]);
  const page = await ctx.newPage(); await installPaidAiFence(page);
  await page.routeWebSocket(/binance|bybit/i, (ws) => { if (mode.now !== 'live') { ws.close(); return; } ws.send(TICK); const t = setInterval(() => { try { ws.send(TICK); } catch { clearInterval(t); } }, 2_000); ws.onClose(() => clearInterval(t)); });
  await page.route(/\/api\/proxy\?type=binance-24hr/, (r) => (mode.now === 'delayed' ? r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"down"}' }) : r.fulfill({ status: 200, contentType: 'application/json', body: ROWS })));
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  return { ctx, page };
}
const chip = (page: import('@playwright/test').Page) => page.getByTestId('feed-status');
const measure = (page: import('@playwright/test').Page) => page.evaluate(() => { const c = document.querySelector('[data-testid="feed-status"]') as HTMLElement | null; const r = c?.getBoundingClientRect(); return { chip: c ? { state: c.dataset.state, text: c.innerText.replace(/\s+/g, ' '), x: Math.round(r!.x), y: Math.round(r!.y), w: Math.round(r!.width), h: Math.round(r!.height) } : null, region: document.querySelector('[data-testid="feed-status-region"]')?.getBoundingClientRect().height ?? null, scrollWidth: document.documentElement.scrollWidth }; });

for (const width of [390, 1280]) for (const theme of ['dark', 'light']) {
  for (const state of ['live', 'backup', 'delayed'] as const) {
    test(`FC ${state} ${width} ${theme}`, async ({ browser }, info) => {
      const { ctx, page } = await open(browser, width, theme, { now: state }, '/dashboard');
      try {
        if (state === 'live') await page.waitForTimeout(16_000); else await chip(page).waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(2_000);
        const m = await measure(page); console.log(`[FC] ${state} ${width} ${theme}: ${JSON.stringify(m)}`);
        if (state === 'live') expect.soft(m.chip).toBeNull(); else { expect.soft(m.chip?.state).toBe(state); expect.soft(m.chip?.text ?? '').toMatch(state === 'backup' ? /Backup feed/ : /Delayed/); }
        if (state === 'backup') expect.soft(m.chip?.text ?? '').toMatch(/as of \d/);
        expect.soft(m.scrollWidth).toBeLessThanOrEqual(width);
        await page.screenshot({ path: info.outputPath(`shot-2821-${state}-${width}-${theme}.png`) });
      } finally { await ctx.close().catch(() => {}); }
    });
  }
  test(`FC recovery ${width} ${theme}`, async ({ browser }) => {
    const mode: { now: Mode } = { now: 'backup' }; const { ctx, page } = await open(browser, width, theme, mode, '/dashboard');
    try {
      await chip(page).waitFor({ state: 'visible', timeout: 60_000 });
      mode.now = 'live'; await expect.soft(chip(page), 'the chip stays after the live feed returns').toHaveCount(0, { timeout: 90_000 });
      console.log(`[FC] recovery ${width} ${theme}: ${JSON.stringify(await measure(page))}`);
    } finally { await ctx.close().catch(() => {}); }
  });
  test(`FC landing ${width} ${theme}`, async ({ browser }, info) => {
    const { ctx, page } = await open(browser, width, theme, { now: 'live' }, '/');
    try {
      await page.waitForTimeout(14_000); const m = await measure(page); console.log(`[FC] landing ${width} ${theme}: ${JSON.stringify(m)}`);
      expect.soft(m.chip).toBeNull(); expect.soft(m.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`shot-2821-landing-${width}-${theme}.png`) });
    } finally { await ctx.close().catch(() => {}); }
  });
}
