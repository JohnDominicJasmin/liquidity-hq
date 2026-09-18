import { test, expect } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON, SUPABASE_URL } from './_auth';

/* PM/DevOps's own audit target on the #1347 fix, automated: a failed
 * BACKGROUND settings refresh must not demote an already-'ready' status
 * back to 'error' - StrategyPanel's guard against writing a real saved
 * selection is worthless if a healthy panel can be knocked into the error
 * state (and its chip guard closed) by an unrelated network blip on a
 * background poll.
 *
 * components/SettingsProvider.tsx's refresh() (read before writing this):
 * every failure branch uses the functional update
 * `setSettingsLoadStatus(prev => prev === 'ready' ? prev : 'error')` -
 * genuinely sticky. The one-time sign-in effect's own branches are
 * unconditional, but cannot re-fire for an already-'ready' account (traced
 * `authLoading` in components/AuthProvider.tsx: it resolves once and never
 * flips true again post-load, so that effect's deps - `[user?.id,
 * authLoading]` - cannot change for an unchanged, already-ready session).
 *
 * Dev hand-verified this exact journey against a real production build
 * (Arena to 'ready', navigate to Alerts at mobile width, trigger a real
 * background refresh with a failure injected, navigate back, chip still
 * pressed, no error state) - this automates the same journey as an
 * independent instrument, not a re-statement of their result.
 *
 * The trigger: app/alerts/page.tsx's Telegram-link poll
 * (`useEffect` on `linkCode`, `LINK_POLL_MS` = 3s) calls `refreshSettings()`
 * on every tick while a code is outstanding - the only UI-reachable
 * `refresh()` call site outside StrategyPanel's own Retry (which only
 * renders in the 'error' state to begin with, so it cannot exercise
 * "already ready, background call fails").
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

test.describe('A failed background settings refresh must not demote an already-ready panel to error', () => {
  test('Arena reaches ready with a real selection, a failed background refresh (via the Alerts Telegram-link poll) does not knock it into the error state', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, '/about');
      await resetStrategySelection(page, ['SMA']);

      await page.goto('/arena');
      const smaChip    = page.locator('button.strat-chip', { hasText: 'SMA' });
      const errorAlert = page.locator('[role="alert"]', { hasText: /couldn.?t load your saved indicators/i });
      await expect(smaChip, 'must reach ready with the real saved selection before this test can mean anything').toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

      // NOW inject the failure - status is already 'ready', this is
      // deliberately after the fact, not a slow/failed initial load.
      await page.route(`${SUPABASE_URL}/rest/v1/**`, route => {
        const url = route.request().url();
        if (!/user_settings/.test(url)) return route.fallback();
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'simulated background failure' }) });
      });

      await page.goto('/alerts');
      const connectBtn = page.getByRole('button', { name: /connect telegram/i });
      const alreadyLinked = await connectBtn.isVisible({ timeout: 5_000 }).catch(() => false);
      if (!alreadyLinked) {
        test.info().annotations.push({ type: 'result', description: 'SKIPPED MECHANISM: this account already has Telegram linked (no "Connect Telegram" button), so the link-code poll could not be started without unlinking a real fixture account first, which this test will not do. The sticky-ready property remains source-verified (functional setState update in SettingsProvider.tsx refresh()) and Dev-hand-verified, but not independently automated in this run.' });
        return;
      }
      await connectBtn.click();

      // One poll tick (LINK_POLL_MS = 3s) is enough to exercise
      // refreshSettings() at least once against the injected failure.
      await page.waitForTimeout(4_000);

      await page.goto('/arena');
      await expect(errorAlert, 'a failed BACKGROUND refresh must not knock an already-ready panel into the error state').toHaveCount(0);
      await expect(smaChip, 'the real saved selection must still be showing, pressed - sticky-ready means the background failure never touched it').toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
    } finally {
      await ctx.close();
    }
  });
});
