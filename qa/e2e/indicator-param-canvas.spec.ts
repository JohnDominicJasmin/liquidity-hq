import { test, expect } from '@playwright/test';
import { gotoSignedIn, signedInContext, AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { killTransitions, snapshotCanvases, quietSnapshot, chartChanged } from './_chart';

/**
 * Pins #1008's fix (Pro subscribers edit indicator parameters and the chart
 * now redraws) as a canvas-level regression check, using the same instrument
 * that found the original bug by hand: `qa/e2e/_chart.ts`'s hash, not a
 * screenshot.
 *
 * Was `chartUnchanged` (pinning the bug); swapped to `chartChanged` here on
 * feature/strategy-panel-params-wiring alongside the real fix, so `dev`
 * never carries a knowingly-wrong assertion — same import, same baseline.
 *
 * #1259: this used to inherit whatever `strategy_selection` account A's last
 * test run left behind. If that happened to already be at the 3-indicator
 * cap, clicking Bollinger silently no-ops (StrategyPanel's own `toggle()` -
 * blocked, not added) and the param editor never opens, for a reason that
 * has nothing to do with #1008. Resets to empty first, via the real
 * `/api/settings` PATCH the app itself uses - NOT a direct DB write, and
 * the one subtlety that cost real time getting right: a bare PATCH with no
 * `knownAsOf` is silently REJECTED by #1202/#1217's per-field concurrency
 * guard once a field has ever been confirmed (still 200 OK - `accepted`/
 * `rejected` in the body is the only tell), so this checks `accepted`
 * rather than trusting the status code.
 */

test.describe('indicator parameter edits reach the chart (#1008)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('Bollinger Length 20→5: canvas changes (#1008 fixed)', async ({ browser }, testInfo) => {
    /* #1259: the viewport is hardcoded below regardless of project, so a
     * mobile run tests nothing a desktop run hasn't already - it just races
     * the SAME real, shared account A against the desktop run's own reset
     * and interaction. `fullyParallel: false` only serializes a project's
     * OWN run of a file; desktop and mobile still run concurrently on the
     * 2 workers (confirmed live: one run had mobile pass and desktop fail
     * on the same account at the same moment). Skipping the run that adds
     * that risk for zero additional coverage, not cutting coverage. */
    test.skip(testInfo.project.name !== 'desktop', 'canvas behaviour is viewport-independent here (viewport is hardcoded below) - a mobile run only re-races the same shared account A');
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq-design-mode', 'terminal'); } catch { /* private mode */ }
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');

      const resetResult = await page.evaluate(async () => {
        const raw = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
        const token = raw ? JSON.parse(localStorage.getItem(raw)!).access_token : null;
        const now = new Date().toISOString();
        const res = await fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            strategy_selection: [], strategy_params: {},
            knownAsOf: { strategy_selection: now, strategy_params: now },
          }),
        });
        const body = await res.json();
        localStorage.removeItem('lhq_settings_v1');
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('lhq_settings_unconfirmed_v1')) localStorage.removeItem(k);
        }
        return { status: res.status, accepted: body.accepted as string[] | undefined };
      });
      // strategy_params too, not just strategy_selection - a leftover saved
      // Length from an earlier run (StrategyPanel's paramsFor() falls back to
      // the registry default ONLY when nothing is saved) silently changes
      // what "20" means for this test's own baseline otherwise.
      expect(resetResult.accepted,
        `reset was rejected by the concurrency guard: ${JSON.stringify(resetResult)}`)
        .toEqual(expect.arrayContaining(['strategy_selection', 'strategy_params']));

      await page.reload();
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
       * worse than failing loud against a cold local one.
       *
       * #1259: in CI, Binance and Bybit both answer the runner's IP with
       * 403/451 on every request - measured directly in #1252's run logs,
       * dozens of upstream rejections across every market-data route, not
       * specific to this spec. A blank canvas there is an exchange-vs-CI-IP
       * fact, not anything #1008 broke. Skipping with a named reason beats
       * either a false-red (nothing to fix) or silently trusting a local
       * pass to stand in for CI, which is how this ended up on the red-suite
       * list in the first place. */
      try {
        await expect.poll(
          async () => (await snapshotCanvases(page)).len,
          { timeout: 15_000 },
        ).toBeGreaterThan(100_000);
      } catch (e) {
        if (process.env.CI) {
          test.skip(true, 'candles never loaded - Binance/Bybit answer this CI runner\'s IP with 403/451 ' +
            '(confirmed in #1252\'s run logs), not something #1008 or this PR broke. Passes locally.');
        }
        throw e;
      }

      // Custom strategy set, so the Bollinger chip's own param editor renders.
      await page.locator('select').first().selectOption('custom');
      await page.locator('button.strat-chip', { hasText: 'Bollinger' }).click();

      const paramsSection = page.locator('.strat-params');
      const lengthInput = paramsSection.locator('input').first();
      await expect(lengthInput).toHaveValue('20'); // registry default — confirms the editor actually rendered

      /* quietSnapshot, not snapshotCanvases — the chart redraws on its own
       * from live price ticks (Dev measured 3 of 5 idle samples changing
       * over 2s), and chartChanged can't tell a tick from the edit it's
       * meant to detect. A single-sample baseline risks a false pass on
       * noise, not a false fail — the dangerous direction. See _chart.ts's
       * file header. */
      const before = await quietSnapshot(page);

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
