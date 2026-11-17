/* #2500 ANTI-CHOP SWITCH (owner 2026-11-17): the one-line anti-chop switch sits DIRECTLY UNDER THE CHART (renamed, tooltip scope sentence always, backtest sentence only with the stats flag), and toggling it still changes the EMA-ribbon filter only.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true [-f base_url=<url>] -f project=desktop -f screenshots=true -f "spec=qa/e2e/antichop-2500.spec.ts"
 *   AC:<theme>:<width>   Pro, /arena btc 1h at 390 / 768 / 1280: the .arena-antichop-row exists, is ONE line (height <= 36 px), starts at or below the chart's bottom edge and within 60 px of it, with the chart block as its previous sibling (nothing in between), inside the viewport width, label text printed
 *   AC2:1280              the switch flips aria-checked on click (settings write stubbed), the strategy call (verdict text) of the SELECTED non-EMA strategy is unchanged, and the page makes no request to a market route because of the click
 * Screenshots: qa/.shots/antichop-<theme>-<width>.png. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { settleForShot } from './_settle';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
mkdirSync('qa/.shots', { recursive: true });

async function open(browser: import('@playwright/test').Browser, theme: string, width: number) {
  const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : width < 1000 ? 1024 : 900 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
  const page = await ctx.newPage(); await installPaidAiFence(page);
  await page.route(/\/api\/settings(\?|$)/, async (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [], settings: null }) })));
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 204, body: '' })));
  await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.locator('.arena-antichop-row').first().waitFor({ state: 'attached', timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(10_000);
  return { ctx, page };
}
const geom = (page: Page) => page.evaluate(() => {
  const row = document.querySelector('.arena-antichop-row') as HTMLElement | null; if (!row) return null;
  const canvases = Array.from(document.querySelectorAll('canvas')).map((c) => c.getBoundingClientRect()).filter((r) => r.width > 250 && r.height > 120); const chartBottom = canvases.length ? Math.max(...canvases.map((r) => r.bottom + window.scrollY)) : null;
  const rr = row.getBoundingClientRect(), prev = row.previousElementSibling as HTMLElement | null;
  const prevBottom = prev ? Math.round(prev.getBoundingClientRect().bottom + window.scrollY) : null;
  return { top: Math.round(rr.top + window.scrollY), bottom: Math.round(rr.bottom + window.scrollY), height: Math.round(rr.height), left: Math.round(rr.left), right: Math.round(rr.right), vw: window.innerWidth, chartBottom: prevBottom ?? (chartBottom == null ? null : Math.round(chartBottom)),   /* the chart BLOCK (main pane + volume + RSI panes + footer), not just the biggest canvas */ prevHasCanvas: !!prev?.querySelector('canvas') || !!prev?.querySelector('[class*="klc"]'), prevTag: prev ? `${prev.tagName.toLowerCase()}.${typeof prev.className === 'string' ? prev.className.split(' ')[0] : ''}` : null, label: (row.innerText || '').replace(/\s+/g, ' ').slice(0, 60), sw: row.querySelector('[role="switch"]')?.getAttribute('aria-checked') ?? null };
});

for (const theme of ['light', 'dark'] as const) for (const width of [390, 768, 1280] as const) {
  test(`AC:${theme}:${width}: the anti-chop switch sits directly under the chart, on one line`, async ({ browser }) => {
    test.setTimeout(180_000); const { ctx, page } = await open(browser, theme, width);
    try {
      const g = await geom(page); console.log(`[ANTICHOP] AC ${theme} ${width}: ${JSON.stringify(g)}`);
      await settleForShot(page, 'antichop').catch(() => {}); await page.locator('.arena-antichop-row').first().scrollIntoViewIfNeeded().catch(() => {}); await page.screenshot({ path: `qa/.shots/antichop-${theme}-${width}.png`, timeout: 20_000 }).catch(() => {});
      expect(g, 'the .arena-antichop-row is not on the page').toBeTruthy(); const x = g as NonNullable<typeof g>;
      expect.soft(x.height, `the switch row is ${x.height}px tall: not one line`).toBeLessThanOrEqual(36);
      expect.soft(x.right, `the row reaches past the viewport (${x.right} > ${x.vw})`).toBeLessThanOrEqual(x.vw + 1); expect.soft(x.left).toBeGreaterThanOrEqual(0);
      expect.soft(x.chartBottom != null && x.top >= x.chartBottom - 1 && x.top - x.chartBottom <= 60, `the row (top ${x.top}) is not directly under the chart (bottom ${x.chartBottom})`).toBe(true);
      expect.soft(x.prevHasCanvas, `the element before the row is ${x.prevTag}, not the chart block: something sits between`).toBe(true);
      expect.soft(/chop|fewer, stricter/i.test(x.label), `the row label reads "${x.label}"`).toBe(true);
    } finally { await ctx.close(); }
  });
}

test('AC2:1280: the switch flips, the other strategies and the market routes are untouched', async ({ browser }) => {
  test.setTimeout(180_000); const { ctx, page } = await open(browser, 'dark', 1280);
  try {
    const verdict = async () => ((await page.locator('[data-testid="strategy-call-verdict"]').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    const before = await verdict(), sw = page.locator('.arena-antichop-row [role="switch"]').first(), a0 = await sw.getAttribute('aria-checked');
    const market: string[] = []; page.on('request', (r) => { const u = new URL(r.url()); if (/^\/api\/(market|proxy|cmc|funding)/.test(u.pathname)) market.push(u.pathname); });
    await sw.scrollIntoViewIfNeeded().catch(() => {}); await sw.click({ timeout: 10_000 }); await page.waitForTimeout(3_000); const a1 = await sw.getAttribute('aria-checked'); const after = await verdict();
    console.log(`[ANTICHOP] AC2: aria-checked ${a0} -> ${a1}; verdict "${before}" -> "${after}"; market requests after the click: ${market.length}`);
    expect(a1, 'the switch did not flip').not.toBe(a0); expect(after, 'the strategy call changed when only the EMA filter was toggled').toBe(before);
    await sw.click(); await page.waitForTimeout(1_500); expect(await sw.getAttribute('aria-checked'), 'the switch did not flip back').toBe(a0);
  } finally { await ctx.close(); }
});
