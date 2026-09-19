import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';

/* #1309 batch 3 round 1 (#1386, Dev Team), the BRIEFING and FUNDING pages - "How to test
 * (QA)" items 5 and 6.
 *
 *   5. /briefing: each setup and each "notable signal" row is a link to Arena. They all
 *      pointed at bare `/arena`, so tapping the SOL setup opened whatever coin Arena
 *      already had. They now carry `?coin=<id>`.
 *   6. /funding: the coin list was choosable ONLY by clicking a <tr> - not focusable, so a
 *      keyboard user could never leave BTC. Each coin cell now holds a real button
 *      (`.frh-coin-btn`, aria-pressed), disabled for a coin with too little history to
 *      chart. The row's own click still works for the mouse.
 *
 * WRITTEN AGAINST THE PR'S SOURCE, NOT RUN. Nothing may touch the dev database until
 * PM/DevOps says it answers quickly. These two pages are ANONYMOUS and make only GETs, so
 * the database is not what they wait on - but the data they render is live, so a run
 * needs a healthy build and healthy exchanges. Against `dev`/`qa` WITHOUT #1386 they are
 * expected RED at the first assertion: bare `/arena` links, no `.frh-coin-btn` at all.
 *
 * DATA-DEPENDENT, AND SAID SO. The briefing shows setups only when the market has some,
 * and a funding coin is choosable only once its history has loaded. Where the live data
 * gives a test nothing to act on it SKIPS with that reason - but only after proving the
 * page rendered the fixed markup (funding), so an old build cannot hide behind "no data".
 * The briefing cannot do the same: with no rows there is no link to inspect either way.
 *
 * Anonymous and read-only. No AI credits. */

const ARENA_ROW_LINK = 'a[href^="/arena"]';

/** The briefing rows that link to Arena: block-level anchors outside the site nav. The
 *  panel's own "open Arena" header link is a legitimate bare `/arena` and is inline-flex,
 *  so display:block is what separates the two (both row components set it inline). */
async function briefingRowHrefs(page: Page): Promise<string[]> {
  return page.evaluate((sel) =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>(sel))
      .filter(a => !a.closest('nav, header, footer') && getComputedStyle(a).display === 'block')
      .map(a => a.getAttribute('href') ?? ''), ARENA_ROW_LINK);
}

test.describe('/briefing rows open Arena on THEIR coin (item 5)', () => {
  test('every setup and signal row links to /arena?coin=<id>, and Arena keeps that coin', async ({ page }) => {
    await gotoGuarded(page, '/briefing');

    // Rows only exist once prices and liquidation data land; wait for them without
    // treating their absence as a pass.
    let hrefs: string[] = [];
    await expect.poll(async () => { hrefs = await briefingRowHrefs(page); return hrefs.length; },
      { timeout: 60_000, intervals: [500, 1000, 2000] }).toBeGreaterThan(0).catch(() => {});
    test.skip(hrefs.length === 0, 'the briefing showed no setup or signal rows within 60s (no market setups, or the data did not load) - nothing to click');

    const bare = hrefs.filter(h => !/^\/arena\?coin=[a-z0-9]+$/i.test(h));
    expect(bare, `these briefing rows link to Arena WITHOUT a coin (${JSON.stringify(bare)}) - tapping one opens whatever coin Arena last had, not the row's coin`).toEqual([]);

    // Click one whose coin is NOT btc: Arena's default is btc, so a btc row would pass
    // even if the parameter were ignored.
    const ids = hrefs.map(h => new URL(h, 'http://x').searchParams.get('coin')!.toLowerCase());
    const pick = ids.findIndex(id => id !== 'btc');
    const id = ids[pick >= 0 ? pick : 0];
    if (pick < 0) test.info().annotations.push({ type: 'note', description: 'every briefing row was btc, which is also Arena\'s default: the landing coin cannot be told from the default this run' });

    await page.locator(`${ARENA_ROW_LINK}[href="/arena?coin=${id}"]`).first().click();
    await page.waitForURL(/\/arena(\?|$)/, { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get('coin'), 'Arena opened on a different coin than the row that was clicked').toBe(id);

    // Arena writes the coin it is actually showing back into the URL, so a URL that still
    // says <id> after it settles is Arena's own state, not just the link we followed.
    await page.waitForTimeout(3_000);
    expect(new URL(page.url()).searchParams.get('coin'), `Arena moved off ${id} after loading - it ignored the coin in the link`).toBe(id);
  });
});

test.describe('/funding coins are choosable from the keyboard (item 6)', () => {
  const ROW = 'tbody .frh-row';
  const BTN = '.frh-coin-btn';

  const btnAt = (page: Page, k: number) => page.locator(ROW).nth(k).locator(BTN);
  const pressedCount = (page: Page) => page.locator(`${ROW} ${BTN}[aria-pressed="true"]`).count();

  /** Row positions of coins that can be chosen and are not already selected (BTC starts
   *  selected), so a test that "selects" one is proving a CHANGE, not reading the default. */
  async function openFunding(page: Page): Promise<number[]> {
    await gotoGuarded(page, '/funding');
    // Fixed markup first, so an old build fails here and not as a skipped "no data".
    await expect(page.locator(`${ROW} ${BTN}`).first(),
      'no .frh-coin-btn on /funding - the coin cells are still bare text inside a <tr>, which a keyboard cannot reach (#1309 item 6)')
      .toBeAttached({ timeout: 45_000 });
    let idx: number[] = [];
    const read = () => page.locator(`${ROW} ${BTN}`).evaluateAll(els =>
      els.map((e, i) => (!(e as HTMLButtonElement).disabled && e.getAttribute('aria-pressed') === 'false' ? i : -1)).filter(i => i >= 0));
    await expect.poll(async () => { idx = await read(); return idx.length; },
      { timeout: 60_000, intervals: [500, 1000, 2000] }).toBeGreaterThanOrEqual(2).catch(() => {});
    test.skip(idx.length < 2, `only ${idx.length} unselected coin(s) had enough funding history to be choosable within 60s - need two to move the selection`);
    return idx;
  }

  test('a coin button takes keyboard focus, Enter selects it, and exactly one coin is pressed', async ({ page }) => {
    const [a] = await openFunding(page);
    const target = btnAt(page, a);
    await target.focus();
    await expect(target, 'the coin button cannot take keyboard focus').toBeFocused();
    await page.keyboard.press('Enter');
    await expect(target, 'Enter on a focused coin did not select it').toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(ROW).nth(a), 'the row did not take the selected style').toHaveClass(/\bon\b/);
    expect(await pressedCount(page), 'more than one coin reads as pressed').toBe(1);
  });

  test('Space selects too, and moves the selection off the previous coin', async ({ page }) => {
    const [a, b] = await openFunding(page);
    await btnAt(page, a).focus();
    await page.keyboard.press('Enter');
    await expect(btnAt(page, a)).toHaveAttribute('aria-pressed', 'true');
    await btnAt(page, b).focus();
    await page.keyboard.press('Space');
    await expect(btnAt(page, b), 'Space on a focused coin did not select it').toHaveAttribute('aria-pressed', 'true');
    await expect(btnAt(page, a), 'the previous coin still reads as pressed after selecting another').toHaveAttribute('aria-pressed', 'false');
    expect(await pressedCount(page)).toBe(1);
  });

  test('CONTROL: clicking the ROW (not the button) still selects, and clicking the button selects too', async ({ page }) => {
    const [a, b] = await openFunding(page);
    await page.locator(ROW).nth(a).locator('td').nth(1).click();
    await expect(btnAt(page, a), 'a mouse click on the row no longer selects the coin').toHaveAttribute('aria-pressed', 'true');

    await btnAt(page, b).click();
    await expect(btnAt(page, b), 'a mouse click on the coin button did not select it').toHaveAttribute('aria-pressed', 'true');
    await expect(btnAt(page, a)).toHaveAttribute('aria-pressed', 'false');
    expect(await pressedCount(page)).toBe(1);
  });

  test('a coin with too little history is disabled, and clicking its row selects nothing', async ({ page }) => {
    await openFunding(page);
    const disabled = page.locator(`${ROW} ${BTN}[disabled]`);
    test.skip(await disabled.count() === 0, 'every listed coin had enough history this run - no disabled coin to press');
    const pressed = () => page.locator(`${ROW} ${BTN}[aria-pressed="true"]`).evaluateAll(els => els.map(e => e.textContent?.trim()));
    const before = await pressed();
    await disabled.first().locator('xpath=ancestor::tr').click({ force: true });
    expect(await pressed(), 'a coin with no chartable history became selected').toEqual(before);
  });
});
