import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

/* Are the gated timeframes hidden from FREE accounts and visible to PRO? (#310)
 *
 * THE PRO DIRECTION IS THE POINT. Dev built this and could not verify that half
 * - they have no Pro session, so "blur everything for everyone" passed
 * everything they ran, and they said so rather than implying otherwise.
 *
 * A gate that hides the feature from EVERYONE satisfies every free-account
 * assertion perfectly. That is the same shape as the four econ-staleness tests
 * that all pointed one way, and as the /ops gate that denied everyone while
 * passing the whole suite.
 *
 * IT READS COMPUTED COLOUR, NOT CLASS NAMES. The owner's requirement was that
 * the red/green goes away, not that a class is renamed - a blur with the colour
 * still underneath leaks the direction, which is most of what these cells say.
 */

const GATED = ['5m', '15m'] as const;
const OPEN  = ['1h', '4h'] as const;

/** Per-timeframe blur and colour, read from the Multi-TF rows. */
async function readRows(page: Page) {
  return page.evaluate(() => {
    const out: Record<string, { blur: string; colour: string }> = {};
    /* RsiRow is a grid: span(tf) | div(bar) | span(value) | span(badge).
       The first version looked for `:scope > div` as the label and read 0 rows -
       the label is a SPAN. The guard caught it rather than passing vacuously,
       which is the only reason this is a corrected selector and not a green
       test that measured nothing. */
    for (const row of Array.from(document.querySelectorAll('div'))) {
      const kids = Array.from(row.children);
      if (kids.length < 3) continue;
      const label = (kids[0].textContent || '').trim();
      if (!/^(5m|15m|1h|4h|1D|1W|1M)$/.test(label) || out[label]) continue;
      const value = kids[2] as HTMLElement;
      const cs = getComputedStyle(value);
      /* The blur may sit on the value or on an ancestor, so walk up a little. */
      let blur = cs.filter;
      for (let n: HTMLElement | null = value, i = 0; n && i < 3 && (!blur || blur === 'none'); n = n.parentElement, i++) {
        blur = getComputedStyle(n).filter;
      }
      out[label] = { blur: blur || 'none', colour: cs.color };
    }
    return out;
  });
}

/** Load /arena and prove the Multi-TF card rendered before reading anything. */
async function multiTf(page: Page, signedIn: boolean) {
  if (signedIn) await gotoSignedIn(page, '/arena');
  else await gotoGuarded(page, '/arena');
  await page.waitForTimeout(9000);

  const card = page.locator('div').filter({ hasText: /MULTI-TIMEFRAME ALIGNMENT/i }).first();
  await expect(card, 'the Multi-TF card did not render - nothing below is meaningful')
    .toBeVisible({ timeout: 20_000 });

  const rows = await readRows(page);
  expect(Object.keys(rows).length,
    `read ${Object.keys(rows).length} timeframe rows - the selector is not finding them, so ` +
    `every assertion below would pass vacuously`).toBeGreaterThanOrEqual(4);
  return rows;
}

test.describe('gated timeframes', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
  });

  test('a FREE visitor gets the gated timeframes blurred AND uncoloured', async ({ page }) => {
    const rows = await multiTf(page, false);

    for (const tf of GATED) {
      expect(rows[tf], `no ${tf} row found`).toBeDefined();
      expect(rows[tf].blur, `${tf} is not blurred for a free visitor`).toMatch(/blur\(/);
      /* The colour half, and the one the owner called out. A blur with red or
         green underneath still leaks the direction. */
      expect(rows[tf].colour,
        `${tf} is blurred but still carries a directional colour (${rows[tf].colour}) - ` +
        `the value is hidden and the signal is not`)
        .not.toMatch(/rgb\(52, 211, 153\)|rgb\(248, 113, 113\)/);
    }
  });

  test('CONTROL: the ungated timeframes are NOT blurred for a free visitor', async ({ page }) => {
    /* Stops "blur everything" passing the test above. */
    const rows = await multiTf(page, false);
    for (const tf of OPEN) {
      expect(rows[tf], `no ${tf} row found`).toBeDefined();
      expect(rows[tf].blur, `${tf} is blurred for a free visitor and should not be`).toBe('none');
    }
  });

  test('CONTROL: a PRO account sees the gated timeframes sharp', async ({ browser }) => {
    /* THE HALF DEV COULD NOT RUN. Without it, hiding the feature from everyone
       passes both tests above. */
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    try {
      const rows = await multiTf(page, true);
      for (const tf of GATED) {
        expect(rows[tf], `no ${tf} row found`).toBeDefined();
        expect(rows[tf].blur,
          `${tf} is blurred for a PRO account - the gate is hiding the feature from everyone, ` +
          `which passes every free-account assertion and delivers nothing`).toBe('none');
      }
    } finally { await ctx.close(); }
  });
});
