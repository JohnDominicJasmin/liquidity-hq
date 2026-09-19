import { test, expect } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON, SUPABASE_URL } from './_auth';

/* #1347/#1348 item 19 (#1355, fix by Dev Team) - components/TimezoneSync.tsx
 * gated its automatic settings write on `loading`, which flips false as
 * soon as the SYNCHRONOUS localStorage read completes on mount - well
 * before settingsLoadStatus's authoritative DB read resolves, and stays
 * false even when that read fails outright. Comparing the browser's real
 * timezone against `settings.timezone` at that point compared against a
 * stale/default value, not the account's real saved one - the same
 * "acted before the authoritative source landed" shape as item 2, on the
 * one component in this audit that writes with NO visible UI at all: a
 * bad write here has no chip, no banner, no error state - just a silent
 * `timezone` PATCH.
 *
 * THE FIX (read before writing this, components/TimezoneSync.tsx diff):
 * `if (loading) return;` -> `if (settingsLoadStatus !== 'ready') return;`.
 * Same pattern as every other settingsLoadStatus consumer from this audit.
 *
 * HOW THIS WAS FOUND: not by code reading. A captured `/api/settings` PATCH
 * body during arena-failed-settings-read.spec.ts's failure injection showed
 * `{"timezone":"...","knownAsOf":{}}` firing mid-failure, unrelated to
 * strategy_selection - traced to this component independently by both QA
 * (from that spec's false-failed assertion) and Dev (from the same kind of
 * hand-exercise). Two instruments, neither looking for this specifically.
 *
 * FOUR ASSERTIONS, per Dev's proposal on #1355 (items 1-3) and PM/DevOps's
 * addition (item 4, the sticky-ready interaction) - written against the
 * real fix, not the proposal's wording:
 *   1. A genuinely failed user_settings read: zero timezone PATCHes for as
 *      long as the failure persists.
 *   2. Once the read succeeds with a real mismatch: exactly one PATCH,
 *      carrying the correct timezone.
 *   3. A read that succeeds with the timezone ALREADY matching: zero
 *      redundant PATCHes (existing behaviour, unaffected by this fix,
 *      worth a regression check since it shares the same effect).
 *   4. Sticky-ready interaction: once settingsLoadStatus has reached
 *      'ready', a failed BACKGROUND refresh (the Alerts-page Telegram-link
 *      poll, same mechanism as arena-sticky-ready-background-refresh.spec.ts)
 *      must not stop a subsequent real mismatch from correcting - this fix
 *      now depends on item 2's sticky-ready guarantee, and a regression
 *      there would silently stop this sync with nothing on screen to show
 *      it, which is exactly why it gets its own assertion here rather than
 *      being assumed from item 2's own test passing.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

async function resetTimezone(page: import('@playwright/test').Page, timezone: string) {
  const result = await page.evaluate(async (tz) => {
    const raw = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const token = raw ? JSON.parse(localStorage.getItem(raw)!).access_token : null;
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timezone: tz, knownAsOf: { timezone: new Date().toISOString() } }),
    });
    const body = await res.json();
    localStorage.removeItem('lhq_settings_v1');
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('lhq_settings_unconfirmed_v1')) localStorage.removeItem(k);
    }
    return { status: res.status, accepted: body.accepted as string[] | undefined };
  }, timezone);
  expect(result.accepted, `timezone reset was rejected by the concurrency guard: ${JSON.stringify(result)}`)
    .toContain('timezone');
}

function trackTimezonePatches(page: import('@playwright/test').Page): { count: () => number; bodies: string[] } {
  const bodies: string[] = [];
  page.on('request', req => {
    if (req.method() !== 'PATCH' || !req.url().includes('/api/settings')) return;
    const body = req.postData() ?? '';
    if (body.includes('"timezone"')) bodies.push(body);
  });
  return { count: () => bodies.length, bodies };
}

test.describe('TimezoneSync must not write before settings are ready, and must still correct once they are (#1348 item 19)', () => {
  test('a genuinely failed settings read fires zero timezone PATCHes', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      const tracker = trackTimezonePatches(page);
      await page.route(`${SUPABASE_URL}/rest/v1/**`, route => {
        const url = route.request().url();
        if (!/user_settings/.test(url)) return route.fallback();
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'simulated failure' }) });
      });

      await page.goto('/about');
      // Give the failed read + any (incorrect) sync attempt time to fire -
      // if the fix has regressed, the old code fired immediately on mount
      // once `loading` flipped false, well within this window.
      await page.waitForTimeout(4_000);

      expect(tracker.count(), `a failed settings read must not produce a timezone PATCH - got ${tracker.count()}: ${JSON.stringify(tracker.bodies)}`).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  test('a successful read with a real mismatch fires exactly one correcting PATCH', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      // Seed an obviously-wrong saved timezone so any real browser locale
      // counts as a mismatch, deterministically.
      await gotoSignedIn(page, '/about');
      await resetTimezone(page, 'Pacific/Kiritimati');

      const tracker = trackTimezonePatches(page);
      await page.goto('/about');

      await expect.poll(tracker.count, {
        message: 'the corrected timezone PATCH never fired after a successful read with a real mismatch',
        timeout: 10_000,
      }).toBeGreaterThan(0);

      expect(tracker.count(), `expected exactly one correcting PATCH, got ${tracker.count()}: ${JSON.stringify(tracker.bodies)}`).toBe(1);
      expect(tracker.bodies[0], 'the PATCH must not still carry the seeded mismatched value').not.toContain('Pacific/Kiritimati');
    } finally {
      await ctx.close();
    }
  });

  test('a successful read where the timezone already matches fires zero redundant PATCHes', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      // First load lets the real sync correct the account to the browser's
      // actual timezone (whatever it legitimately is in this environment).
      await gotoSignedIn(page, '/about');
      await page.waitForTimeout(3_000);

      // Second load: now tracking. If the first load's correction landed,
      // this one should see the values already equal and write nothing.
      const tracker = trackTimezonePatches(page);
      await page.goto('/about');
      await page.waitForTimeout(4_000);

      expect(tracker.count(), `a read where the account's timezone already matches the browser's must not fire a redundant PATCH - got ${tracker.count()}: ${JSON.stringify(tracker.bodies)}`).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  test('sticky-ready: a failed background refresh does not stop a real mismatch from correcting afterward', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      // Reach 'ready' first with a real mismatch already seeded, so the
      // FIRST load's own correction is expected and not part of what this
      // test is checking - only the SECOND mismatch, introduced after a
      // background failure, is the actual assertion.
      await gotoSignedIn(page, '/about');
      await resetTimezone(page, 'Pacific/Kiritimati');
      const firstLoadTracker = trackTimezonePatches(page);
      await page.goto('/about');
      await expect.poll(firstLoadTracker.count, { timeout: 10_000 }).toBeGreaterThan(0);

      // Inject a background failure and trigger a real refresh() via the
      // same mechanism as arena-sticky-ready-background-refresh.spec.ts -
      // the Alerts page's Telegram-link poll.
      await page.route(`${SUPABASE_URL}/rest/v1/**`, route => {
        const url = route.request().url();
        if (!/user_settings/.test(url)) return route.fallback();
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'simulated background failure' }) });
      });
      await page.goto('/alerts');
      const connectBtn = page.getByRole('button', { name: /connect telegram/i });
      const alreadyLinked = await connectBtn.isVisible({ timeout: 5_000 }).catch(() => false);
      if (!alreadyLinked) {
        test.info().annotations.push({ type: 'result', description: 'SKIPPED MECHANISM: account already has Telegram linked, same fallback as arena-sticky-ready-background-refresh.spec.ts - not independently exercised this run.' });
        return;
      }
      await connectBtn.click();
      await page.waitForTimeout(4_000); // one poll tick against the injected failure

      // Now seed a NEW mismatch, clear the injected failure, and confirm a
      // fresh correcting PATCH still fires - proving settingsLoadStatus
      // never got stuck at 'error' from the background failure.
      await page.unroute(`${SUPABASE_URL}/rest/v1/**`);
      await resetTimezone(page, 'Pacific/Kiritimati');
      const secondTracker = trackTimezonePatches(page);
      await page.goto('/about');

      await expect.poll(secondTracker.count, {
        message: 'no correcting PATCH fired after the background failure - sticky-ready may have regressed, silently stopping this sync',
        timeout: 10_000,
      }).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });
});
