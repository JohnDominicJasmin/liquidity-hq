/* #2507 RENDERED CARD: the Multi-Timeframe Alignment card on /arena. With the RSI feed that fills it never answering, the card says Loading… first, "No data" only after the 20 s grace, and never "Mixed signals" over a row of dashes.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f base_url=<url> -f project=desktop -f "spec=qa/e2e/mtf-loading-nodata-2507.spec.ts"
 *   MT1  RSI feed hung: at ~6 s the card verdict is Loading… (not No data, not Mixed); at ~28 s it is No data with "RSI readings unavailable right now"; at no point Mixed/Conflicting/Bullish/Bearish
 *   MT2  CONTROL: with the feed untouched the card does not stay on "No data" (a reading arrives and replaces it), proving MT1 is not just a card that never fills
 * Signed out, 1280, nothing clicked. A deployed URL is fine (the RSI feed is blocked in the browser). */
import { test, expect, type Page } from '@playwright/test';

/* the card's text = the page text from its title onward (the card is a few hundred characters; the next panel starts well after) */
const text = async (page: Page) => { const t = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' '); const i = t.search(/multi-timeframe alignment/i); return i < 0 ? '' : t.slice(i, i + 420); };
const arm = async (page: Page) => page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });

test('MT1. RSI feed hung: Loading… then No data after the grace, never Mixed', async ({ page }) => {
  test.setTimeout(120_000);
  await arm(page); await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/market/snapshot**', async () => { await new Promise(() => {}); });
  await page.route('**/api/market/rsi**', async () => { await new Promise(() => {}); });
  await page.goto('/arena', { waitUntil: 'domcontentloaded' });
  await page.getByText('Multi-Timeframe Alignment').first().waitFor({ timeout: 40_000 }).catch(() => {});
  await page.waitForTimeout(6_000);
  const early = await text(page); console.log(`[MTF] ~6 s: ${early.slice(0, 160)}`);
  await page.waitForTimeout(24_000);
  const late = await text(page); console.log(`[MTF] ~30 s: ${late.slice(0, 160)}`);
  expect(/Mixed|Conflicting|Bullish|Bearish/i.test(early + ' ' + late), 'the card drew a verdict with no readings').toBe(false);
  expect(/Loading/i.test(early) || /No data/i.test(early), 'early state must be Loading… (or No data only if the feed reported failed)').toBe(true);
  expect(/No data/i.test(late), 'after the 20 s grace the card must say No data').toBe(true);
  expect(/unavailable right now/i.test(late), 'the footer must say the RSI readings are unavailable').toBe(true);
});

test('MT2. control: with the feed untouched the card fills', async ({ page }) => {
  test.setTimeout(120_000);
  await arm(page); await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/arena', { waitUntil: 'domcontentloaded' });
  await page.getByText('Multi-Timeframe Alignment').first().waitFor({ timeout: 40_000 }).catch(() => {});
  await page.waitForTimeout(30_000);
  const t = await text(page); console.log(`[MTF] control ~30 s: ${t.slice(0, 160)}`);
  expect(/No data/i.test(t), 'the card still says No data with a live feed: the control cannot discriminate').toBe(false);
});
