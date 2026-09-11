import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, SUPABASE_URL, SUPABASE_ANON } from './_auth';

/* #1201 / #1188 part 3's exact "How to test (QA)" scenario, made automatic.
 *
 * Run by hand twice against fix/settings-save-reconciliation on 2026-09-11/12
 * (10000 -> 55555, then again with 77777) before this spec existed: block
 * PATCH /api/settings, change account_size, confirm the optimistic write is
 * marked unconfirmed in localStorage, reload. Both times the value reverted
 * to the stale DB row, and the unconfirmed marker had already been cleared
 * within about a second of the reload - before the sign-in effect's DB read
 * could ever have consulted it.
 *
 * Root cause traced to AuthProvider.tsx: `user` starts `null` and resolves
 * asynchronously, so SettingsProvider's sign-in effect's
 * `if (!user) clearUnconfirmedKeys()` fires on that transient `null` on
 * every mount, wiping the very protection meant to survive this exact
 * reload before it is ever read.
 *
 * Written against the CONTRACT - "a failed save survives a reload" - not the
 * `lhq_settings_unconfirmed_v1` implementation. Dev is gating the sign-in
 * effect's clear on `!authLoading && !user` and dropping the sign-in retry
 * (#1202 covers the retry's own remaining issue). Either shape of that fix
 * satisfies this test; only a mechanism that reads a page-load's
 * not-yet-resolved auth state as "signed out" does not.
 *
 * EXPECTED RED until #1201 lands on the environment under test. The
 * currently deployed `qa` build does not even have the unconfirmed-keys
 * mechanism yet, so it fails here too, for a blunter related reason -
 * nothing protects the local value at all. Once #1201 (with the
 * `authLoading` gate) is deployed, this must go green; if it does not, the
 * mount-time race is still live.
 */

test.describe('settings survive a reload after a failed save (#1201, #1188 part 3)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('a locally-unsaved account_size change is not silently overwritten by the DB on reload', async ({ browser }) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: FIXTURES.aEmail, password: FIXTURES.aPassword }),
    });
    const session = await res.json();
    expect(session?.access_token, `sign-in failed: HTTP ${res.status}`).toBeTruthy();
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    let originalValue = '';

    try {
      // Seeded on a loaded page, once - not addInitScript, which would
      // re-fire on the reload this test deliberately triggers and mask
      // whatever a real returning session actually does.
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(([k, v]) => localStorage.setItem(k as string, v as string), [
        `sb-${ref}-auth-token`,
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
          token_type: 'bearer',
          user: session.user,
        }),
      ] as [string, string]);

      let saveAttempts = 0;
      await page.route('**/api/settings', route => {
        saveAttempts++;
        return route.abort('connectionfailed');
      });

      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);

      const input = page.getByLabel('Account Size', { exact: true }).first();
      await expect(input, 'Account Size field never rendered - this run measured nothing').toBeVisible({ timeout: 15_000 });

      originalValue = await input.inputValue();
      // Guaranteed different from whatever A's fixture currently holds, and
      // self-describing in a trace/screenshot if this ever fails.
      const changedTo = String((Number(originalValue) || 10_000) + 12_345);

      await input.fill(changedTo);
      await input.blur();

      // Debounce (800ms) + 3 save attempts with 1s/2s backoff between them,
      // plus margin - long enough for every attempt to have failed and the
      // provider to have given up, not just the first.
      await page.waitForTimeout(6000);

      expect(saveAttempts,
        'PATCH /api/settings was never attempted - the failure was not exercised, so a pass here ' +
        'would prove nothing').toBeGreaterThan(0);

      const stillLocalBeforeReload = await input.inputValue();
      expect(stillLocalBeforeReload,
        'the changed value did not even survive its own failed save before any reload - this run ' +
        'measured nothing about reload behaviour specifically').toBe(changedTo);

      // The reload. Route interception is context-scoped and persists across
      // it automatically, so PATCH /api/settings keeps failing here too -
      // this models the user coming back to a save that never succeeded, not
      // one that eventually would have.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);

      const afterReload = page.getByLabel('Account Size', { exact: true }).first();
      await expect(afterReload, 'Account Size field did not render after reload').toBeVisible({ timeout: 15_000 });
      const afterValue = await afterReload.inputValue();

      expect(afterValue,
        `the local edit (${changedTo}) was silently overwritten by the stale DB row (now reads ` +
        `${afterValue}) on reload, after its save had already failed. This is the exact scenario ` +
        `#1201/#1188 part 3 exists to fix - the sign-in effect's DB read must not clobber a value ` +
        'that never made it to the database.').toBe(changedTo);
    } finally {
      // Best-effort restore of A's original value, unrouted so this PATCH is
      // real - so this test does not leave the fixture account mutated for
      // whatever runs after it. Uses the session minted above directly
      // rather than re-reading it back out of localStorage.
      await page.unroute('**/api/settings').catch(() => {});
      if (originalValue) {
        await page.evaluate(async ([token, value]) => {
          try {
            await fetch('/api/settings', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ account_size: Number(value) || 0 }),
            });
          } catch { /* best effort */ }
        }, [session.access_token as string, originalValue] as [string, string]).catch(() => {});
      }
      await ctx.close();
    }
  });
});
