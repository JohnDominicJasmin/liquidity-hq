/* PROD, READ-ONLY, SIGNED OUT (QA, release v2026.11.28 live as main 8888bde): GETs only, every other request from the page is answered by the test, no sign-in, no AI.
 *   Q0 version and health   Q1 changelog entry   Q2 /api/market/rsi answers every coin   Q3 Market Read shows four tiles   Q4 Live Liquidations figures (…, unknown or numbers)
 * Funding per 8 hours is funding-venue-33; the page sweep is nofail-sweep. Label rows are not applied on production yet, so old wording is expected. Prints [Q] lines. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { COINS } from '../../lib/coins';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 300_000, retries: 0 });
async function open(browser: Browser, width: number, written: string[]) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('blocked by the test')); } catch { /* private */ } });
  await ctx.route(/\/(rest\/v1|auth\/v1|api)\//, async (route) => { const r = route.request(); if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback(); written.push(`${r.method()} ${new URL(r.url()).pathname}`); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); });
  const page: Page = await ctx.newPage(); await installPaidAiFence(page);
  return { ctx, page };
}

test('Q0 version and health', async ({ request }) => {
  const v = await (await request.get('/api/version', { timeout: 150_000 })).json() as { commit: string; branch: string };
  const h = await (await request.get('/api/health', { timeout: 150_000 })).json() as Record<string, unknown> & { db_size?: { size_mb: number; percent: number }; exchanges?: Record<string, { degraded?: boolean }> };
  console.log(`[Q] version ${v.commit} ${v.branch}; health ok=${h.ok} db=${h.db_size?.size_mb}MB (${h.db_size?.percent}%) originAuthConfigured=${h.originAuthConfigured} degraded=${Object.entries(h.exchanges ?? {}).filter(([, x]) => x?.degraded).map(([k]) => k).join(',') || 'none'}`);
  expect(v.commit).toBe('8888bde'); expect(h.ok).toBe(true);
});

test('Q1 changelog', async ({ browser }) => {
  const { ctx, page } = await open(browser, 1280, []);
  try {
    await page.goto('/changelog', { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(8_000);
    const first = await page.evaluate(() => (document.querySelector('main ul, main ol')?.querySelector('li') as HTMLElement | null)?.innerText ?? '');
    const lines = first.split('\n').map((x) => x.trim()).filter(Boolean);
    console.log(`[Q] changelog top ${JSON.stringify(lines[0])}, ${lines.length - 1} lines: ${JSON.stringify(lines.slice(1, 4))}…`);
    expect.soft(lines[0]).toBe('27 November 2026'); expect.soft(lines.length - 1).toBe(10);
  } finally { await ctx.close().catch(() => {}); }
});

test('Q2 RSI for every coin', async ({ request }) => {
  const r = await request.get('/api/market/rsi', { timeout: 200_000 }); const j = await r.json() as { rsi?: Record<string, Record<string, number>>; viaFallback?: string[]; stale?: boolean };
  const have = Object.keys(j.rsi ?? {}); const partial = have.filter((c) => Object.keys(j.rsi![c]).length < 5);
  console.log(`[Q] rsi status=${r.status()} answered=${have.length}/${COINS.length} missing=${COINS.filter((c) => !have.includes(c)).join(',') || 'none'} partial=${partial.map((c) => `${c}:${Object.keys(j.rsi![c]).join('/')}`).join(' ') || 'none'} viaFallback=${(j.viaFallback ?? []).join(',') || 'none'} stale=${!!j.stale}`);
  expect.soft(have.length).toBe(COINS.length);
});

for (const width of [390, 1280] as const) {
  test(`Q3 Market Read, ${width}`, async ({ browser }) => {
    const { ctx, page } = await open(browser, width, []);
    try {
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.locator('.mr').first().waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(25_000);
      const m = await page.locator('.mr').first().evaluate((e) => ({ score: (e.querySelector('.mr-score') as HTMLElement | null)?.innerText, verdict: (e.querySelector('.mr-verdict') as HTMLElement | null)?.innerText, tiles: Array.from(e.querySelectorAll('.mr-factor')).map((f) => (f as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 60)) }));
      console.log(`[Q] market read ${width}: ${JSON.stringify(m)}`);
      expect.soft(m.tiles.length).toBe(4); expect.soft(m.tiles.join(' ')).not.toMatch(/wall|NaN|undefined/i);
      await page.locator('.mr').first().screenshot({ path: `qa/.shots/prod1128-market-read-${width}.png` });
    } finally { await ctx.close().catch(() => {}); }
  });
  test(`Q4 Live Liquidations, ${width}`, async ({ browser }) => {
    const { ctx, page } = await open(browser, width, []);
    try {
      await page.goto('/liq', { waitUntil: 'domcontentloaded', timeout: 150_000 }); const stats = page.locator('.liqfeed-stats').first(); await stats.waitFor({ state: 'visible', timeout: 90_000 });
      const read = () => stats.evaluate((e) => Array.from(e.querySelectorAll('.liqfeed-stat')).map((s) => (s as HTMLElement).innerText.replace(/\s+/g, ' ')).join(' | '));
      const early = await read(); await page.waitForTimeout(35_000); const late = await read();
      const rows = await page.locator('[class*="liqfeed-row"], [class*="liqfeed-item"], .liqfeed-list > *').count();
      console.log(`[Q] liquidations ${width}: at load "${early}"; after 35s "${late}"; feed rows=${rows}`);
      expect.soft(late).not.toMatch(/NaN|undefined/);
      await page.screenshot({ path: `qa/.shots/prod1128-liq-${width}.png` });
    } finally { await ctx.close().catch(() => {}); }
  });
}
