/* #2071 / #1263 (re-anchored for #2244): the Arena coin-category chips must not signal selection by colour alone.
 *
 * #2244 MOVED THE CHIPS: they used to be a tab row above the scanner (`.gsc-tf-btn`, five of them); they are now eight `.scanner-cat-chip[data-cat]` buttons INSIDE the open
 * coin picker, in a `.scanner-cat-row[role=group]`. The invariant below is unchanged, only its anchor moved, so the picker is opened first.
 *
 * Signed out on purpose: the chips render without auth, so this keeps working when the credentialed specs cannot run.
 *
 * C1 IS THE POSITIVE CONTROL AND EVERY OTHER CELL DEPENDS ON IT. "Exactly one chip is pressed" is vacuously FALSE and "no chip is wrongly pressed" is vacuously TRUE when the
 * selector matches nothing, so the count is pinned first.
 *
 * aria-pressed AND THE `on` CLASS ARE COMPARED TO EACH OTHER: the defect in #1263 was that the two could disagree. The picker's chips also carry a second cue (a check mark, a heavier
 * weight); that cue is asserted by the picker spec, not here. `snapshot()` returns plain strings, never live element handles (a "before" read off handles captured before a click
 * silently reports post-click values). */
import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';

const CHIP = '.scanner-cat-chip';
const EXPECTED = ['all', 'majors', 'alts', 'defi', 'meme', 'stocks', 'etfs', 'commodities'];

/* `page.$$eval` is Playwright's query-and-serialize API, NOT JavaScript's eval(): the callback is a function reference serialized to the page. */
const snapshot = (page: Page) => page.$$eval(CHIP, els =>
  els.map(e => ({
    cat: e.getAttribute('data-cat') ?? '',
    type: e.getAttribute('type'),
    pressed: e.getAttribute('aria-pressed'),
    on: /(^|\s)on(\s|$)/.test(e.className),
  })),
);

test.describe('#2071 Arena category chips announce selection, not just colour (#1263), now inside the picker (#2244)', () => {
  test('C1-C4: eight real buttons, exactly one pressed, and the pressed state moves on click', async ({ page }) => {
    test.setTimeout(180_000);
    await gotoGuarded(page, '/arena?coin=btc&tf=1h');
    await page.waitForTimeout(6_000);
    const trig = page.getByTestId('scanner-trigger');
    await trig.waitFor({ state: 'visible', timeout: 60_000 });
    if (!(await page.locator('.scanner-flyout').isVisible().catch(() => false))) await trig.locator('div').first().click();

    /* C1. CONTROL. Everything below is uninterpretable without this. */
    await expect(page.locator(CHIP), 'the category chips did not render inside the picker, so no assertion below means anything').toHaveCount(8, { timeout: 30_000 });

    const before = await snapshot(page);
    expect(before.map(c => c.cat), 'the chip set changed - re-derive this spec rather than loosening it').toEqual(EXPECTED);

    /* C2. Real buttons. `type="button"` matters inside a form: a bare <button> submits. */
    expect(before.filter(c => c.type !== 'button').map(c => c.cat), 'chips missing type="button"').toEqual([]);

    /* C3. Every chip announces a pressed state, and exactly one is pressed. */
    expect(before.filter(c => c.pressed === null).map(c => c.cat), 'chips with no aria-pressed at all - this is the #1263 defect').toEqual([]);
    expect(before.filter(c => c.pressed === 'true').map(c => c.cat), 'exactly one chip must be pressed').toHaveLength(1);
    expect(before.filter(c => (c.pressed === 'true') !== c.on).map(c => c.cat),
      'the `on` class and aria-pressed name different chips, so the visual and announced states disagree').toEqual([]);

    /* C4. The pressed state MOVES. A hardcoded aria-pressed on one chip satisfies C3 forever. */
    const target = before.find(c => c.pressed !== 'true')!.cat;
    await page.locator(`${CHIP}[data-cat="${target}"]`).first().click();
    await expect(page.locator(`${CHIP}[data-cat="${target}"]`).first()).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

    const after = await snapshot(page);
    expect(after.filter(c => c.pressed === 'true').map(c => c.cat), 'clicking left more or fewer than one chip pressed').toEqual([target]);
    expect(after.filter(c => (c.pressed === 'true') !== c.on).map(c => c.cat),
      'after the click the `on` class and aria-pressed disagree').toEqual([]);
  });
});
