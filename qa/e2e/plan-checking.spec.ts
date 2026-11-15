/* WHILE THE PLAN IS BEING READ, A TAP NEVER ENDS IN A WRONG ANSWER (release 2 CI: the plan resolves 2.4-5 s after load, and a Pro user who tapped a fast timeframe in that window got the 'Upgrade to Pro' modal; one who tapped an indicator chip got the free-plan rules). #2401: "Checking your plan…".
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/plan-checking.spec.ts -f base_url=https://liquidity-hq-qa.onrender.com -f project=desktop
 * The plan read (the user_subscriptions request) is HELD for 8 s so the window is wide and the same on every run; everything else is real. Signed in as fixture A (Pro) and B (Free). Nothing is written.
 *   P1  Pro, plan unknown: a tap on the 1m timeframe opens NO upgrade modal and the timeframe does not change; the line "Checking your plan…" (arena-plan-checking) shows, and is gone within 4-6 s
 *   P2  Pro, once the plan is known: the same tap switches the timeframe (no modal, no checking line)
 *   P3  Free, once the plan is known: the same tap DOES open the upgrade modal (a confirmed free account is still told); no checking line
 *   P4  Pro with a saved selection, plan unknown: tapping an indicator chip (if the panel shows chips yet) leaves the saved selection exactly as it was (the saved chip stays pressed) [reported with what the panel showed]
 * WHAT IT CANNOT PROVE: the real plan-read latency (the probe run does that) or the wording in ko/zh/ru (the label cells, after the dev block is applied). */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

async function open(browser: import('@playwright/test').Browser, who: 'a' | 'b', holdMs: number, saved: string[] | null) {
  const ctx = await signedInContext(browser, who);
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); await page.setViewportSize({ width: 1280, height: 900 }); await installPaidAiFence(page);
  await page.route(/\/api\/settings(\?|$)/, async route => { const q = route.request(); if (q.method() === 'GET') return route.fallback(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [], settings: null }) }); });
  if (saved) await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback(); const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    const patch = (r: Record<string, unknown>) => ({ ...r, strategy_selection: saved, arena_strategy: null }); return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>) });
  });
  /* hold the PLAN read */
  await page.route(/user_subscriptions/, async route => { if (route.request().method() === 'GET') await new Promise(r => setTimeout(r, holdMs)); return route.fallback(); });
  await page.goto('/arena?coin=btc&tf=1h', { waitUntil: 'domcontentloaded' });
  return { ctx, page };
}
const tf = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).first();
const modal = (page: Page) => page.getByRole('dialog', { name: /Upgrade to Pro/i });
const checking = (page: Page) => page.getByTestId('arena-plan-checking');

test.describe('plan checking', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON); test.describe.configure({ timeout: 120_000, retries: 0 });

  test('P1. Pro, plan unknown: a fast-timeframe tap opens no modal, changes nothing, and says "Checking your plan…"', async ({ browser }) => {
    const { ctx, page } = await open(browser, 'a', 8_000, null);
    try {
      await expect(tf(page, '1m')).toBeVisible({ timeout: 30_000 }); await page.waitForTimeout(500);
      const before = await page.evaluate(() => location.search); await tf(page, '1m').click();
      await expect(checking(page), 'no "Checking your plan…" line after a gated tap with the plan unknown').toBeVisible({ timeout: 3_000 });
      console.log(`[PLANCHK] P1 checking text: ${JSON.stringify(await checking(page).innerText())}`);
      await expect(modal(page), 'the Upgrade modal opened for a Pro account whose plan was not yet read').toHaveCount(0);
      expect(await page.evaluate(() => location.search), 'the timeframe changed on a gated tap with the plan unknown').toBe(before);
      await expect(checking(page), 'the checking line never went away').toHaveCount(0, { timeout: 12_000 });
    } finally { await ctx.close(); }
  });

  test('P2. Pro, plan known: the same tap switches the timeframe, with no modal and no checking line', async ({ browser }) => {
    const { ctx, page } = await open(browser, 'a', 1_500, null);
    try {
      await expect(page.locator('.plan-badge-pro').first()).toBeVisible({ timeout: 45_000 });
      await tf(page, '1m').click(); await page.waitForTimeout(1_500);
      await expect(modal(page), 'the Upgrade modal opened for a Pro account').toHaveCount(0); await expect(checking(page)).toHaveCount(0);
      await expect(tf(page, '1m'), 'the 1m button is not the active timeframe after the tap').toHaveClass(/on|active|sel/, { timeout: 8_000 });
    } finally { await ctx.close(); }
  });

  test('P3. Free, plan known: the same tap opens the upgrade modal and there is no checking line', async ({ browser }) => {
    test.skip(!process.env.E2E_USER_B_EMAIL, 'NOT RUN: no Free fixture');
    const { ctx, page } = await open(browser, 'b', 1_500, null);
    try {
      await expect(page.locator('.plan-badge-free').first()).toBeVisible({ timeout: 45_000 });
      await tf(page, '1m').click();
      await expect(modal(page), 'a confirmed Free account was not told to upgrade').toBeVisible({ timeout: 8_000 }); await expect(checking(page)).toHaveCount(0);
    } finally { await ctx.close(); }
  });

  test('P4. Pro with a saved selection, plan unknown: an indicator-chip tap leaves the saved selection as it was', async ({ browser }) => {
    const { ctx, page } = await open(browser, 'a', 8_000, ['SMA']);
    try {
      await page.waitForTimeout(3_000);
      const sma = page.getByTestId('strategy-indicator-SMA'); const macd = page.getByTestId('strategy-indicator-MACD');
      const shown = await sma.count();
      console.log(`[PLANCHK] P4 panel at 3 s with the plan unknown: SMA chip present=${shown}, unknown-plan card=${await page.getByText(/Couldn't verify your plan|Checking your plan/i).count()}`);
      if (shown) {
        const before = await sma.getAttribute('aria-pressed'); await macd.click({ force: true, timeout: 2_000 }).catch(() => {}); /* disabled while the plan loads (#2406): a tap is a no-op and must not wait 30 s to become enabled */ await page.waitForTimeout(800);
        const after = await sma.getAttribute('aria-pressed');
        console.log(`[PLANCHK] P4 SMA pressed before the MACD tap=${before}, after=${after}, MACD pressed=${await macd.getAttribute('aria-pressed')}`);
        expect(after, 'a chip tap while the plan was unknown changed the saved selection').toBe(before);
      }
      await expect(page.locator('.plan-badge-pro').first()).toBeVisible({ timeout: 45_000 });
      await expect(sma, 'the saved SMA selection is not pressed once the plan is known').toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    } finally { await ctx.close(); }
  });
});
