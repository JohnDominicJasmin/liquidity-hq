import { test, expect } from '@playwright/test';
import { gotoSignedIn, signedInContext, AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { killTransitions, snapshotCanvases, chartUnchanged } from './_chart';

/**
 * Pins #1008 (Pro subscribers edit indicator parameters and the edits reach
 * nothing) as a canvas-level regression check, using the same instrument
 * that found it by hand: `qa/e2e/_chart.ts`'s hash, not a screenshot.
 *
 * THIS TEST DOCUMENTS TODAY'S KNOWN-BROKEN BEHAVIOUR, THE SAME WAY
 * `rsi.test.mts`'s "a flat series is also 100" pins a quirk rather than
 * endorsing it. It asserts `chartUnchanged` — editing Bollinger's Length
 * from 20 to 5 currently changes zero pixels, confirmed live on canvas hash
 * in the #1008 investigation. **When #1008's fix lands, this assertion
 * inverts**: swap `chartUnchanged` for `chartChanged` (same import, same
 * baseline) — a failure here after that fix ships is the fix working, not
 * a regression. Left failing-on-purpose the day the fix merges is exactly
 * the stale-assertion shape this project keeps finding in `TEST_GAPS.md`;
 * this comment is the marker so it doesn't happen here too.
 */

test.describe('indicator parameter edits reach the chart (#1008)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('Bollinger Length 20→5: canvas is unchanged (known bug, #1008)', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq-design-mode', 'terminal'); } catch { /* private mode */ }
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
      await killTransitions(page); // before the baseline, not after

      // Custom strategy set, so the Bollinger chip's own param editor renders.
      await page.locator('select').first().selectOption('custom');
      await page.locator('button.strat-chip', { hasText: 'Bollinger' }).click();

      const paramsSection = page.locator('.strat-params');
      const lengthInput = paramsSection.locator('input').first();
      await expect(lengthInput).toHaveValue('20'); // registry default — confirms the editor actually rendered

      const before = await snapshotCanvases(page);

      await lengthInput.fill('5');
      await lengthInput.dispatchEvent('change');
      await page.waitForTimeout(500); // give a real redraw every chance to happen before asserting it didn't

      await chartUnchanged(
        page,
        before,
        'Bollinger Length 20→5 changed the chart canvases — if #1008 is fixed, ' +
        'update this test to assert chartChanged instead (see file header).',
      );
    } finally {
      await ctx.close();
    }
  });
});
