/* Shots of the one strategy menu for PM's visual check, on whatever build is under test (a deployed site with base_url): 390 / 768 / 1280, dark and light, in two states: a call OPEN (EMA stack saved) and "Let the read choose" (nothing saved).
 * Files in qa/.shots: strategy-menu-open-<w>-<theme>.png, strategy-menu-auto-<w>-<theme>.png (page) and strategy-menu-panel-open-/-auto-<w>-<theme>.png (the Strategy panel alone). Signed in as fixture A (email masked), the settings read patched for the saved choice, writes stubbed: nothing is written. */
import { test, expect, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });
async function open(browser: Browser, width: number, theme: string, saved: string | null) {
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
  const page = await ctx.newPage(); await page.setViewportSize({ width, height: width < 500 ? 844 : 900 }); await installPaidAiFence(page);
  await page.route(/\/api\/settings(\?|$)/, async route => { const q = route.request(); if (q.method() === 'GET') return route.fallback(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: Object.keys((q.postDataJSON() ?? {}) as object).filter(k => k !== 'knownAsOf'), rejected: [], settings: null }) }); });
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback(); const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    const patch = (r: Record<string, unknown>) => ({ ...r, arena_sound: false, arena_strategy: saved, strategy_selection: [], language: 'en' }); return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>) });
  });
  await gotoSignedIn(page, '/arena?coin=eth&tf=1h'); await page.waitForTimeout(12_000);
  return { ctx, page };
}
test.describe('strategy menu shots', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON); test.describe.configure({ timeout: 150_000 });
  for (const theme of ['dark', 'light'] as const) for (const width of [390, 768, 1280] as const) for (const state of ['open', 'auto'] as const) test(`${state} ${width} ${theme}`, async ({ browser }) => {
    const { ctx, page } = await open(browser, width, theme, state === 'open' ? 'ema_stack' : null);
    try {
      const sel = page.getByTestId('strategy-set-select'); await expect(sel).toBeVisible({ timeout: 30_000 }); await sel.scrollIntoViewIfNeeded(); await page.waitForTimeout(800);
      if (state === 'open') await expect(page.getByTestId('strategy-call-box')).toBeVisible({ timeout: 20_000 }); else await expect(page.getByTestId('strategy-call-box')).toHaveCount(0);
      const sc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth })); console.log(`[MSHOT] ${state} ${width} ${theme} ${JSON.stringify(sc)} value=${await sel.inputValue()}`);
      await page.screenshot({ path: `qa/.shots/strategy-menu-${state}-${width}-${theme}.png`, mask: [page.locator('.tnav-drop-email'), page.locator('text=/@/')], maskColor: '#000000' });
      const panel = sel.locator('xpath=ancestor::*[contains(@class,"strat") or self::section][1]'); await ((await panel.count()) ? panel.first() : sel).screenshot({ path: `qa/.shots/strategy-menu-panel-${state}-${width}-${theme}.png` }).catch(() => {});
      expect(sc.sw, 'sideways scroll').toBeLessThanOrEqual(sc.vw);
    } finally { await ctx.close(); }
  });
});
