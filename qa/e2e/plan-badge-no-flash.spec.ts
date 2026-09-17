import { test, expect } from '@playwright/test';
import { SUPABASE_URL, AUTH_READY, AUTH_SKIP_REASON, signedInContext } from './_auth';

/* #1095's fix, regression-guarded: a Pro (or Trial) account must never
 * paint FREE for a frame while the subscription-row fetch is in flight.
 *
 * #1090 caught this live: `role` defaults to 'free' in AuthProvider until
 * the `user_subscriptions` read settles, and before #1095 nothing gated
 * PlanBadge on that specific fetch - only on session/auth loading, which
 * resolves first. #1095 added `entitlementsLoading` to close it.
 *
 * WHY A DELAYED REAL RESPONSE, NOT A TIMING RACE AGAINST REAL LATENCY.
 * Racing this deployed qa service's real response time would make the test
 * only sometimes wide enough to observe the frame in question - exactly the
 * flakiness `plan-badge-trial-flip.spec.ts` hit and fixed by trusting
 * `expect()`'s polling instead of guessing a duration. Here the property
 * under test IS the timing (does a wrong state ever render before the
 * right one), so the fix has to be a wide, artificial window instead: the
 * subscription-row response is intercepted and delayed 2s before answering
 * with account A's REAL data (role: 'pro'), and the badge is polled
 * throughout that window. This proves the same thing a real slow response
 * would, without depending on one actually happening during the run.
 *
 * If `entitlementsLoading` regresses (a future AuthProvider refactor drops
 * the gate, the way #1095's own PR description warns), this goes red
 * immediately - the badge would render FREE for roughly 2s before flipping
 * to PRO, and the poll below catches that window on every run, not just an
 * unlucky one. */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

test('PlanBadge never renders FREE while entitlements are still resolving', async ({ browser }) => {
  const ctx = await signedInContext(browser, 'a');
  const page = await ctx.newPage();

  const DELAY_MS = 2_000;

  await page.route(`${SUPABASE_URL}/rest/v1/**`, async route => {
    const url = route.request().url();
    if (!/user_subscriptions/.test(url)) return route.fallback();
    await new Promise(res => setTimeout(res, DELAY_MS));
    const row = { role: 'pro', trial_ends_at: null };
    const single = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(single ? row : [row]),
    });
  });

  await page.goto('/dashboard');

  // :visible, not a bare .plan-badge - #1120 gave TerminalNav a second mount
  // (mobile header, alongside the desktop one), so two DOM nodes exist at
  // every viewport regardless of which is actually shown; only one is ever
  // visible. A bare locator strict-mode-violates the assertion below on
  // that, and .first() in the polling loop would silently read whichever
  // DOM node happens to come first rather than the one a user can see.
  //
  // BOTH root classes - #1142 (option A) renders FREE as plain
  // `.plan-badge-free-text`, not `.plan-badge`. Scoping to `.plan-badge`
  // alone would make this poll blind to the exact regression it exists to
  // catch: if entitlementsLoading ever regresses and FREE paints early, that
  // FREE now carries a class this locator wouldn't see, sawFree would stay
  // false for the wrong reason, and the test would pass through a real
  // regression silently.
  const badge = page.locator('.plan-badge:visible, .plan-badge-free-text:visible');
  /* #1259: was DELAY_MS + 1_000 (3s total). Passed locally, failed in CI -
   * `sawAnyBadge` stayed false the whole poll window even though the badge
   * DID reach PRO correctly (the separate toContainText check below, with
   * its own 10s budget, passed). The artificial 2s delay is only one part
   * of the real wait: session/auth resolution runs before the intercepted
   * fetch even starts, and CI's shared, slower hardware stretches that part
   * further than local dev ever showed. Matching the poll window to the
   * same 10s budget the final assertion already trusts removes the gap
   * without weakening what's being checked - widening when the property is
   * "did X ever happen in this window" only improves coverage, it can't
   * produce a false pass that a tighter window wouldn't also have produced. */
  const deadline = Date.now() + DELAY_MS + 8_000;
  let sawFree = false;
  let sawAnyBadge = false;

  while (Date.now() < deadline) {
    const count = await badge.count();
    if (count > 0) {
      sawAnyBadge = true;
      const text = await badge.first().innerText().catch(() => '');
      if (text.includes('FREE')) { sawFree = true; break; }
      if (text.includes('PRO')) break; // resolved correctly, stop polling
    }
    await page.waitForTimeout(50);
  }

  expect(sawFree, 'PlanBadge rendered FREE before the subscription fetch resolved - #1095 regressed').toBe(false);

  // Confirm it actually reaches the correct final state, not just "never
  // showed FREE because the badge never rendered at all".
  await expect(badge).toContainText('PRO', { timeout: 10_000 });
  expect(sawAnyBadge).toBe(true);

  await ctx.close();
});
