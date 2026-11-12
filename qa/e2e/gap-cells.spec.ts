/* The gap-map "manual" items, as GitHub-run cells (#2168). Nothing here is run on a laptop.
 *
 *   G1  #2106  playbook stars are not under the Ask AI button at 768 (bounding boxes)         anonymous, shot
 *   G2  #2151  the hero clock shows the VISITOR's time: two time zones, two clocks            anonymous
 *   G3  #2131  the dashboard VWAP card shows a figure; #2125/#2119 a failed snapshot says so  anonymous, shot
 *   G4  #2166  the AI read's why-line renders markdown (bold), not raw asterisks              fixture A, stubbed AI
 *   G5  #2159  chart markers follow the indicator toggle (pixels change, with a control)     fixture A, shots
 *   G6  #2152  the For You tab never says it is still scanning                                fixture A
 *
 * NOT COVERED HERE: #2118 (OI wording), #2149 (first-venue OI fallback), #2155 (alert health line) - no stable route or
 * selector I can fail from a browser; #2119's other cards. They stay review / unit. ZERO AI SPEND: /api/grok is fulfilled. */
import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gotoGuarded, chip } from './_shared';
import { installMarketFixtures } from './_fixtures';
import { installPaidAiFence } from './_no-paid-ai';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';

const DIR = 'qa/.shots';
const shot = async (page: Page, name: string) => {
  mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: `${DIR}/${name}.png`, mask: [page.locator('.tnav-drop-email'), page.locator('text=/@/')], maskColor: '#000000' });
};
const hits = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test.describe('gap cells (anonymous)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('G1. #2106 playbook stars clear the Ask AI button at 768', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1000 } });
    const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/playbook');
      await page.waitForTimeout(6_000);
      const stars = page.getByTestId('playbook-star');
      const n = await stars.count();
      expect(n, 'no playbook star rendered - nothing to measure').toBeGreaterThan(0);
      const fab = page.locator('.gchat-fab').first();
      let measured = 0; const bad: string[] = [];
      for (let i = 0; i < Math.min(n, 12); i++) {
        await stars.nth(i).scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        const sb = await stars.nth(i).boundingBox(); const fb = (await fab.count()) ? await fab.boundingBox() : null;
        if (sb && fb) { measured++; if (hits(sb, fb)) bad.push(`star ${i}`); }
      }
      console.log(`[gap G1] stars=${n} measured against the FAB=${measured} overlapping=${JSON.stringify(bad)}`);
      expect(measured, 'the FAB was never on screen, so nothing was compared').toBeGreaterThan(0);
      expect(bad, 'a star sits under the Ask AI button').toEqual([]);
      await shot(page, 'gap-playbook-768');
    } finally { await ctx.close(); }
  });

  test('G2. #2151 the hero clock follows the visitor\'s time zone', async ({ browser }) => {
    const read = async (tz: string) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: tz });
      const page = await ctx.newPage();
      try {
        await gotoGuarded(page, '/');
        const clock = page.getByText(/^Live read ·/).first().locator('xpath=following-sibling::span[1]');
        await expect(clock, 'the hero clock never rendered').toHaveText(/^\d{2}:\d{2}$/, { timeout: 30_000 });
        const shown = (await clock.innerText()).trim();
        const expected = await page.evaluate(() => new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }));
        return { shown, expected };
      } finally { await ctx.close(); }
    };
    const a = await read('Pacific/Auckland'); const b = await read('America/Los_Angeles');
    console.log(`[gap G2] Auckland shown=${a.shown} browser=${a.expected} | Los Angeles shown=${b.shown} browser=${b.expected}`);
    const mins = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const near = (x: string, y: string) => { const d = Math.abs(mins(x) - mins(y)); return Math.min(d, 1440 - d) <= 1; };
    expect(near(a.shown, a.expected), 'Auckland: the hero clock is not the browser\'s time').toBe(true);
    expect(near(b.shown, b.expected), 'Los Angeles: the hero clock is not the browser\'s time').toBe(true);
    expect(near(a.shown, b.shown), 'the two zones show the same clock: it is not following the visitor').toBe(false);
  });

  test('G3a. #2131 the dashboard VWAP card shows a figure', async ({ page }) => {
    await installMarketFixtures(page, 'as-recorded');
    await gotoGuarded(page, '/dashboard');
    await page.waitForTimeout(15_000);
    const text = await page.evaluate(() => document.body.innerText);
    const m = text.match(/VWAP[^\n]{0,60}?\$?\s?\d[\d,]*\.?\d*/i);
    console.log(`[gap G3a] vwap context=${JSON.stringify(m?.[0] ?? null)}`);
    await shot(page, 'gap-dashboard-vwap');
    expect(m, 'no VWAP figure anywhere on the dashboard').not.toBeNull();
  });

  test('G3b. #2125/#2119 a failed snapshot says so: no endless loading, no NaN or undefined', async ({ page }) => {
    await installMarketFixtures(page, 'as-recorded');
    await page.route('**/api/market/snapshot**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stubbed"}' }));
    await gotoGuarded(page, '/dashboard');
    await page.waitForTimeout(30_000);
    const text = await page.evaluate(() => document.body.innerText);
    const skeletons = await page.locator('[class*="skeleton" i], [aria-busy="true"]').count();
    console.log(`[gap G3b] skeleton-ish elements after 30s=${skeletons} says-unavailable=${/unavailable|couldn.t|could not|failed|try again|not available/i.test(text)}`);
    await shot(page, 'gap-dashboard-snapshot-failed');
    expect(text, 'NaN or undefined is on the page after a failed read').not.toMatch(/\bNaN\b|\bundefined\b/);
    expect(/unavailable|couldn.t|could not|failed|try again|not available/i.test(text), 'a failed read does not say so anywhere on the page').toBe(true);
  });
});

test.describe('gap cells (signed in, fixture A)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 180_000 });

  test('G4. #2166 the why-line renders markdown, not raw asterisks', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await page.route('**/api/grok**', async (r: Route) => {
        if (r.request().method() === 'GET') {
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usage: { quick_used: 0, quick_limit: 50, deep_used: 0, deep_limit: 20 } }) });
        }
        return r.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            usage: { quick_used: 1, quick_limit: 50, deep_used: 0, deep_limit: 20 },
            result: {
              signal: 'FLAT', confidence: 41, entryLow: null, entryHigh: null, tp: null, sl: null,
              levels: [], chartAnalysis: 'fixture', patterns: [],
              reasoning: '**Liquidity sits above the range.** A *clean* sweep comes first.',
              catalysts: [], waitFor: 'fixture wait', bias: 'NEUTRAL', raidSetup: null, raidTarget: null, raidTrigger: null,
              analyzedAt: Date.now(), tf: '15m', session: 'fixture',
            },
          }),
        });
      });
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
      const quick = page.locator('button.arena-quick-btn');
      await expect(quick).toBeEnabled({ timeout: 60_000 });
      await quick.click();
      const why = page.locator('.av-why').first();
      await expect(why, 'the why-line did not render').toBeVisible({ timeout: 60_000 });
      const html = await why.innerHTML(); const text = await why.innerText();
      console.log(`[gap G4] html=${JSON.stringify(html.slice(0, 200))} text=${JSON.stringify(text.slice(0, 120))}`);
      await shot(page, 'gap-why-line');
      expect(text, 'raw ** or * leaked into the why-line').not.toMatch(/\*/);
      expect(await why.locator('strong, b').count(), 'the bold part is not rendered as bold').toBeGreaterThan(0);
    } finally { await ctx.close(); }
  });

  test('G5. #2159 chart markers follow the indicator toggle', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await installMarketFixtures(page, 'as-recorded');
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
      await page.waitForTimeout(12_000);
      const canvas = page.locator('.klc-canvas, .klc-wrap, canvas').first();
      const snap = async () => canvas.screenshot();
      const base1 = await snap(); await page.waitForTimeout(2_500); const base2 = await snap();
      const sma = chip(page, 'SMA');
      await sma.scrollIntoViewIfNeeded();
      const wasOn = (await sma.getAttribute('aria-pressed')) === 'true';
      if (wasOn) { await sma.click(); await page.waitForTimeout(3_000); }
      const off = await snap();
      await sma.click(); await page.waitForTimeout(4_000);
      const on = await snap();
      mkdirSync(DIR, { recursive: true });
      writeFileSync(`${DIR}/gap-chart-sma-off.png`, off); writeFileSync(`${DIR}/gap-chart-sma-on.png`, on);
      const still = Buffer.compare(base1, base2) === 0;
      console.log(`[gap G5] static-without-change=${still} sma-wasOn=${wasOn} off-vs-on-equal=${Buffer.compare(off, on) === 0}`);
      expect(still, 'CONTROL: the chart changes by itself between two untouched shots, so a difference proves nothing').toBe(true);
      expect(Buffer.compare(off, on) === 0, 'toggling SMA did not change the chart pixels').toBe(false);
      await sma.click().catch(() => {}); // leave the selection as it was
    } finally { await ctx.close(); }
  });

  test('G6. #2152 the For You tab never says it is still scanning', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await gotoSignedIn(page, '/news');
      const tab = page.getByRole('button', { name: /for you/i }).or(page.getByRole('tab', { name: /for you/i })).first();
      await expect(tab, 'no For You tab found').toBeVisible({ timeout: 30_000 });
      await tab.click();
      await page.waitForTimeout(12_000);
      const text = await page.evaluate(() => document.body.innerText);
      console.log(`[gap G6] says-no-catalysts=${/no catalysts right now/i.test(text)} says-scanning=${/scanning for catalysts|still scanning/i.test(text)}`);
      await shot(page, 'gap-news-foryou');
      expect(text, 'the For You tab says it is still scanning').not.toMatch(/scanning for catalysts|still scanning/i);
    } finally { await ctx.close(); }
  });
});
