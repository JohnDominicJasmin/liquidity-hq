import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, FIXTURES, SUPABASE_URL, SUPABASE_ANON } from './_auth';

/* Sign-out must clear the session even when the logout REQUEST fails. (#304, #317)
 *
 * GoTrueClient._signOut clears the stored session only AFTER its POST /logout
 * returns. It treats 401/403/404 as "already gone" and clears anyway, but on a
 * network error, timeout or 5xx it returns the error and never reaches
 * _removeSession(). The old handler discarded that error, so the token stayed in
 * localStorage, no SIGNED_OUT event fired, and the app carried on fully signed
 * in - a failed sign-out was indistinguishable from a successful one.
 *
 * WHY NEITHER OF US REPRODUCED IT. Every run we did had a healthy network, so
 * the request always succeeded and the bug never fired. The owner hit it on
 * production with whatever their connection did that moment. This spec makes
 * that moment reproducible instead of waiting for it.
 *
 * The session is seeded ONCE against a loaded page rather than via
 * addInitScript, which re-runs on every document and would re-inject the token
 * after a successful sign-out - that produced a false "signed back in" reading
 * on an earlier probe.
 */

const LOGOUT = '**/auth/v1/logout**';

async function seedSession(page: Page, session: Record<string, unknown>, ref: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, v]) => {
    localStorage.setItem(k as string, v as string);
    localStorage.setItem('lhq_analytics_consent_v1', 'denied');
  }, [`sb-${ref}-auth-token`, JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + (session.expires_in as number),
    token_type: 'bearer',
    user: session.user,
  })]);
}

const state = (page: Page) => page.evaluate(() => ({
  url: location.pathname,
  token: !!Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token')),
  avatar: !!document.querySelector('.auth-avatar-btn'),
  emailField: !!document.querySelector('[data-testid="login-email"]'),
}));

test.describe('sign-out resilience', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  /* A FRESH SESSION PER TEST, not one shared from beforeAll.
   *
   * The first version minted once and reused it. The healthy-path control then
   * passed alone and failed in sequence: a completed logout revokes the refresh
   * token server-side, so by the third test the shared session was already dead
   * and the control failed for a reason that had nothing to do with the code
   * under test.
   *
   * That is a test-isolation bug producing a red on correct behaviour - the
   * mirror of the day's other error, where uncontrolled inputs produced a red on
   * correct behaviour too. Minting per test costs one request and removes the
   * coupling entirely. */
  const freshSession = async () => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: FIXTURES.aEmail, password: FIXTURES.aPassword }),
    });
    const s = await res.json();
    expect(s?.access_token, `sign-in failed: HTTP ${res.status}`).toBeTruthy();
    return { session: s as Record<string, unknown>, ref: new URL(SUPABASE_URL).hostname.split('.')[0] };
  };

  test('the session clears even when POST /logout returns 500', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      const { session, ref } = await freshSession();
      await seedSession(page, session, ref);

      let logoutHits = 0;
      await page.route(LOGOUT, route => {
        logoutHits++;
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"msg":"boom"}' });
      });

      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(7000);

      const before = await state(page);
      expect(before.token, 'not signed in before the attempt - this run measured nothing').toBe(true);

      const btn = page.locator('.st-signout-btn').first();
      await expect(btn, 'no sign-out button on /settings').toBeVisible({ timeout: 20_000 });
      await btn.click();
      await page.waitForTimeout(8000);

      /* CONTROL: the failure was actually exercised. Without this, a run where
         the interception never matched would report a clean sign-out and look
         like a pass. */
      expect(logoutHits,
        'POST /logout was never intercepted - the failure path was not exercised, so a green ' +
        'result here says nothing about it').toBeGreaterThan(0);

      const after = await state(page);
      expect(after.token,
        'the session survived a failed logout request. GoTrue does not clear on 5xx, so the ' +
        'handler must clear locally regardless - otherwise a failed sign-out is ' +
        'indistinguishable from a successful one').toBe(false);
      expect(after.avatar, 'still showing the signed-in avatar after sign-out').toBe(false);
    } finally { await ctx.close(); }
  });

  test('the session clears even when POST /logout never answers', async ({ browser }) => {
    /* The owner's likely case. A timeout is not a 5xx - GoTrue rejects rather
       than returning, so a handler that only inspects `{ error }` on a resolved
       promise still misses it. */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      const { session, ref } = await freshSession();
      await seedSession(page, session, ref);
      await page.route(LOGOUT, route => route.abort('connectionfailed'));

      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(7000);
      expect((await state(page)).token, 'not signed in before the attempt').toBe(true);

      await page.locator('.st-signout-btn').first().click();
      await page.waitForTimeout(10_000);

      const after = await state(page);
      expect(after.token, 'the session survived an aborted logout request').toBe(false);
      expect(after.avatar, 'still showing the signed-in avatar').toBe(false);
    } finally { await ctx.close(); }
  });

  test('the OPS console sign-out also clears on a failed logout', async ({ browser }) => {
    /* The second user-pressable sign-out, and #317 did not cover it.
     *
     * Dev swept the codebase after I flagged this and found FOUR callers of
     * sb.auth.signOut(), of which #317 fixed one:
     *
     *   app/ops/layout.tsx:60         ops console, two buttons     bypassed
     *   AuthProvider.tsx:69           >7-day inactivity expiry     bypassed
     *   AuthProvider.tsx:130          BAN ENFORCEMENT              bypassed
     *   AuthProvider.tsx:172          the button in #317           fixed
     *
     * The other two are not reachable from any button, which is exactly why
     * testing the button would never have found them - dev's unit test covers
     * those. This covers the second button, because a UI path deserves a UI
     * assertion. Requires the admin fixture from #280. */
    const adminEmail = process.env.E2E_USER_ADMIN_EMAIL ?? '';
    const adminPw = process.env.E2E_USER_ADMIN_PASSWORD ?? '';
    test.skip(!adminEmail || !adminPw,
      'admin fixture absent - E2E_USER_ADMIN_EMAIL / E2E_USER_ADMIN_PASSWORD, see #280');

    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPw }),
    });
    const s = await res.json();
    test.skip(!s?.access_token, `admin sign-in failed: HTTP ${res.status}`);

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await seedSession(page, s as Record<string, unknown>, new URL(SUPABASE_URL).hostname.split('.')[0]);

      let logoutHits = 0;
      await page.route(LOGOUT, route => { logoutHits++; return route.abort('connectionfailed'); });

      await page.goto('/ops', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(8000);

      expect((await state(page)).token, 'not signed in on /ops - this run measured nothing').toBe(true);

      const btn = page.locator('button', { hasText: /sign out/i }).first();
      const found = await btn.isVisible().catch(() => false);
      test.skip(!found, 'no sign-out button rendered on /ops - the admit path may have changed');

      await btn.click();
      await page.waitForTimeout(9000);

      expect(logoutHits, 'the logout request was never attempted from /ops').toBeGreaterThan(0);
      expect((await state(page)).token,
        'the ops console sign-out left the session intact after a failed logout - it bypasses ' +
        'the resilient path that the settings button uses').toBe(false);
    } finally { await ctx.close(); }
  });

  test('CONTROL: a HEALTHY sign-out still works and lands on the sign-in form', async ({ browser }) => {
    /* Stops the fix being "clear the session and never call logout". The
       request must still be made, and the normal path must still end on /login
       with the form rendered - which is the half the owner actually asked for. */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      const { session, ref } = await freshSession();
      await seedSession(page, session, ref);

      let logoutHits = 0;
      await page.route(LOGOUT, route => { logoutHits++; return route.continue(); });

      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(7000);
      await page.locator('.st-signout-btn').first().click();
      await page.waitForTimeout(8000);

      const after = await state(page);
      expect(logoutHits, 'no logout request was made - the fix skipped the server entirely')
        .toBeGreaterThan(0);
      expect(after.token, 'session not cleared on the healthy path').toBe(false);
      expect(after.emailField, 'did not land on the sign-in form').toBe(true);
    } finally { await ctx.close(); }
  });
});
