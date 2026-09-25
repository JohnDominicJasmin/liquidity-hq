import { test, expect } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON, BILLED_CALLS_READY, BILLED_CALLS_SKIP_REASON } from './_auth';

/* #1348 item 1 (from #1347's audit) - the audit's headline target.
 *
 * app/arena/page.tsx:1514 - `readMarket`'s useCallback dependency array
 * omits `strategySelection`, though the body reads it directly (:1422 for
 * the prompt, :1464 for the cached `selectionAtAnalysis` marker).
 * `runStrategy` (:1525-1551) receives a fresh `selection` parameter and
 * forwards it correctly for 'ask' (:1526-1544) but drops it before calling
 * `readMarket(kind, force)` for 'quick'/'deep' (:1549) - `readMarket` takes
 * no selection argument at all.
 *
 * WHY THIS CANNOT BE ASSERTED FROM THE CARD: the existing stale-selection
 * banner (:2156-2231) compares the recorded `selectionAtAnalysis` (captured
 * from the SAME closure) against the current live selection - it can
 * happen to flag a result as stale without ever proving the PROMPT ITSELF
 * carried the wrong indicators. The only instrument that settles it is the
 * outgoing /api/grok POST body.
 *
 * WHY THIS COSTS REAL AI CREDITS, AND WHY IT IS GATED OFF BY DEFAULT:
 * both QUICK and DEEP are real, billed xAI calls. This does NOT run
 * unless E2E_ALLOW_BILLED_CALLS=1 is set explicitly (BILLED_CALLS_READY,
 * ./_auth.ts) - AUTH_READY alone is not enough of a gate, because CI
 * supplies real E2E_USER_* secrets, and CI's `test:e2e` job runs the whole
 * suite unscoped on every push to a release PR (staging -> main). A
 * release PR's head IS its base branch, so every push to `staging` while
 * one is open re-fires the suite via `synchronize` - this spec would have
 * billed on every one of those runs with no one having decided that.
 *
 * RUN HISTORY (updated by hand after each deliberate run, not automated):
 * 2 calls against the deployed qa site before the #1347 fix existed
 * (clean negative). 4 calls against the fix's own local build after it
 * landed - 2 of those 4 were an unplanned mistake (re-ran the command to
 * inspect output already in hand instead of reading it), reported as such
 * rather than folded into "the authorised check." All four post-fix
 * calls: clean negative, both required assertions (names SMA, does not
 * name EMA Ribbon) satisfied every time.
 *
 * METHODOLOGY: click QUICK once (selection A, lets the first call complete
 * so the button re-enables - #1338's guard requires this), THEN change the
 * selection to B and click DEEP AS FAST AS POSSIBLE, without an
 * intervening wait, so as few of readMarket's other seven dependencies
 * (selectedCoin, readTf, store, latestHeadlines, econEvents, fundingData,
 * liqClusters) get a chance to change identity as possible. `store` updates
 * on every market tick, which is this bug's own natural masking mechanism -
 * a fast client-side selection change immediately followed by a fast click
 * is the only way to land inside the window before a tick refreshes the
 * closure incidentally.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
test.skip(!BILLED_CALLS_READY, BILLED_CALLS_SKIP_REASON);

test.describe('QUICK/DEEP must send the selection current at click time, not a stale one (#1348 item 1)', () => {
  test('switching the indicator selection immediately before a DEEP click sends the NEW selection, not the one from the first click', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      const grokRequestBodies: string[] = [];
      await page.route('**/api/grok', route => {
        if (route.request().method() === 'POST') {
          grokRequestBodies.push(route.request().postData() ?? '');
        }
        return route.fallback();
      });

      // Clear any leftover selection from earlier runs on this shared test
      // account first - a free-tier account's indicatorLimit is 1
      // (StrategyPanel.tsx), so a stale saved selection from a prior spec
      // (this file's siblings all use E2E_USER_A too) would leave the first
      // chip click "blocked" rather than selectable at all.
      await gotoSignedIn(page, '/about');
      await page.evaluate(async () => {
        const raw = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
        const token = raw ? JSON.parse(localStorage.getItem(raw)!).access_token : null;
        await fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ strategy_selection: [], knownAsOf: { strategy_selection: new Date().toISOString() } }),
        });
        localStorage.removeItem('lhq_settings_v1');
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('lhq_settings_unconfirmed_v1')) localStorage.removeItem(k);
        }
      });

      await page.goto('/arena');

      // Enter custom indicator mode and select EMA Ribbon first.
      await page.locator('select.strat-sel').selectOption('custom');
      const emaChip = page.locator('button.strat-chip', { hasText: 'EMA Ribbon' });
      await emaChip.click();
      await expect(emaChip).toHaveAttribute('aria-pressed', 'true');

      const quickBtn = page.getByRole('button', { name: 'QUICK', exact: true });
      const deepBtn  = page.getByRole('button', { name: 'DEEP', exact: true });
      await expect(quickBtn).toBeVisible({ timeout: 15_000 });

      // Call #1 (real AI credit #1) - selection A (EMA Ribbon), mode 'quick'.
      await quickBtn.click();
      await expect.poll(() => grokRequestBodies.length, {
        message: 'first QUICK click never reached /api/grok',
        timeout: 30_000,
      }).toBe(1);
      await expect(quickBtn, 'QUICK must re-enable once the first read finishes').toBeEnabled({ timeout: 30_000 });

      // Switch selection to B (SMA) and fire immediately - no wait, no
      // intervening navigation - the whole point is to land inside the
      // window before any of readMarket's other dependencies refresh it.
      await emaChip.click(); // deselect EMA Ribbon
      const smaChip = page.locator('button.strat-chip', { hasText: 'SMA' });
      await smaChip.click(); // select SMA
      await expect(smaChip).toHaveAttribute('aria-pressed', 'true');

      // Call #2 (real AI credit #2) - selection B (SMA), fired as fast as
      // Playwright can issue it after the chip state confirms. DEEP, not
      // QUICK: readMarket's own cache check (`force` only true after 30s,
      // app/arena/page.tsx:1548) would silently serve call #1's cached
      // 'quick' result with no new fetch at all if this were QUICK again -
      // a different mode bypasses that cache-hit path entirely (`entry.mode
      // === mode` fails) while exercising the exact same shared
      // `readMarket` closure/dependency bug under test.
      await deepBtn.click();
      await expect.poll(() => grokRequestBodies.length, {
        message: 'DEEP click never reached /api/grok',
        timeout: 30_000,
      }).toBe(2);

      // Scoped to the "weighing these indicators" SENTENCE specifically
      // (app/arena/page.tsx:1425's own text), not the whole prompt body -
      // "EMA Ribbon Strategy: ..." also appears unconditionally in every
      // prompt's standard technicals section (readMarket's own chartData
      // summary), regardless of selection. Matching that section would
      // false-positive "still weighing EMA Ribbon" on a run that never
      // selected it at all. First run of this exact regex made that mistake
      // - fixed here without re-running, to avoid spending another billed
      // call just to correct a matching pattern.
      const secondPrompt = grokRequestBodies[1];
      const weighSentenceMatch = secondPrompt.match(/weigh these indicators:\s*([^.\\]*)\./);
      const weighSentence = weighSentenceMatch?.[1] ?? '(no "weighing these indicators" sentence found at all)';

      test.info().annotations.push({
        type: 'result',
        description: `weighing-sentence content: "${weighSentence}". ` +
          (weighSentence.includes('SMA') && !weighSentence.includes('EMA')
            ? 'CLEAN NEGATIVE: the DEEP call correctly named the new selection (SMA) in the indicator-weighting sentence - downgrades item 1 from confirmed-live-defect to latent-hazard for THIS run. The static defect (readMarket\'s missing dependency) still stands; this attempt did not catch it in the act.'
            : weighSentence.includes('EMA')
              ? 'CONFIRMED LIVE DEFECT: the DEEP call still named the pre-switch selection (EMA Ribbon) in the weighting sentence.'
              : 'INCONCLUSIVE: the weighting sentence named neither - inspect manually.'),
      });

      expect(weighSentence, 'the DEEP call\'s "weighing these indicators" sentence, sent immediately after switching from EMA Ribbon to SMA, must name SMA - not the pre-switch EMA Ribbon selection, and not the always-present "EMA Ribbon Strategy" technicals section elsewhere in the prompt (#1348 item 1)')
        .toContain('SMA');
      expect(weighSentence, 'the weighting sentence must not still name the pre-switch EMA Ribbon selection')
        .not.toContain('EMA');
    } finally {
      await ctx.close();
    }
  });
});
