import { test, expect } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON, SUPABASE_URL } from './_auth';

/* #1263 (tracker) / #1308 (fix, merged 2026-09-16, dev@61fd0429): Arena's
 * one-shot coin/TF/strategy seed effect used to latch on its FIRST run,
 * which happens on mount - before `settingsLoaded` could ever be true,
 * since `settings` starts as the synchronous DEFAULT_SETTINGS fallback
 * while the real DB read is still in flight. On anything slower than an
 * instant network, the effect seeded from the DEFAULT coin/TF/(empty)
 * strategy, latched its guard ref, and the real saved values arriving
 * moments later were silently ignored - the panel left its loading state
 * correctly, but showed 0 selected instead of the account's real saved
 * ones. No error, no visual break.
 *
 * #1308's fix (app/arena/page.tsx, read before writing this): the seed
 * effect now checks `settingsLoaded` BEFORE checking/latching
 * `arenaInitRef`, not after - so it keeps returning early (never latching)
 * until the authoritative read actually lands, then seeds once from the
 * real values. No touched-ref needed for strategy selection -
 * `handleStrategySelectionChange` already gates on `settingsLoaded`.
 *
 * THE DISTINCTION THIS FILE TESTS FOR, per PM/DevOps's explicit instruction:
 * asserting the saved chip comes back correct AFTER the panel leaves its
 * loading state - NOT merely that the panel stops loading.
 * `strategy-panel-preload-race.spec.ts` (#1253) already covers the
 * loading-state mechanics with a deliberately EMPTY baseline selection (to
 * avoid tripping over this exact bug, per its own header comment) - this
 * file is the missing other half, with a REAL non-empty saved selection.
 *
 * SCOPE NOTE: this file covers the strategy-selection third of #1308's
 * claim only. The coin/TF thirds were attempted and deliberately left out
 * rather than committed half-working or skipped - two live attempts
 * produced two different, inconsistent results (a navigation-order
 * confound involving the page's own "sync coin+tf to URL" effect was found
 * and fixed, but the result stayed inconsistent after that fix and the
 * remaining variable was not isolated in the time available). That result
 * is recorded on #1263 as unconfirmed, not as a pass - a skipped test here
 * would read as coverage that exists when it does not.
 *
 * Uses the same reset-via-PATCH-with-knownAsOf mechanics as
 * strategy-panel-preload-race.spec.ts - a bare PATCH is silently rejected
 * by #1202/#1217's per-field concurrency guard once a field has ever been
 * confirmed, and a reset that doesn't check `accepted` can look like it
 * worked and hasn't.
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

test.describe('Arena seed effect restores a REAL saved strategy selection after a delayed settings load (#1263/#1308)', () => {
  test('a real, non-empty saved selection comes back pressed once settings load - not just "not loading"', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      // Reset via a plain page (no /arena mount yet) - #1308's
      // `hadCoinParamAtMount` is a one-time snapshot taken at THIS mount,
      // and this file stays clear of that mechanism entirely by never
      // asserting on coin/TF (see the scope note above).
      await gotoSignedIn(page, '/about');
      // Single indicator - StrategyPanel.tsx's `indicatorLimit(entitled)`
      // caps a free-tier account at 1 selected indicator (`FREE · ${limit}`,
      // limit=1 per that file's own comment); a real, single saved value is
      // enough to prove the seed effect restores non-empty state at all.
      await resetStrategySelection(page, ['SMA']);

      const DELAY_MS = 2_000;
      await page.route(`${SUPABASE_URL}/rest/v1/**`, async route => {
        const url = route.request().url();
        if (!/user_settings/.test(url)) return route.fallback();
        await new Promise(r => setTimeout(r, DELAY_MS));
        return route.fallback();
      });

      await page.goto('/arena');

      // Confirm the panel genuinely passes through its loading state first -
      // a test that never observes loading at all could pass by hitting a
      // warm cache path instead of exercising the race this bug lives in.
      const skeleton = page.locator('[role="status"][aria-live="polite"]', { hasText: /loading your saved strategy/i });
      await expect(skeleton).toBeVisible({ timeout: DELAY_MS - 200 });
      await expect(skeleton).toHaveCount(0, { timeout: DELAY_MS + 3_000 });

      // THE ASSERTION #1263 NAMES: correct AFTER loading, not merely "not loading".
      const smaChip = page.locator('button.strat-chip', { hasText: 'SMA' });
      await expect(smaChip, 'the real saved SMA selection must come back pressed, not reset to unselected').toHaveAttribute('aria-pressed', 'true');
    } finally {
      await ctx.close();
    }
  });
});
