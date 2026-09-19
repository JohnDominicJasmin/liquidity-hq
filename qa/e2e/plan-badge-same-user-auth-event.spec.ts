import { test, expect, type Page } from '@playwright/test';
import { SUPABASE_URL, AUTH_READY, AUTH_SKIP_REASON, signedInContext } from './_auth';

/* #1376 (fix #1378, Dev Team) - AuthProvider's onAuthStateChange handler did
 * `if (u) setEntitlementsLoading(true)` for EVERY event carrying a user. The flag
 * is only ever reset by the entitlements fetch effect, which is keyed on
 * `userId` and does not re-run for the same user. So any SAME-user event left it
 * true for the rest of the page's life, and PlanBadge
 * (`if (... || entitlementsLoading) return null`) vanished until reload.
 * supabase-js fires exactly such an event - SIGNED_IN - when a tab regains
 * visibility, and a token refresh takes the same path. LIVE IN PRODUCTION.
 *
 * THE FIX: `if (u && u.id !== userIdRef.current) setEntitlementsLoading(true)`.
 * A different user still gets the flag; a same-user event no longer does.
 *
 * WHY THE TRIGGER IS WHAT MAKES THIS MEANINGFUL. Asserting that a badge is still
 * there after "something that should not remove it" is a vacuous pass unless the
 * something demonstrably CAN remove it. Two things carry that here:
 *   1. The bubbling `visibilitychange` (hidden then visible) reaches supabase-js's
 *      `window` listener and triggers its re-fire of SIGNED_IN. Against a build
 *      WITHOUT the fix the badge vanishes for good (Dev observed it gone at
 *      +0.2s, +1.5s and +4s and through two more cycles). RUN THIS FILE AGAINST A
 *      PRE-FIX BUILD BEFORE BELIEVING A GREEN ONE - qa served the bug until #1378
 *      is promoted, so a run there is the red run this file needs.
 *   2. The NON-BUBBLING control: the same events dispatched without `bubbles: true`
 *      never reach supabase-js's `window` listener, so nothing changes on either
 *      build. That puts the cause in the auth event, not in the harness.
 *
 * AND THE OTHER DIRECTION - a condition that stops the flag firing must still
 * fire it for a NEW user (the race the line exists for: a new user paired with a
 * stale `false`). A SIGNED_IN for a DIFFERENT user is delivered over the
 * BroadcastChannel supabase-js listens on, from a second page in the same
 * context, with the entitlements read delayed: the badge must go blank for the
 * length of the read and come back. A fix that simply disabled the flag for
 * everyone would pass the same-user checks and fail this one.
 *
 * NEGATIVE READS ARE INSTANTANEOUS ON PURPOSE. "Is the badge there at +0.2s" is
 * read with `count()`, not an auto-retrying `expect`, because an `expect` that
 * waits would sit through a blank badge until it reappeared and hide exactly the
 * defect being tested.
 *
 * NOT COVERED, stated so a green run is not read as more: a REAL tab switch in a
 * real, headed browser. The trigger is a synthetic `visibilitychange`; headless
 * Chromium reports every page visible, so it cannot drive a genuine one. Also not
 * covered: the duration of any real-world recovery.
 *
 * `plan-badge-no-flash.spec.ts` (the cold-load race this line was written for) is
 * the fourth check in #1378's "How to test" and is a separate existing file: run it
 * beside this one. No AI credits, no writes to the fixture accounts.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

// :visible - TerminalNav has a second (mobile-header) mount, so two nodes exist at
// every viewport and only one is shown. Both root classes: FREE renders as
// `.plan-badge-free-text`, not `.plan-badge` (see plan-badge-no-flash.spec.ts).
const BADGE = '.plan-badge:visible, .plan-badge-free-text:visible';
const AUTH_KEY = () => `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

/** Hidden then visible, with or without `bubbles`. supabase-js listens on
 *  `window`, so only a bubbling event from `document` reaches it. The overridden
 *  getters are deleted straight away so the real (visible) state is what
 *  supabase-js's async handler sees when it checks. */
async function visibilityCycle(page: Page, bubbles: boolean) {
  await page.evaluate((b) => {
    const doc = document as unknown as Record<string, unknown>;
    const set = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: b }));
    };
    set('hidden');
    set('visible');
    delete doc.visibilityState;
    delete doc.hidden;
  }, bubbles);
}

async function proBadgeIsUp(page: Page) {
  const badge = page.locator(BADGE);
  await expect(badge, 'no plan badge before the trigger - this run measures nothing').toBeVisible({ timeout: 20_000 });
  await expect(badge.first(), 'account A is pinned Pro; the badge must read PRO before the trigger').toContainText('PRO', { timeout: 20_000 });
  return badge;
}

/** Instantaneous reads at fixed offsets after the trigger; returns what was seen. */
async function sampleBadge(page: Page, offsetsMs: number[]) {
  const badge = page.locator(BADGE);
  const seen: Array<{ atMs: number; count: number; text: string }> = [];
  let elapsed = 0;
  for (const at of offsetsMs) {
    await page.waitForTimeout(at - elapsed);
    elapsed = at;
    const count = await badge.count();
    seen.push({ atMs: at, count, text: count ? (await badge.first().innerText().catch(() => '')).trim() : '' });
  }
  return seen;
}

test.describe('The plan badge survives a same-user auth event, and a different user still reloads it (#1376)', () => {
  test('a BUBBLING visibilitychange (tab refocus) leaves the PRO badge in place at +0.2s, +1.5s and +3s, over three rounds', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await page.goto('/dashboard');
      await proBadgeIsUp(page);

      for (let round = 1; round <= 3; round++) {
        await visibilityCycle(page, true);
        const seen = await sampleBadge(page, [200, 1_500, 3_000]);
        const gone = seen.filter(s => s.count === 0);
        expect(gone, `round ${round}: the plan badge VANISHED after a same-user auth event ` +
          `(${seen.map(s => `+${s.atMs}ms: ${s.count ? s.text : 'GONE'}`).join(', ')}). ` +
          'entitlementsLoading is stuck true - #1376. On the pre-fix build it stays gone until reload.').toHaveLength(0);
        for (const s of seen) expect(s.text, `round ${round} +${s.atMs}ms: badge present but not PRO`).toContain('PRO');
      }
    } finally {
      await ctx.close();
    }
  });

  test('CONTROL: the same events WITHOUT bubbling never reach supabase-js and change nothing', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await page.goto('/dashboard');
      await proBadgeIsUp(page);

      await visibilityCycle(page, false);
      const seen = await sampleBadge(page, [200, 1_500, 3_000]);
      expect(seen.filter(s => s.count === 0),
        `the badge changed on a NON-bubbling event (${seen.map(s => `+${s.atMs}ms: ${s.count ? s.text : 'GONE'}`).join(', ')}) - ` +
        'that event cannot reach supabase-js, so something else in the harness is removing it and the bubbling result above is not about #1376').toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  test('a SIGNED_IN for a DIFFERENT user still blanks the badge for the entitlements read, then brings it back', async ({ browser }) => {
    const DELAY_MS = 2_500;
    const ctx = await signedInContext(browser, 'a');
    const ctxB = await signedInContext(browser, 'b');
    const page = await ctx.newPage();
    try {
      // Read B's real session blob out of a second context that was seeded as B.
      const pageB = await ctxB.newPage();
      await pageB.goto('/robots.txt', { waitUntil: 'domcontentloaded' });
      const bSession = await pageB.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), AUTH_KEY());
      expect(bSession?.user?.id, 'could not read account B\'s session out of its seeded context - cannot build a different-user event').toBeTruthy();

      let entitlementReads = 0;
      let delaying = false;
      await page.route(`${SUPABASE_URL}/rest/v1/**`, async route => {
        if (!/user_subscriptions/.test(route.request().url()) || !delaying) return route.fallback();
        entitlementReads++;
        await new Promise(r => setTimeout(r, DELAY_MS));
        return route.fallback();
      });

      await page.goto('/dashboard');
      await proBadgeIsUp(page);

      // Deliver B's SIGNED_IN over the channel supabase-js listens on, from a
      // second page of the SAME context (BroadcastChannel does not cross contexts).
      const sender = await ctx.newPage();
      await sender.goto('/robots.txt', { waitUntil: 'domcontentloaded' });
      delaying = true;
      await sender.evaluate(([key, session]) => {
        const ch = new BroadcastChannel(key as string);
        ch.postMessage({ event: 'SIGNED_IN', session });
        ch.close();
      }, [AUTH_KEY(), bSession] as [string, unknown]);

      // The flag must fire for a NEW id: the badge goes blank within the window...
      const badge = page.locator(BADGE);
      let sawBlank = false;
      const until = Date.now() + DELAY_MS;
      while (Date.now() < until) {
        if ((await badge.count()) === 0) { sawBlank = true; break; }
        await page.waitForTimeout(50);
      }
      expect(sawBlank, 'a SIGNED_IN for a DIFFERENT user did not blank the badge - the fix disabled the loading flag for a new id too, ' +
        'which reopens the race (a new user paired with a stale `false`) the line exists for').toBe(true);
      expect(entitlementReads, 'no fresh entitlements read was issued for the new user').toBeGreaterThan(0);

      // ...and comes back once the read settles - not stuck. Any plan text: what
      // the read resolves to for B is B's own answer, not something asserted here.
      await expect(badge, 'the badge never came back after the different-user read settled - stuck loading').toBeVisible({ timeout: DELAY_MS + 15_000 });
    } finally {
      await ctxB.close();
      await ctx.close();
    }
  });
});
