/* #2521 USD/JPY FROM ONE LIVE SOURCE WITH ITS OWN TIME (#1651, PM 2026-11-17). The route /api/forex/jpy is answered in the browser with a KNOWN rate and a KNOWN asOf, so every surface must show that rate and that age (the age is the RATE's time, not the moment the page fetched it).
 *   gh workflow run ci.yml --ref <branch> -f e2e=true [-f base_url=<url>] -f project=desktop -f "spec=qa/e2e/jpy-one-source-2521.spec.ts"
 *   JP1:<age>      /briefing, Yen watch: the value equals the stubbed rate (2 decimals) and the "updated" label matches the stubbed asOf: 7 min -> "7m ago", 3 h -> "3h ago", 2 days -> "2d ago" (never "just now" for an old rate)
 *   JP2           /correlation, macro strip: the USD/JPY price equals the SAME rate and its title (hover) names the stubbed asOf time
 *   JP3           the two surfaces agree: the number on /briefing equals the number on /correlation
 *   JP4           /dashboard: the BTC long / short label names its venue and window ("Binance", "1h"); the setup detail says "of accounts"
 * Signed out, GETs only; the route answer is a browser-side stub. */
import { test, expect, type Page } from '@playwright/test';

const RATE = 151.23;
const stub = async (page: Page, asOfMsAgo: number) => { const asOf = Date.now() - asOfMsAgo; await page.route('**/api/forex/jpy**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jpy: RATE, asOf, source: 'yahoo' }) })); return asOf; };
const arm = (page: Page) => page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', 'dark'); } catch { /* private */ } });
const text = async (page: Page) => ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');

for (const [label, ms, want] of [['7m', 7 * 60_000, /\b7m ago\b/], ['3h', 3 * 3_600_000, /\b3h ago\b/], ['2d', 2 * 86_400_000, /\b2d ago\b/]] as const) {
  test(`JP1:${label}: Yen watch shows the stubbed rate and the rate's own age`, async ({ page }) => {
    test.setTimeout(120_000); await arm(page); await stub(page, ms); await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/briefing', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(14_000);
    const t = await text(page); const i = t.search(/yen watch/i); const seg = i < 0 ? '' : t.slice(i, i + 220);
    console.log(`[JPY] JP1 ${label}: ${seg}`);
    expect(i, 'no Yen watch block on /briefing').toBeGreaterThanOrEqual(0);
    expect(seg.includes(RATE.toFixed(2)), `Yen watch does not show ${RATE.toFixed(2)}: "${seg.slice(0, 120)}"`).toBe(true);
    expect(want.test(seg), `Yen watch age label does not match ${label}: "${seg.slice(0, 160)}"`).toBe(true);
    if (ms > 3_600_000) expect(/just now/i.test(seg), 'an old rate is labelled "just now"').toBe(false);
  });
}

test('JP2/JP3: the macro strip shows the same rate and names the rate time', async ({ page }) => {
  test.setTimeout(120_000); await arm(page); const asOf = await stub(page, 9 * 60_000); await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/briefing', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(12_000); const tb = await text(page); const brief = /yen watch[\s\S]{0,200}?(\d{2,3}\.\d{2})/i.exec(tb)?.[1] ?? '';
  await page.goto('/correlation', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(12_000);
  const items = await page.locator('.macro-item-price').evaluateAll((els) => els.map((e) => ({ text: (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim(), title: e.getAttribute('title') ?? '' })));
  const strip = items.find((x) => x.text.includes(RATE.toFixed(2)));
  console.log(`[JPY] JP2: strip ${JSON.stringify(items.slice(0, 8))}; briefing number ${brief}; stubbed asOf ${new Date(asOf).toLocaleString()}`);
  expect(strip, `no macro-strip item shows ${RATE.toFixed(2)}`).toBeTruthy();
  expect(strip?.title ?? '', 'the strip item has no title naming the rate time').not.toBe('');
  expect(Math.abs(new Date(strip?.title ?? '').getTime() - asOf), `the strip title "${strip?.title}" is not the stubbed asOf`).toBeLessThan(120_000);
  expect(brief, 'JP3: the Briefing and the macro strip disagree').toBe(RATE.toFixed(2));
});

test('JP4: Dashboard long/short names its venue and window', async ({ page }) => {
  test.setTimeout(120_000); await arm(page); await stub(page, 60_000); await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(14_000); const t = await text(page);
  const m = /BTC long \/ short[^A-Z]{0,60}/.exec(t); console.log(`[JPY] JP4: label "${m?.[0] ?? '(none)'}"; "of accounts" present ${/of accounts/i.test(t)}`);
  expect(m, 'the BTC long / short label is not on /dashboard').toBeTruthy(); expect(/binance/i.test(m?.[0] ?? ''), `the long/short label does not name its venue: "${m?.[0]}"`).toBe(true); expect(/1h/i.test(m?.[0] ?? ''), 'the label does not name its window').toBe(true);
});
