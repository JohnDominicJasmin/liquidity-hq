import { test, expect } from '@playwright/test';
import { gotoSignedIn, signedInContext, AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { killTransitions, snapshotCanvases, chartChanged } from './_chart';

/**
 * Pins #1008's fix (Pro subscribers edit indicator parameters and the chart
 * now redraws) as a canvas-level regression check, using the same instrument
 * that found the original bug by hand: `qa/e2e/_chart.ts`'s hash, not a
 * screenshot.
 *
 * Was `chartUnchanged` (pinning the bug); swapped to `chartChanged` here on
 * feature/strategy-panel-params-wiring alongside the real fix, so `dev`
 * never carries a knowingly-wrong assertion — same import, same baseline.
 */

test.describe('indicator parameter edits reach the chart (#1008)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('Bollinger Length 20→5: canvas changes (#1008 fixed)', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq-design-mode', 'terminal'); } catch { /* private mode */ }
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
      await killTransitions(page); // before the baseline, not after

      /* Wait for the chart's OWN first paint, not just the panel's readiness.
       * Found this the hard way running locally against a cold `next start`:
       * candles fetch through /api/market/klines server-side and take a beat
       * on a cold cache (warm on the deployed qa build, so this never showed
       * there) — a canvas with only chrome/no candles measures ~30k chars of
       * toDataURL(); a real loaded chart measures ~350k. 100k is comfortably
       * between the two. Without this, `before` can be taken against a blank
       * canvas that stays blank after the edit too — `chartChanged` would
       * then fail for a reason that has nothing to do with #1008.
       *
       * NOT A FLAKE MITIGATION — the same shape as the hollow-node_modules
       * detector: "a canvas exists" passes on a thing that is present and
       * empty, same as "a directory exists". Both look like a pass while
       * measuring nothing. This wait is the difference between baselining
       * a chart and baselining an empty canvas; without it `_chart.ts` — now
       * load-bearing for #1008 — could report `chartChanged` green for the
       * wrong reason indefinitely against a warm deployed build, which is
       * worse than failing loud against a cold local one. */
      await expect.poll(
        async () => (await snapshotCanvases(page)).len,
        { timeout: 15_000, message: 'chart candles never loaded (canvas stayed near-blank)' },
      ).toBeGreaterThan(100_000);

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

      await chartChanged(
        page,
        before,
        'Bollinger Length 20→5 did not change the chart canvases — #1008 regressed.',
      );
    } finally {
      await ctx.close();
    }
  });
});
