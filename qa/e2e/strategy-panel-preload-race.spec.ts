import { test, expect } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON, SUPABASE_URL } from './_auth';

/* #1253 (#1246): a chip clicked on the Strategy Panel before the settings
 * DB read lands must not write an empty/narrowed selection over a real
 * saved one. `settingsLoaded` (SettingsProvider.tsx) gates StrategyPanel's
 * `loaded` prop, which gates its skeleton, its dropdown, and both
 * `toggle()`/`applySet()` - and `handleStrategySelectionChange`
 * (app/arena/page.tsx) gates the actual write a second, independent time.
 *
 * Baseline is an EMPTY saved selection, not a real one, deliberately -
 * #1263 found that a real multi-item selection can fail to ever render
 * after a delayed load (a separate, pre-existing bug in the page's
 * one-shot coin/TF/strategy seed effect, unrelated to this race). An empty
 * baseline sidesteps that: there is nothing for the seed effect to miss,
 * so this file tests exactly the property #1253 claims, without tripping
 * over #1263's.
 *
 * RESET MECHANICS, the part that cost real time to get right: a bare
 * `PATCH /api/settings` with no `knownAsOf` is SILENTLY REJECTED by
 * #1202/#1217's per-field concurrency guard once a field has ever been
 * confirmed - it returns 200 either way, with `accepted`/`rejected` arrays
 * in the body the only sign anything happened. A reset that doesn't check
 * `accepted` can look like it worked and hasn't.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

async function resetStrategySelection(page: import('@playwright/test').Page, selection: string[]) {
  const result = await page.evaluate(async (sel) => {
    const raw = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const token = raw ? JSON.parse(localStorage.getItem(raw)!).access_token : null;
    const now = new Date().toISOString();
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ strategy_selection: sel, knownAsOf: { strategy_selection: now } }),
    });
    const body = await res.json();
    localStorage.removeItem('lhq_settings_v1');
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('lhq_settings_unconfirmed_v1')) localStorage.removeItem(k);
    }
    return { status: res.status, accepted: body.accepted as string[] | undefined };
  }, selection);
  expect(result.accepted, `strategy_selection reset was rejected by the concurrency guard: ${JSON.stringify(result)}`)
    .toContain('strategy_selection');
}

test.describe('Strategy Panel pre-load write race (#1253)', () => {
  test('skeleton shows during load, a click during that window no-ops and sends no PATCH, then it works once loaded', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
      await resetStrategySelection(page, []);

      let settingsPatchCount = 0;
      page.on('request', req => {
        if (req.method() === 'PATCH' && req.url().includes('/api/settings')) settingsPatchCount++;
      });

      const DELAY_MS = 2_000;
      await page.route(`${SUPABASE_URL}/rest/v1/**`, async route => {
        const url = route.request().url();
        if (!/user_settings/.test(url)) return route.fallback();
        await new Promise(r => setTimeout(r, DELAY_MS));
        return route.fallback();
      });

      await page.reload();

      // 1. Skeleton, not bare unselected-looking chips, while loading.
      const skeleton = page.locator('[role="status"][aria-live="polite"]', { hasText: /loading your saved strategy/i });
      await expect(skeleton).toBeVisible({ timeout: DELAY_MS - 200 });
      await expect(page.locator('button.strat-chip')).toHaveCount(0);
      await expect(page.locator('select.strat-sel')).toBeDisabled();

      // 2. A click during the window does nothing and writes nothing - there
      // is no chip to click while the skeleton is up, so this asserts the
      // absence directly rather than attempting a click with no target.
      expect(settingsPatchCount, 'no PATCH to /api/settings must fire while the panel is still loading').toBe(0);

      // 3. Once loaded: chips render, dropdown enables, and a real click
      // now works (fires a PATCH that actually lands).
      await expect(skeleton).toHaveCount(0, { timeout: DELAY_MS + 3_000 });
      await expect(page.locator('select.strat-sel')).toBeEnabled();

      await page.locator('select.strat-sel').selectOption('custom');
      const bollingerChip = page.locator('button.strat-chip', { hasText: 'Bollinger' });
      await expect(bollingerChip).toHaveAttribute('aria-pressed', 'false');
      await bollingerChip.click();
      await expect(bollingerChip).toHaveAttribute('aria-pressed', 'true');

      await expect.poll(() => settingsPatchCount, {
        message: 'a click after load must write through to /api/settings',
        timeout: 5_000,
      }).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });
});
