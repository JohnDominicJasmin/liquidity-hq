/* #2071 / #1263: the five Arena coin-category chips must not signal selection by colour alone.
 *
 * Signed out on purpose. The chips render without auth, which makes this one of the few cells that
 * needs no fixture and cannot be blocked by the dev-auth state - so it keeps working when the
 * credentialed specs cannot run.
 *
 * C1 IS THE POSITIVE CONTROL AND EVERY OTHER CELL DEPENDS ON IT. "Exactly one chip is pressed" is
 * vacuously FALSE and "no chip is wrongly pressed" is vacuously TRUE when the selector matches
 * nothing, so a renamed class would read as either a pass or a failure depending on which way the
 * assertion points. Pin the count first and let the rest run only once the container is proven.
 *
 * WHY aria-pressed AND THE `on` CLASS ARE COMPARED TO EACH OTHER rather than checked separately:
 * the defect in #1263 was that the two could disagree - the class carried the whole meaning and
 * assistive tech saw five identical buttons. Asserting only that `aria-pressed="true"` exists
 * somewhere would pass on a page where the attribute is pinned to the wrong chip. The invariant is
 * that the visual state and the announced state name the SAME chip, in every state.
 *
 * This spec is also the regression test for a measurement mistake I made verifying #2071 by hand on
 * qa: I read `aria-pressed` off live element references captured BEFORE a click, so my "before"
 * snapshot silently reported post-click values. `snapshot()` returns plain strings for that reason.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? '';
const CHIP = '.gsc-tf-btn';
const EXPECTED = ['All', 'Majors', 'Alts', 'DeFi/AI', 'Meme'];

/* Plain values, never live handles - see the header note.
 *
 * `page.$$eval` is Playwright's query-and-serialize API, NOT JavaScript's `eval()`: the callback is
 * a function reference serialized to the page, there is no string-to-code step, and nothing from the
 * page is executed here. Noted because a lint rule matches on the substring. */
const snapshot = (page: import('@playwright/test').Page) => page.$$eval(CHIP, els =>
  els.map(e => ({
    text: (e.textContent || '').trim(),
    type: e.getAttribute('type'),
    pressed: e.getAttribute('aria-pressed'),
    on: /(^|\s)on(\s|$)/.test(e.className),
  })),
);

test.describe('#2071 Arena category chips announce selection, not just colour (#1263)', () => {
  test.skip(!BASE, 'E2E_BASE_URL required');

  test('C1-C4: five real buttons, exactly one pressed, and the pressed state moves on click', async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto(`${BASE}/arena?coin=btc&tf=1h`, { waitUntil: 'domcontentloaded', timeout: 120_000 });

    /* C1. CONTROL. Everything below is uninterpretable without this. */
    await expect(page.locator(CHIP), 'the category chips did not render, so no assertion below means anything').toHaveCount(5, { timeout: 30_000 });

    const before = await snapshot(page);
    expect(before.map(c => c.text), 'the chip set changed - re-derive this spec rather than loosening it').toEqual(EXPECTED);

    /* C2. Real buttons. `type="button"` matters inside a form: a bare <button> submits. */
    expect(before.filter(c => c.type !== 'button').map(c => c.text), 'chips missing type="button"').toEqual([]);

    /* C3. Every chip announces a pressed state, and exactly one is pressed. A chip with the
       attribute absent is the original defect, so absence is named separately from the count. */
    expect(before.filter(c => c.pressed === null).map(c => c.text), 'chips with no aria-pressed at all - this is the #1263 defect').toEqual([]);
    expect(before.filter(c => c.pressed === 'true').map(c => c.text), 'exactly one chip must be pressed').toHaveLength(1);
    expect(before.filter(c => c.pressed === 'true' !== c.on).map(c => c.text),
      'the `on` class and aria-pressed name different chips, so the visual and announced states disagree').toEqual([]);

    /* C4. The pressed state MOVES. A hardcoded aria-pressed on one chip satisfies C3 forever. */
    const target = before.find(c => c.pressed !== 'true')!.text;
    await page.locator(CHIP, { hasText: target }).first().click();
    await expect(page.locator(CHIP, { hasText: target }).first()).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

    const after = await snapshot(page);
    expect(after.filter(c => c.pressed === 'true').map(c => c.text), 'clicking left more or fewer than one chip pressed').toEqual([target]);
    expect(after.filter(c => c.pressed === 'true' !== c.on).map(c => c.text),
      'after the click the `on` class and aria-pressed disagree').toEqual([]);
  });
});
