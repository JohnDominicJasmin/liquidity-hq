/* #2192 / #1263: the Draw Structure menu has an open state.
 *
 *   M1  open after the read      the menu is open when a read finishes; aria-expanded is true
 *   M2  Escape closes it         lines stay (button stays "on"), focus returns to the button
 *   M2b click-away closes it     a press elsewhere closes it, lines stay
 *   M3  the button reopens it    NO new /api/draw-structure request; a second press closes it again
 *   M4  Clear removes the lines  menu closes, button no longer "on"; the next press requests again
 *
 * "Lines stay" is read off the button: it carries the class "on" while proposals exist, and the lines live in
 * the same state. The drawn pixels are checked by eye in the sign-off shots (draw-structure-closed-*.png).
 *
 * ZERO AI SPEND: /api/draw-structure is FULFILLED with the real response shape (the one signoff-shots uses),
 * so the route never runs. The fence goes in first and the stub second (Playwright matches the most
 * recently registered handler first). The request counter is the evidence for M3 and M4. */
import { test, expect, type Page } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';

test.describe('#2192 the Draw Structure menu can be closed and reopened', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 180_000 });

  async function arrange(page: Page) {
    await installPaidAiFence(page);
    const calls = { n: 0 };
    await page.route('**/api/draw-structure', async (route) => {
      calls.n += 1;
      const HOUR = 3_600_000;
      const t0 = Math.floor(Date.now() / HOUR) * HOUR - 120 * HOUR;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          structures: ['trendline', 'channel', 'horizontal'].map((type, n) => ({
            type, side: n % 2 ? 'high' : 'low',
            touchTimestamps: [t0 + n * 10 * HOUR, t0 + (n * 10 + 30) * HOUR, t0 + (n * 10 + 60) * HOUR],
            from: { timestamp: t0 + n * 10 * HOUR, price: 100 + n },
            to: { timestamp: t0 + (n * 10 + 60) * HOUR, price: 110 + n },
          })),
        }),
      });
    });
    await gotoSignedIn(page, '/arena');
    await page.waitForTimeout(6_000);
    const tfBtn = page.getByRole('button', { name: /^4h$/ }).first();
    if (await tfBtn.count()) { await tfBtn.click({ timeout: 10_000 }).catch(() => {}); await page.waitForTimeout(6_000); }
    const btn = page.locator('.klc-draw-btn').first();
    await btn.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
    await btn.click({ timeout: 10_000 });
    const menu = page.locator('.klc-draw-menu');
    await expect(menu, 'the menu did not open when the read finished').toBeVisible({ timeout: 30_000 });
    return { calls, btn, menu };
  }

  const run = (name: string, body: (a: Awaited<ReturnType<typeof arrange>>, page: Page) => Promise<void>) =>
    test(name, async ({ browser }) => {
      const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 1000 } });
      const page = await ctx.newPage();
      try {
        const a = await arrange(page);
        expect(a.calls.n, 'the read was not requested exactly once').toBe(1);
        await body(a, page);
        assertNoUnstubbedPaidAi(page, 'draw-structure-menu');
      } finally { await ctx.close(); }
    });

  run('M1. open after the read: the menu is visible, lists the proposals and aria-expanded is true', async ({ btn, menu }) => {
    await expect(menu.locator('.klc-draw-item', { hasText: /Trend line/i }).first()).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(btn).toHaveClass(/\bon\b/);
  });

  run('M2. Escape closes the menu, the lines stay and focus returns to the button', async ({ btn, menu }, page) => {
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden({ timeout: 5_000 });
    await expect(btn, 'Escape removed the lines: the button is no longer "on"').toHaveClass(/\bon\b/);
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn, 'focus did not return to the button').toBeFocused();
  });

  run('M2b. a press elsewhere closes the menu and the lines stay', async ({ btn, menu }, page) => {
    await page.mouse.click(5, 5);
    await expect(menu).toBeHidden({ timeout: 5_000 });
    await expect(btn).toHaveClass(/\bon\b/);
  });

  run('M3. the button reopens the menu with NO new request, and a second press closes it', async ({ calls, btn, menu }, page) => {
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden({ timeout: 5_000 });
    await btn.click();
    await expect(menu, 'the button did not reopen the menu').toBeVisible({ timeout: 5_000 });
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await page.waitForTimeout(1_500);
    expect(calls.n, 'reopening the menu made a new /api/draw-structure request: it spent another read').toBe(1);
    await btn.click();
    await expect(menu, 'a second press did not close the menu').toBeHidden({ timeout: 5_000 });
    expect(calls.n).toBe(1);
  });

  run('M4. Clear removes the lines and closes the menu; the next press requests again', async ({ calls, btn, menu }, page) => {
    await menu.locator('.klc-draw-clear').click();
    await expect(menu).toBeHidden({ timeout: 5_000 });
    await expect(btn, 'Clear left the lines: the button is still "on"').not.toHaveClass(/\bon\b/);
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect.poll(() => calls.n, { timeout: 15_000, message: 'with no lines the button must request again' }).toBe(2);
  });
});
