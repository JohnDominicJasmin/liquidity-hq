import { test, expect } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON, SUPABASE_URL } from './_auth';

/* #1348 item 2 (from #1347's audit) - a FAILED settings read used to be
 * presented as a confirmed empty selection, then could overwrite the real
 * one on the next chip click.
 *
 * REWRITTEN against Dev's actual fix (fix/arena-selection-liveness, read
 * before writing this - components/SettingsProvider.tsx,
 * components/StrategyPanel.tsx, lib/settings.ts), not against the shape
 * this test assumed before the fix existed. The old version asserted a real
 * chip rendering with aria-pressed="true" after a failure - that assumption
 * does not survive the real fix and would now fail for the wrong reason
 * (element not found, not a stale selection).
 *
 * THE REAL FIX: `settingsLoaded: boolean` became `settingsLoadStatus:
 * 'loading' | 'error' | 'ready'` (lib/settings.ts). A genuinely failed read
 * sets 'error' (SettingsProvider.tsx), which StrategyPanel now renders as
 * its own distinct state (StrategyPanel.tsx `status === 'error'`) - no chip
 * grid at all (so nothing can be clicked into persisting an empty
 * selection), an alert with retry text, and a Retry button wired to
 * `refresh()`. `handleStrategySelectionChange` and the seed effect
 * (app/arena/page.tsx) both now gate on `settingsLoadStatus === 'ready'`
 * specifically - 'error' no longer satisfies that check the way the old
 * boolean `true` used to.
 *
 * THE PROPERTY BEING PROTECTED, not just "the error state exists": a user
 * whose read failed can get their real saved selection back. The error
 * message and Retry button are only the means - a Retry that silently did
 * nothing would still pass a test that stopped at "the alert rendered."
 * This file asserts the full round trip: failure -> error state, no chips,
 * no persisting write -> Retry -> real saved selection appears.
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

test.describe('A failed settings read must not present or persist an empty selection, and Retry must recover the real one (#1348 item 2)', () => {
  test('a genuinely failed read shows the error state with no chip grid, persists no write, and Retry recovers the real saved selection', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, '/about');
      await resetStrategySelection(page, ['SMA']);

      // Scoped to `strategy_selection` specifically, not any PATCH to
      // /api/settings - a real, unrelated write (`{"timezone":"...",
      // "knownAsOf":{}}`, a background browser-timezone sync that fires on
      // every page regardless of settingsLoadStatus) was caught by an
      // earlier, broader version of this check and produced a false
      // failure. The property that matters for item 2 is specifically "no
      // write can persist an empty/wrong strategy_selection over the
      // account's real saved one" - found by reading the actual captured
      // request body from a failed run, not by loosening the assertion on
      // a hunch.
      let strategySelectionPatchCount = 0;
      page.on('request', req => {
        if (req.method() === 'PATCH' && req.url().includes('/api/settings') && (req.postData() ?? '').includes('strategy_selection')) {
          strategySelectionPatchCount++;
        }
      });

      // Failing, not delaying - toggled off after the initial load so Retry's
      // follow-up request (below) succeeds for real, exercising the actual
      // recovery path rather than a permanently-broken one.
      let injecting = true;
      let injectedFailureCount = 0;
      await page.route(`${SUPABASE_URL}/rest/v1/**`, async route => {
        const url = route.request().url();
        if (!injecting || !/user_settings/.test(url)) return route.fallback();
        injectedFailureCount++;
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'simulated failure' }) });
      });

      await page.goto('/arena');

      const skeleton   = page.locator('[role="status"][aria-live="polite"]', { hasText: /loading your saved strategy/i });
      const errorAlert = page.locator('[role="alert"]', { hasText: /couldn.?t load your saved indicators/i });
      const smaChip    = page.locator('button.strat-chip', { hasText: 'SMA' });
      const retryBtn   = errorAlert.getByRole('button', { name: /retry/i });

      await expect(errorAlert, 'the error state never appeared after a genuinely failed settings read').toBeVisible({ timeout: 10_000 });

      // The injection actually firing is what makes the assertions above and
      // below mean anything - a route pattern that silently stops matching
      // (a refactor, an SDK version bump changing the REST call shape) must
      // not be able to produce a quiet pass.
      expect(injectedFailureCount, 'the simulated user_settings failure never actually fired - this run measured nothing').toBeGreaterThan(0);

      // No chip grid at all while errored - nothing renders that a click
      // could turn into a persisting empty-selection write. This is the
      // actual mechanism that closes item 2's data-loss path: not "the
      // panel looks different", but "there is nothing to click."
      await expect(page.locator('button.strat-chip'), 'no strategy chips should render at all while the settings read is in the error state').toHaveCount(0);
      await expect(skeleton, 'the panel must not ALSO be showing the loading skeleton once it has reached a definite error state').toHaveCount(0);
      expect(strategySelectionPatchCount, 'no strategy_selection PATCH should have fired from a state with nothing clickable in it').toBe(0);

      // Recover: let the next settings read through for real, then retry.
      injecting = false;
      await retryBtn.click();

      // THE PENDING STATE (added in a follow-up commit, d918d9cb, after
      // this file's first draft - re-read before adding this): a click that
      // changes nothing on screen until the read settles is
      // indistinguishable from a click that never registered, especially on
      // a slow connection. Checked immediately after the click, before the
      // round trip below has had a chance to resolve.
      await expect(retryBtn, 'Retry must visibly disable for the round trip, not look identical to an unregistered click').toBeDisabled({ timeout: 2_000 });

      // THE ROUND TRIP, not just the error state: the account's real saved
      // selection must actually come back, or a Retry that does nothing
      // would still pass a test that stopped at the alert rendering.
      await expect(errorAlert, 'the error state must clear once Retry succeeds').toHaveCount(0, { timeout: 10_000 });
      await expect(smaChip, 'the real saved SMA selection must appear, pressed, once Retry succeeds - this is the actual recovery the error state and button exist to provide').toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

      // Still no write fired anywhere in this flow - reading the account's
      // own saved value back is not a save.
      expect(strategySelectionPatchCount, 'recovering via Retry must not itself fire a strategy_selection PATCH - reading the account\'s own saved value back is not a save').toBe(0);
    } finally {
      await ctx.close();
    }
  });
});
