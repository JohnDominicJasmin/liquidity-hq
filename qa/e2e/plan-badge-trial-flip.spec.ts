import { test, expect } from '@playwright/test';
import { SUPABASE_URL, AUTH_READY, AUTH_SKIP_REASON, signedInContext } from './_auth';

/* #1090's PlanBadge Trial state, and the Trial->Free flip at trialEndsAt.
 *
 * NEITHER seeded fixture carries an active trial - A is pinned role='pro',
 * B is pinned role='free', both trial_ends_at NULL (see _auth.ts). So a real
 * account cannot exercise Trial without a shared-database write, which is
 * owner-only. `_entitled-session.ts`'s 'trial' option exists, but it uses the
 * unsigned-JWT v1-shape session that file's own comment documents as failing
 * to render the terminal nav's signed-in surface at all (#747) - PlanBadge
 * sits in that exact surface, next to the avatar, so that fixture would just
 * reproduce the known gap rather than test anything new.
 *
 * This uses a REAL minted session (account B, via signedInContext - a
 * genuine supabase-js v2 session, confirmed by hand to render the nav
 * correctly), with only the ONE subscription-row fetch intercepted to answer
 * as a trial. That is the same "fake exactly one network response, run
 * everything else as shipped" discipline `_entitled-session.ts` itself
 * documents, applied to a session that does not carry that fixture's
 * rendering gap.
 *
 * isTrial is fully client-side (AuthProvider.tsx: role/trialEndsAt come from
 * one PostgREST select, clock is local state, the flip is a single scheduled
 * setTimeout) - so Playwright's page.clock can drive the whole boundary
 * without any server-side time control. trialEndsAt is pinned 5s past the
 * FROZEN clock rather than real wall time, so it stays in the future no
 * matter how long the page actually takes to load - `page.clock.install`
 * stops the page's own Date.now() from advancing until fastForward is
 * called, so real navigation latency (this dev Supabase project has known,
 * documented latency spikes - see #949/#1025) cannot age it out.
 *
 * A generous 30s assertion timeout, not a fixed sleep before it: a fixed
 * sleep is a guess at how long the deployed qa service takes to answer,
 * and it guessed wrong intermittently in testing - one run was still
 * showing the page's own "Loading..." placeholder 4s after navigation.
 * expect()'s own polling handles arbitrary slowness without a magic number.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

test('PlanBadge shows Trial, then flips to Free at trialEndsAt with no reload', async ({ browser }) => {
  const ctx = await signedInContext(browser, 'b');
  const page = await ctx.newPage();

  const nowMs = Date.now();
  const trialEndsAtMs = nowMs + 5_000;

  await page.clock.install({ time: nowMs });

  await page.route(`${SUPABASE_URL}/rest/v1/**`, async route => {
    const url = route.request().url();
    if (!/user_subscriptions/.test(url)) return route.fallback();
    const row = { role: 'free', trial_ends_at: new Date(trialEndsAtMs).toISOString() };
    const single = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(single ? row : [row]),
    });
  });

  await page.goto('/dashboard');

  const badge = page.locator('.plan-badge');
  await expect(badge).toContainText('TRIAL', { timeout: 30_000 });

  // Cross trialEndsAt. AuthProvider schedules its re-render for (ms + 1000)
  // past the boundary, so clear that margin too.
  await page.clock.fastForward((trialEndsAtMs - nowMs) + 2_000);

  await expect(badge).toContainText('FREE', { timeout: 10_000 });

  await ctx.close();
});
