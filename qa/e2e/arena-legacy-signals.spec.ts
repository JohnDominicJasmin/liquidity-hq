import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';

/* Stored results from BEFORE the #260 rename must still render directionally.
 *
 * The arena persists history in sessionStorage and the result cache in
 * localStorage, so a user who ran an analysis before the deploy still has
 * LONG / LEAN LONG / SHORT / LEAN SHORT sitting in their browser afterwards.
 *
 * THE FAILURE MODE IS SILENT, WHICH IS WHY IT NEEDS A SPEC. Every comparison in
 * the page now tests the new vocabulary, and each chain ends in a fallback - so
 * an un-migrated row does not throw, it renders as FLAT and goes grey. A bullish
 * call the user made an hour ago becomes "no opinion" with nothing anywhere
 * saying it happened. Dev's framing on the fix, and it is the reason this is
 * worth a test rather than a glance: a crash would have been found in an hour.
 *
 * WHAT IT ASSERTS, AND WHY NOT THE WORDS. The badge TEXT comes from
 * `lhq_labels` / `lhq_dev_labels` - live database rows an owner can edit at any
 * time, and which were in fact edited on 2026-08-11. A spec keyed to "BULLISH"
 * would break on a copy change and pass on a broken mapping. The CSS class is
 * the app's own directional claim and is not editable from the database:
 *
 *     tg  green   BULLISH / LEAN BULLISH
 *     tr  red     BEARISH / LEAN BEARISH
 *     tp  grey    FLAT, i.e. no directional view
 *
 * So `tg` on a stored `LONG` row is the assertion. Text is checked too, but
 * only as a secondary signal.
 */

const HIST_KEY = 'arena-session-history-v1';
const BADGE    = '.arena-hist-badge';
const ROW      = '.arena-hist-item';

type Row = { signal: string; confidence: number; coin: string; time: string };

const row = (signal: string, confidence: number, coin: string): Row =>
  ({ signal, confidence, coin, time: '12:00' });

/**
 * Seed session history BEFORE the page's own hydration reads it.
 *
 * `addInitScript` runs on every document before any page script, which is the
 * only point at which this is winnable - the page reads the key during mount and
 * writes it back on every change, so setting it after load is racing the app's
 * own persistence.
 */
async function seedHistory(page: Page, rows: Row[]) {
  await page.addInitScript(
    ([key, payload]) => sessionStorage.setItem(key as string, payload as string),
    [HIST_KEY, JSON.stringify(rows)] as const,
  );
}

/**
 * Ask the TARGET which vocabulary it speaks, and skip if it predates the rename.
 *
 * Measured against deployed `staging` at 0ab7034, which is pre-#277:
 *
 *     stored 'BULLISH'  ->  tp   (grey - the old code only knows 'LONG')
 *     stored 'LONG'     ->  tg   (green - natively, no migration involved)
 *
 * So on an old host the four legacy tests below PASS FOR THE WRONG REASON and
 * the control FAILS. Both are correct behaviour for that build, and neither
 * says anything about the migration this file exists to cover.
 *
 * Running it anyway would leave a permanently-red test on the branch QA signs
 * off, which is how a suite teaches people to ignore red. Same principle as
 * payments-write-path asking `/api/version` for `appEnv` rather than assuming:
 * the answer is a property of the running service, not of the local checkout.
 */
async function speaksNewVocabulary(page: Page): Promise<boolean> {
  await seedHistory(page, [row('BULLISH', 71, 'BTC')]);
  await gotoGuarded(page, '/arena');
  await page.locator(ROW).first().waitFor({ state: 'attached', timeout: 30_000 });
  const cls = await page.locator(BADGE).first().getAttribute('class') ?? '';
  return /\btg\b/.test(cls);
}

test.describe('legacy signal vocabulary', () => {
  let newVocabulary = false;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      newVocabulary = await speaksNewVocabulary(page);
    } finally {
      await page.close();
    }
  });

  test.beforeEach(() => {
    test.skip(!newVocabulary,
      'host predates the #260 rename - it stores and reads LONG/SHORT natively, ' +
      'so the migration these tests cover does not exist here yet');
  });

  test('CONTROL: the seed reaches the page at all', async ({ page }) => {
    /* Every assertion below is "a row rendered with class X". If the seeding
       mechanism silently failed, ZERO rows would render and a `toHaveClass`
       against an empty locator passes vacuously - the same empty-result trap
       that produced six routes reporting 0 exchange calls because they never
       loaded. This test exists so that cannot happen unnoticed. */
    await seedHistory(page, [
      row('BULLISH', 71, 'BTC'), row('BEARISH', 64, 'ETH'), row('FLAT', 33, 'SOL'),
    ]);
    await gotoGuarded(page, '/arena');

    await expect(page.locator(ROW),
      'the seeded history never reached the page - nothing below measures anything')
      .toHaveCount(3, { timeout: 30_000 });

    /* And the CURRENT vocabulary maps as expected, so a legacy row rendering
       grey below means the migration is missing rather than the whole badge
       being broken. */
    await expect(page.locator(BADGE).nth(0)).toHaveClass(/\btg\b/);
    await expect(page.locator(BADGE).nth(1)).toHaveClass(/\btr\b/);
    await expect(page.locator(BADGE).nth(2)).toHaveClass(/\btp\b/);
  });

  test('a stored LONG renders bullish, not FLAT', async ({ page }) => {
    await seedHistory(page, [row('LONG', 71, 'BTC')]);
    await gotoGuarded(page, '/arena');

    await expect(page.locator(ROW)).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator(BADGE).first(),
      'a pre-rename LONG fell through to FLAT - the user\'s bullish call became "no opinion"')
      .toHaveClass(/\btg\b/);
    await expect(page.locator(BADGE).first()).not.toHaveClass(/\btp\b/);
  });

  test('a stored SHORT renders bearish, not FLAT', async ({ page }) => {
    await seedHistory(page, [row('SHORT', 68, 'ETH')]);
    await gotoGuarded(page, '/arena');

    await expect(page.locator(ROW)).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator(BADGE).first(),
      'a pre-rename SHORT fell through to FLAT').toHaveClass(/\btr\b/);
  });

  test('the LEAN variants migrate too', async ({ page }) => {
    /* Easy to miss: "LEAN LONG" is two words and a naive startsWith or a map
       keyed only on the base words would drop it. */
    await seedHistory(page, [row('LEAN LONG', 55, 'BTC'), row('LEAN SHORT', 52, 'SOL')]);
    await gotoGuarded(page, '/arena');

    await expect(page.locator(ROW)).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator(BADGE).nth(0)).toHaveClass(/\btg\b/);
    await expect(page.locator(BADGE).nth(1)).toHaveClass(/\btr\b/);
  });

  test('CONTROL: a genuine FLAT stays FLAT', async ({ page }) => {
    /* Without this, a build that mapped EVERYTHING to bullish would pass every
       other test in this file. FLAT means the analysis had no directional view,
       and inventing one for it is a worse defect than losing one. */
    await seedHistory(page, [row('FLAT', 30, 'BTC')]);
    await gotoGuarded(page, '/arena');

    await expect(page.locator(ROW)).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator(BADGE).first(),
      'a FLAT row was given a direction it never had').toHaveClass(/\btp\b/);
  });
});
