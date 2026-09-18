import { test, expect } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON, SUPABASE_URL } from './_auth';

/* #1347 item 11, the lock-icon half (#1370, fix by Dev Team) - #1338 made the
 * Arena QUICK and DEEP buttons `disabled` while `authLoading` is true, so a
 * click before sign-in resolves cannot bounce a signed-in user to /login. It
 * did not touch the lock icon, the tooltip or the `arena-deep-locked` class,
 * which stayed keyed on `!user` alone. While auth was resolving, `user` is
 * null for EVERYONE, so a signed-in user saw the "Sign in to use ..." lock and
 * tooltip on a button that was disabled for a different reason entirely.
 *
 * THE FIX: those three now gate on `!user && !authLoading` - the
 * CONFIRMED-signed-out state. While unknown, the button is neither locked nor
 * unlocked.
 *
 * HOW THE LOADING WINDOW IS MADE. `AuthProvider` resolves `loading` from
 * `getSession()`, which returns instantly for a valid stored session, so there
 * is normally no window to look at. An EXPIRED stored session makes
 * supabase-js call the refresh endpoint; this file holds that request and
 * never answers it, so `loading` stays true until AuthProvider's own
 * SESSION_RESOLVE_MS (8s) deadline treats "no answer" as "no session".
 *
 * That gives BOTH states in one run, which is the point: the buttons are
 * measured while the answer is unknown (no lock), and then again once the
 * deadline lapses and the visitor is confirmed signed-out (lock present). The
 * second half is what stops the first from being a vacuous pass - a button
 * that never shows a lock at all would satisfy "no lock while loading" too.
 *
 * NO REAL CREDENTIALS. The stored session is a fabricated, already-expired
 * blob, and the refresh request it triggers is held in the browser, never sent
 * - so nothing is signed in, no refresh token is rotated, and nothing touches
 * the shared fixture accounts' sessions. (Rotating a real one would risk
 * invalidating the cached session other specs reuse.)
 *
 * `useEMAStrategy`'s `selection = []` default became a required parameter in
 * the same PR. That is a compile-time change; `tsc` (the pre-push hook) is its
 * test, and there is nothing to assert in a browser.
 *
 * Not run yet: fix unmerged, machine is Dev's. Expected against `dev`/`qa`
 * without #1370: the "while resolving" test is RED (the lock class and sign-in
 * tooltip are present during the window); the "once resolved" tests are green
 * either way. No AI credits - nothing here presses QUICK or DEEP.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const expiredSession = (ref: string) => {
  const past = Math.floor(Date.now() / 1000) - 3600;
  return {
    key: `sb-${ref}-auth-token`,
    value: JSON.stringify({
      access_token: 'qa.expired.access-token',
      refresh_token: 'qa-expired-refresh-token',
      expires_in: 3600,
      expires_at: past,
      token_type: 'bearer',
      user: {
        id: '00000000-0000-0000-0000-000000000000', aud: 'authenticated', role: 'authenticated',
        email: 'qa-expired@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date(past * 1000).toISOString(),
      },
    }),
  };
};

test.describe('QUICK/DEEP lock icon and tooltip do not claim "signed out" while auth is still resolving (#1347 item 11)', () => {
  test('unknown auth shows neither lock nor sign-in tooltip; confirmed signed-out shows both', async ({ browser, request }) => {
    const labels = await (await request.get('/api/labels?locale=en')).json() as Record<string, string>;
    const quickSignin = labels.ARENA_QUICK_SIGNIN_TITLE;
    const deepSignin = labels.ARENA_DEEP_SIGNIN_TITLE;
    expect(quickSignin, 'ARENA_QUICK_SIGNIN_TITLE missing from /api/labels').toBeTruthy();
    expect(deepSignin, 'ARENA_DEEP_SIGNIN_TITLE missing from /api/labels').toBeTruthy();

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const held: Array<import('@playwright/test').Route> = [];
    try {
      const { key, value } = expiredSession(new URL(SUPABASE_URL).hostname.split('.')[0]);
      await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, [key, value] as [string, string]);
      // Held, never answered: the refresh neither resolves nor rejects, which
      // is exactly the state AuthProvider's 8s deadline exists for (#727).
      await page.route('**/auth/v1/token**', route => { held.push(route); });

      await page.goto('/arena', { waitUntil: 'domcontentloaded' });

      const quick = page.locator('button.arena-quick-btn');
      const deep = page.locator('button.arena-quick-btn + button');
      await expect(quick, 'the Arena QUICK button never rendered - this run measured nothing').toBeVisible({ timeout: 15_000 });

      // Proof we are INSIDE the loading window: #1338's `disabled={authLoading ...}`.
      // If this fails the window was missed (or the stored-session key did not
      // match this build's Supabase project), and everything below would be a
      // measurement of the wrong state.
      await expect(quick, 'QUICK is not disabled, so auth is not "still resolving" - the loading window was missed or the fabricated ' +
        'session was not picked up (its key is derived from NEXT_PUBLIC_SUPABASE_URL; it must match the build under test)').toBeDisabled();

      // THE ASSERTIONS UNDER TEST - unknown is neither locked nor unlocked.
      for (const [name, btn, signinTitle] of [['QUICK', quick, quickSignin], ['DEEP', deep, deepSignin]] as const) {
        await expect(btn, `${name} carries the arena-deep-locked class while auth is still resolving - it claims "signed out" about an unknown state`)
          .not.toHaveClass(/arena-deep-locked/);
        await expect(btn, `${name}'s tooltip reads "${signinTitle}" while auth is still resolving - a signed-in user would be told to sign in`)
          .not.toHaveAttribute('title', signinTitle);
        await expect(btn.locator('svg'), `${name} shows the padlock icon while auth is still resolving`).toHaveCount(0);
      }

      // CONTROL: once AuthProvider gives up waiting (8s) the visitor is
      // CONFIRMED signed-out, and the lock must appear - otherwise "no lock
      // while loading" above proves nothing.
      await expect(quick, 'after auth resolved to signed-out, QUICK must show the lock - the fix must not have removed it for the confirmed-signed-out case')
        .toHaveClass(/arena-deep-locked/, { timeout: 20_000 });
      await expect(quick).toHaveAttribute('title', quickSignin);
      await expect(deep).toHaveClass(/arena-deep-locked/);
      await expect(deep).toHaveAttribute('title', deepSignin);
      await expect(quick.locator('svg'), 'the padlock icon must be present once confirmed signed-out').toHaveCount(1);
    } finally {
      await Promise.allSettled(held.map(r => r.abort()));
      await ctx.close();
    }
  });

  test('CONTROL: a signed-in user whose session resolved sees the ordinary unlocked buttons', async ({ browser, request }) => {
    const labels = await (await request.get('/api/labels?locale=en')).json() as Record<string, string>;
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, '/arena');
      const quick = page.locator('button.arena-quick-btn');
      const deep = page.locator('button.arena-quick-btn + button');
      await expect(quick).toBeEnabled({ timeout: 20_000 });

      for (const [name, btn, signinTitle] of [['QUICK', quick, labels.ARENA_QUICK_SIGNIN_TITLE], ['DEEP', deep, labels.ARENA_DEEP_SIGNIN_TITLE]] as const) {
        await expect(btn, `${name}: a signed-in user must not see the locked state once auth has resolved`).not.toHaveClass(/arena-deep-locked/);
        await expect(btn, `${name}: a signed-in user must not see the sign-in tooltip`).not.toHaveAttribute('title', signinTitle);
        await expect(btn.locator('svg'), `${name}: no padlock for a signed-in user`).toHaveCount(0);
      }
    } finally {
      await ctx.close();
    }
  });
});
