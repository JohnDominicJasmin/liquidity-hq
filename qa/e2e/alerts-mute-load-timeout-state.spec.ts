import { test, expect, type Browser } from '@playwright/test';
import { SUPABASE_URL, AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { servedLabels } from './_shared';

/* #1167 (tracker #1173), the RENDERED half - and the behavioural proof of it.
 * __tests__/alertsMuteLoadTimeout.test.mts proves getAuthToken() returns nothing on
 * a timeout and reads the page's SOURCE for the mapping; that is a supplement.
 * Only this renders the state.
 *
 * THE STATE UNDER TEST is `user` set (AuthProvider says someone IS signed in) while
 * getAuthToken() has no token - what a signed-in user hitting an auth timeout looks
 * like to the alerts page. Reproduced realistically and without waiting 8s: sign in
 * as A and let the app load fully (onboarding gate, settings and entitlements all
 * settled), THEN make supabase-js's storage read return nothing for the session key
 * and navigate CLIENT-SIDE to /alerts. AuthProvider already has its user; the
 * alerts page mounts, calls getAuthToken(), and gets nothing - the same value a
 * timed-out getSession() produces (the 8s path itself is the unit test's job).
 *
 * WHY NOT A BROADCAST SIGNED_IN ON A PAGE WITH NO SESSION: tried first. That gives a
 * `user` with no readable settings, and the onboarding gate treated that as an
 * incomplete profile and showed the 5-step wizard instead of the alerts page, so
 * nothing about the mute load was measured. This keeps the profile known-complete.
 *
 * What must show: the labelled "Couldn't load your mute preferences" notice with its
 * retry, NOT the sign-in gate, and no /api/alert-prefs request (no token means the
 * page must not reach the network).
 *
 * THE CONTROL runs the identical flow WITHOUT hiding the token: the page must request
 * its preferences and must NOT show the failure notice. Without it a notice that is
 * always on would pass the first test.
 *
 * Writes: none by the failure test. The control only READS /api/alert-prefs; the
 * page's first-visit seeding writes only for an account with no seeded marker, and
 * fixture A has visited the alerts page in earlier specs. */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const AUTH_KEY = () => `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

/** Signs in as A, loads the app fully, optionally hides the stored session from
 *  supabase-js, then navigates to /alerts with Next's client router. */
async function openAlertsClientSide(browser: Browser, hideToken: boolean) {
  const ctx = await signedInContext(browser, 'a');
  // Transparent until the test flips the flag, so sign-in and the initial load are untouched.
  await ctx.addInitScript((key) => {
    const w = window as unknown as { __qaHideToken?: boolean };
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k: string) {
      if (w.__qaHideToken && k === key) return null;
      return real.call(this, k);
    };
  }, AUTH_KEY());
  const page = await ctx.newPage();
  const prefRequests: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/alert-prefs')) prefRequests.push(`${r.method()} ${r.url()}`); });

  await gotoSignedIn(page, '/dashboard');
  await expect(page.locator('.plan-badge:visible, .plan-badge-free-text:visible').first(),
    'the app never finished loading signed in - the precondition for this test').toBeVisible({ timeout: 30_000 });

  if (hideToken) await page.evaluate(() => { (window as unknown as { __qaHideToken?: boolean }).__qaHideToken = true; });

  // Client-side navigation: a full page load would lose the session AuthProvider
  // already resolved, which is not the state under test. Next's own router keeps
  // AuthProvider mounted; fall back to the Tools menu link if it is not on window.
  const viaRouter = await page.evaluate(() => {
    const r = (window as unknown as { next?: { router?: { push?: (u: string) => void } } }).next?.router;
    if (r?.push) { r.push('/alerts'); return true; }
    return false;
  });
  if (!viaRouter) {
    await page.getByRole('button', { name: /tools/i }).first().click();
    await page.locator('a[href="/alerts"]').first().click();
  }
  await expect(page).toHaveURL(/\/alerts/, { timeout: 15_000 });
  return { ctx, page, prefRequests };
}

test.describe('The alerts page tells a signed-in user with no token from a signed-out visitor (#1167)', () => {
  test('a signed-in user whose token is unavailable sees the mute-load FAILURE notice with a retry, not the signed-out gate', async ({ browser, request }) => {
    const labels = await servedLabels(request);
    const failed = labels.ALERTS_MUTE_LOAD_FAILED;
    const retry = labels.ALERTS_MUTE_LOAD_RETRY;
    expect(failed, 'ALERTS_MUTE_LOAD_FAILED missing from the served labels and shipped defaults').toBeTruthy();

    const { ctx, page, prefRequests } = await openAlertsClientSide(browser, true);
    try {
      await expect(page.getByText(failed, { exact: false }),
        'a signed-in user with no token was NOT shown the mute-load failure notice - the timeout is being read as "signed out" or as "nothing configured" (#1167)')
        .toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: retry }), 'the failure notice has no retry').toBeVisible();
      await expect(page.locator('.auth-gate'), 'the signed-out gate is showing for a user AuthProvider says is signed in').toHaveCount(0);
      expect(prefRequests, 'the page requested /api/alert-prefs with no token - it should not have reached the network').toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  test('CONTROL: the same flow with the token available loads the preferences and shows NO failure notice', async ({ browser, request }) => {
    const labels = await servedLabels(request);
    const failed = labels.ALERTS_MUTE_LOAD_FAILED;

    const { ctx, page, prefRequests } = await openAlertsClientSide(browser, false);
    try {
      await expect.poll(() => prefRequests.some(r => r.startsWith('GET')), {
        message: 'with a token the alerts page never requested /api/alert-prefs - the control did not reach the load it is a control for',
        timeout: 20_000,
      }).toBe(true);
      await page.waitForTimeout(2_000);
      await expect(page.getByText(failed, { exact: false }),
        'the failure notice showed for a user whose token IS available - it is always on, so the first test proves nothing').toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
