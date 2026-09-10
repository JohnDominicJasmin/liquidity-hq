import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext } from './_auth';

/* #1090's PlanBadge at mobile width, both design modes.
 *
 * Landed for where the badge lives, not because anything was assumed clean:
 * it sits in the tightest real estate in the product - next to the avatar,
 * in a nav that already carries a logo, six items, a theme toggle and a
 * language switcher, at 390px. A test that only needs to notice "is
 * .plan-badge visible and does it say PRO" is a small price against a defect
 * class (chrome quietly pushing an element off-screen) that is otherwise
 * invisible by nature, since nobody looks at mobile nav on purpose.
 *
 * It found exactly that class of defect on the first run: current design
 * passes, terminal design does not (#1094 - see below). Scoped to what
 * these two cases actually check: the badge renders, at mobile width, in
 * each design mode. Not re-proving Pro/Free/Trial state logic itself -
 * that's plan-badge-trial-flip.spec.ts's job, and PlanBadge.tsx's own
 * rendering logic doesn't branch on viewport at all, so there is no separate
 * "mobile logic" to cover here - only mobile LAYOUT.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

test('PlanBadge renders at mobile width, design=current', async ({ browser }) => {
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/dashboard?design=current');

  const badge = page.locator('.plan-badge');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toContainText('PRO');

  await ctx.close();
});

/* #1094: terminal's mobile chrome (.tnav-mhead, .tnav-tabs, and the shared
 * off-canvas drawer) has NO PlanBadge mount at all - the component's only
 * terminal-mode instance lives in TerminalNav.tsx's `.tnav-right`, inside the
 * desktop-only `.tnav` header (`display:none` below 768px, globals.css:6446).
 * Since terminal is the default design everywhere (#748), this is a real,
 * currently-shipped gap, not a hypothetical future one - this is exactly how
 * it was found: this test's first draft asserted the badge visible
 * unconditionally in both designs and failed here.
 *
 * test.fail() rather than test.skip() or a plain failing assertion: this
 * documents a KNOWN, filed gap without reddening the suite for it, and
 * Playwright flips an "unexpected pass" the moment #1094 ships - which is
 * the signal to delete this annotation, not leave the gap silently closed. */
test('PlanBadge renders at mobile width, design=terminal (#1094)', async ({ browser }) => {
  test.fail();

  const ctx = await signedInContext(browser, 'a', { viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/dashboard?design=terminal');

  const badge = page.locator('.plan-badge');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toContainText('PRO');

  await ctx.close();
});
