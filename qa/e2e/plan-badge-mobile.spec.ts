import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext } from './_auth';

/* #1090's PlanBadge at mobile width, both design modes.
 *
 * Landed for where the badge lives, not because anything was assumed clean:
 * it sits in the tightest real estate in the product - next to the avatar,
 * in a nav that already carries a logo, six items, a theme toggle and a
 * language switcher, at 390px. A test that only needs to notice "is the
 * plan badge visible and does it say PRO" is a small price against a defect
 * class (chrome quietly pushing an element off-screen) that is otherwise
 * invisible by nature, since nobody looks at mobile nav on purpose.
 *
 * It found exactly that class of defect on the first run: current design
 * passed, terminal design did not (#1094). #1120 fixed it - `TerminalNav.tsx`
 * now mounts a SECOND `PlanBadge` in `.tnav-mhead` for mobile, alongside the
 * pre-existing desktop one in `.tnav-right`. Both exist in the DOM at every
 * viewport now; only CSS visibility (`.tnav`/`.tnav-mhead`'s own media
 * queries) decides which one a real user sees. That is why every locator
 * below is `.plan-badge:visible`, not a bare `.plan-badge` - a bare one now
 * strict-mode-violates on two DOM nodes at ANY viewport, which is a
 * consequence of the fix landing correctly, not a regression in it (checked
 * directly: exactly one of the two is ever visible, at both 1440px and
 * 390px, before scoping these locators).
 *
 * Scoped to what these two cases actually check: the badge renders, at
 * mobile width, in each design mode. Not re-proving Pro/Free/Trial state
 * logic itself - that's plan-badge-trial-flip.spec.ts's job, and
 * PlanBadge.tsx's own rendering logic doesn't branch on viewport at all, so
 * there is no separate "mobile logic" to cover here - only mobile LAYOUT.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

test('PlanBadge renders at mobile width, design=current', async ({ browser }) => {
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/dashboard?design=current');

  const badge = page.locator('.plan-badge:visible');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toContainText('PRO');

  await ctx.close();
});

/* #1094, closed by #1120: terminal's mobile chrome (.tnav-mhead) now mounts
 * its own PlanBadge, matching the desktop bar's. This test's first draft
 * (before #1120) asserted the badge visible unconditionally and genuinely
 * failed here - test.fail() documented that known gap without reddening the
 * suite for it. #1120 shipped the fix; this is that promised follow-up,
 * confirmed live against deployed qa before removing the annotation. */
test('PlanBadge renders at mobile width, design=terminal (#1094, fixed by #1120)', async ({ browser }) => {
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/dashboard?design=terminal');

  const badge = page.locator('.plan-badge:visible');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toContainText('PRO');

  await ctx.close();
});
