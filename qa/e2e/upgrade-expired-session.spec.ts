import { test, expect } from '@playwright/test';
import { useEntitledSession } from './_entitled-session';

/* /upgrade MUST RESOLVE FOR A BROWSER HOLDING AN EXPIRED SESSION (#727).
 *
 * QA found `/upgrade` stuck on "Loading…" indefinitely when the browser holds
 * an expired Supabase session, on deployed staging, twice, on a warm service.
 * Removing that one localStorage key made it render instantly.
 *
 * WHO THIS HITS: every returning user, eventually. Tokens expire by design, so
 * an expired token is the ORDINARY state of a browser between visits - not an
 * edge case. Those users can browse the whole product normally and hit a wall
 * only when they try to pay, which also makes it hard to notice: nothing else
 * is broken and they have no reason to suspect their session.
 *
 * WHY THE EXISTING SUITE WAS GREEN THROUGHOUT. Playwright starts every test
 * with a fresh context and empty storage, so every check either of us ran
 * exercised the ANONYMOUS path - which genuinely resolves in 2-3 seconds. The
 * four passing runs I reported on #243 were correct and measured the wrong
 * state. "Suite green, user blocked" is the shape worth naming, and the fix
 * for it is a fixture that can express the states real browsers are actually
 * in rather than only the empty one.
 */

test.describe('#727 /upgrade with an expired session', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the page resolves instead of hanging on Loading', async ({ page }) => {
    await useEntitledSession(page, { as: 'expired' });
    await page.goto('/upgrade');

    /* The failure is a page that never leaves its loading branch, so the
       assertion is "something other than the spinner arrived", not a specific
       CTA - whether checkout is CONFIGURED is a separate question this must not
       be coupled to (it is unset on qa and set on staging, and #727 is true on
       both). Either the pricing content or a redirect is a pass; only the
       spinner forever is a failure. */
    const resolved = await page
      .locator('[data-testid^="checkout-cta"], [data-testid="locked-feature"], h1, h2')
      .first()
      .waitFor({ state: 'attached', timeout: 25_000 })
      .then(() => true)
      .catch(() => false);

    const mainText = (await page.locator('main').first().innerText().catch(() => '')).slice(0, 60);

    expect(
      resolved,
      `/upgrade never left its loading branch with an expired session in localStorage. ` +
      `main showed: "${mainText}". This is the state every returning user's browser is in.`,
    ).toBe(true);

    /* And specifically not the spinner. `resolved` can be true while the
       loading branch is still what a user sees, since LoadingState renders its
       own markup - so the text is checked directly rather than inferred. */
    expect(mainText, 'the page is still showing its loading state after 25s').not.toMatch(/^Loading/i);
  });

  test('CONTROL: the anonymous path resolves, so a pass above is not vacuous', async ({ page }) => {
    /* Without this, the test above passing proves only that /upgrade renders
       SOMETHING - not that the expired session was the variable. This is the
       path the whole suite was already exercising, and it was always green;
       it is here to keep the comparison honest rather than to find anything. */
    await page.goto('/upgrade');

    /* Poll, do not sample. "Loading…" is a REAL transient state on this page
       for two to three seconds while Supabase resolves the absent session -
       reading innerText immediately after goto() catches it every time and
       reports the healthy path as stuck. My first version did exactly that and
       failed the control while the actual fix was working. */
    await expect
      .poll(async () => (await page.locator('main').first().innerText().catch(() => '')).slice(0, 60),
        { timeout: 25_000, message: 'even the anonymous path is stuck - the finding is wider than #727 describes' })
      .not.toMatch(/^Loading/i);
  });
});
