/* DIAGNOSTIC for #2732 / K3a + K3b (QA 2026-11-20): with the scanner's universe read failing, K3a / K3b never see a `[data-testid^="scanner-row-"]` row. Dev asked for the state at the 20 s mark: is `scanner-trigger` present, is the list open, any error-boundary text, console errors, page errors, failed requests.
 * Three cells on /arena, signed out, nothing written or billed: D0 CONTROL (only Binance refused, as K1: rows must show), D1 = K3a (all reads held 6 s), D2 = K3b (bybit-tickers 502 + price-backup 502 + Binance refused). Prints the evidence, asserts nothing but that the page loaded. */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const BN_PROXY = /\/api\/proxy\?.*type=(binance-24hr|binance-futures-24hr|premium-index)/;
const rowsCount = (page: Page) => page.evaluate(() => document.querySelectorAll('[data-testid^="scanner-row-"]').length);

async function diag(label: string, setup: (ctx: BrowserContext) => Promise<void>, browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await setup(ctx);
  const page = await ctx.newPage();
  const errs: string[] = []; const failed: string[] = []; const proxyTypes: Record<string, string> = {};
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message).slice(0, 200)));
  page.on('requestfailed', (r) => failed.push(`${r.method()} ${r.url().slice(0, 110)} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => { const u = r.url(); if (/\/api\/(proxy|market\/price-backup)/.test(u) && r.status() >= 400) proxyTypes[(/type=([\w-]+)/.exec(u)?.[1] ?? 'backup') + ' ' + r.status()] = u.slice(0, 90); });
  try {
    await page.goto('/arena', { waitUntil: 'domcontentloaded' });
    const trig = page.getByTestId('scanner-trigger');
    const trigVisible = await trig.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false);
    const rows0 = await rowsCount(page);
    if (trigVisible && rows0 === 0) await trig.locator('div').first().click().catch((e) => errs.push('CLICK ' + String(e.message).slice(0, 120)));
    const marks: string[] = [];
    for (const s of [2, 8, 15, 22, 30]) { await page.waitForTimeout((s - (marks.length ? Number(marks[marks.length - 1].split('s')[0]) : 0)) * 1000); marks.push(`${s}s:${await rowsCount(page)}`); }
    const info = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="scanner-trigger"]') as HTMLElement | null;
      const text = (document.body.innerText || '').replace(/\s+/g, ' ');
      return { trigger: !!t, triggerText: (t?.innerText || '').replace(/\s+/g, ' ').slice(0, 100), triggerAria: t?.getAttribute('aria-expanded') ?? null, errorBoundary: /something went wrong|application error|unexpected error/i.test(text), bodyLen: text.length, sample: text.slice(0, 260), alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((e) => (e as HTMLElement).innerText.slice(0, 80)) };
    });
    console.log(`[K3D] ${label}: trigger visible ${trigVisible} · rows at marks ${marks.join(' ')} · ${JSON.stringify(info)}`);
    console.log(`[K3D] ${label}: console/page errors ${JSON.stringify(errs.slice(0, 8))} · failed requests ${JSON.stringify(failed.slice(0, 6))} · 4xx/5xx proxy ${JSON.stringify(proxyTypes)}`);
    await page.screenshot({ path: `qa/.shots/k3d-${label}.png` }).catch(() => {});
    expect(trigVisible, 'the scanner trigger never appeared').toBe(true);
  } finally { await ctx.close().catch(() => {}); }
}

test.describe('K3 diagnostic', () => {
  test('D0 control: only Binance refused (as K1)', async ({ browser }) => {
    test.setTimeout(150_000);
    await diag('D0-control', async (ctx) => { await ctx.route(BN_PROXY, (route) => route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' })); await ctx.routeWebSocket(/binance\.com/, (ws) => { ws.close(); }); }, browser);
  });
  test('D1 K3a setup: every proxy read held 6 s, Binance sockets closed', async ({ browser }) => {
    test.setTimeout(150_000);
    await diag('D1-K3a', async (ctx) => { await ctx.route(/\/api\/proxy\?.*type=(binance-24hr|binance-futures-24hr|premium-index|bybit-tickers)/, async (route) => { await new Promise((r) => setTimeout(r, 6_000)); await route.continue(); }); await ctx.routeWebSocket(/binance\.com/, (ws) => { ws.close(); }); }, browser);
  });
  test('D2 K3b setup: bybit-tickers 502 + price-backup 502 + Binance refused', async ({ browser }) => {
    test.setTimeout(150_000);
    await diag('D2-K3b', async (ctx) => {
      await ctx.route(BN_PROXY, (route) => route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"rate limited"}' }));
      await ctx.routeWebSocket(/binance\.com/, (ws) => { ws.close(); });
      await ctx.route(/\/api\/proxy\?.*type=bybit-tickers/, (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"down"}' }));
      await ctx.route(/\/api\/market\/price-backup/, (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"down"}' }));
    }, browser);
  });
});
