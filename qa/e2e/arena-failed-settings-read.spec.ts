import { test, expect } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON, SUPABASE_URL } from './_auth';

/* #1348 item 2 (from #1347's audit): a FAILED settings read is presented as
 * a confirmed empty selection, then can overwrite the real one.
 *
 * components/SettingsProvider.tsx:300-301 - `setSettingsLoaded(true)` fires
 * in BOTH the success (.then) and error callback of the `user_settings`
 * read. The error path never calls setSettings/applyDbSettings, so
 * `settings` stays whatever the synchronous DEFAULT_SETTINGS fallback was
 * (strategy_selection: null -> [] once spread through the panel). The
 * `!settingsLoaded` guard on `handleStrategySelectionChange`
 * (app/arena/page.tsx:288) stops protecting once this flips - a chip click
 * after a failed read can persist an empty selection over the account's
 * real saved one.
 *
 * This is DELIBERATELY the failure path, not the slow path -
 * strategy-panel-preload-race.spec.ts only ever delays the read and always
 * lets it eventually succeed. No PR has fixed this yet, so this test is
 * expected to demonstrate the defect (RED), not confirm a fix - written
 * against the CURRENT, real component behaviour (StrategyPanel.tsx:251-262:
 * `!loaded` shows a skeleton, `loaded` unconditionally shows the real chip
 * grid keyed off `selected`, with no third "errored" state anywhere in
 * between), not a hoped-for one.
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

test.describe('A failed settings read must not present or persist an empty selection (#1348 item 2)', () => {
  test('a real saved selection is not shown as empty, and a click does not persist that empty state, after the settings read genuinely fails', async ({ browser }) => {
    // Confirmed live defect (#1348 item 2), no fix landed yet - test.fail()
    // keeps the suite green while it's true, and turns loudly red the
    // moment a fix makes this test unexpectedly pass, so Dev's own
    // pre-push hook doesn't fail on the very fix this test exists for.
    // Remove this line as part of that fix, not before.
    test.fail();
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, '/about');
      await resetStrategySelection(page, ['SMA']);

      let settingsPatchCount = 0;
      page.on('request', req => {
        if (req.method() === 'PATCH' && req.url().includes('/api/settings')) settingsPatchCount++;
      });

      // A genuine failure, not a delay - this is the untested half per
      // #1347/#1348: strategy-panel-preload-race.spec.ts only ever tests a
      // read that eventually succeeds.
      let injectedFailureCount = 0;
      await page.route(`${SUPABASE_URL}/rest/v1/**`, route => {
        const url = route.request().url();
        if (!/user_settings/.test(url)) return route.fallback();
        injectedFailureCount++;
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'simulated failure' }) });
      });

      await page.goto('/arena');

      // Give the failed read time to resolve and settingsLoaded to flip -
      // whichever way it flips.
      await page.waitForTimeout(3_000);

      const skeleton = page.locator('[role="status"][aria-live="polite"]', { hasText: /loading your saved strategy/i });
      const smaChip  = page.locator('button.strat-chip', { hasText: 'SMA' });

      // THE FINDING: does the panel present a definite (empty) answer after
      // a failure, the same way it does after a genuine success? If so,
      // `smaChip` will be visible - it only renders once `loaded` (i.e.
      // `settingsLoaded`) is true - and it will read unpressed despite the
      // real saved value, because `settings.strategy_selection` never got
      // populated on this path.
      // The early return below only means something if the injected failure
      // actually fired - a route pattern that silently stops matching (a
      // refactor of the settings fetch path, a Supabase SDK version bump
      // changing its REST call shape) must not be able to produce a quiet
      // green pass here. Machine-checked, not left as a note for a human to
      // go verify in a request log.
      expect(injectedFailureCount, 'the simulated user_settings failure never actually fired - this run measured nothing, not a pass').toBeGreaterThan(0);

      const stillSkeleton = await skeleton.isVisible().catch(() => false);
      if (stillSkeleton) {
        // The ideal, NOT-YET-BUILT behaviour: a failure should leave the
        // panel in a recognizable non-final state (loading or a distinct
        // error) rather than flipping to a false "done, zero selected."
        test.info().annotations.push({ type: 'result', description: 'PASS-BY-DEFAULT: panel stayed in a loading/non-final state after the failed read rather than presenting a false empty answer - this would mean the defect does not reproduce as described. The injection itself is confirmed to have fired (checked above), so this is a real result, not a silent miss.' });
        return;
      }

      await expect(smaChip, 'the account\'s real saved SMA selection must not render as unselected just because the read failed - "unknown" was shown as "confirmed empty" (#1347 item 2)')
        .toHaveAttribute('aria-pressed', 'true');

      // If the assertion above already failed (which is the expected,
      // documented-bug outcome), this next part demonstrates the write-path
      // consequence: since `settingsLoaded` incorrectly reads true, the
      // `!settingsLoaded` guard in handleStrategySelectionChange no longer
      // protects, so ANY click that changes selection would persist an
      // empty/wrong selection over the real one. Toggling SMA off proves it.
      await smaChip.click();
      await expect.poll(() => settingsPatchCount, {
        message: 'a click after a failed settings read fired a PATCH - proving it can persist the wrong (empty) selection over the account\'s real saved one',
      }).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });
});
