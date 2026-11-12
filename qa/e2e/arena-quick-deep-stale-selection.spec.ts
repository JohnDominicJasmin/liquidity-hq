import { test, expect } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON, BILLED_CALLS_READY, BILLED_CALLS_SKIP_REASON } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { chip } from './_shared';

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
 * name MACD) satisfied every time.
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
      await installPaidAiFence(page);   // #1632: refuse any paid AI path this spec has not stubbed
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

      // Enter custom indicator mode and select MACD first.
      await page.locator('select.strat-sel').selectOption('custom');
      const emaChip = chip(page, 'MACD');
      await emaChip.click();
      await expect(emaChip).toHaveAttribute('aria-pressed', 'true');

      const quickBtn = page.getByRole('button', { name: 'QUICK', exact: true });
      const deepBtn  = page.getByRole('button', { name: 'DEEP', exact: true });
      await expect(quickBtn).toBeVisible({ timeout: 15_000 });

      // Call #1 (real AI credit #1) - selection A (MACD), mode 'quick'.
      await quickBtn.click();
      await expect.poll(() => grokRequestBodies.length, {
        message: 'first QUICK click never reached /api/grok',
        timeout: 30_000,
      }).toBe(1);
      await expect(quickBtn, 'QUICK must re-enable once the first read finishes').toBeEnabled({ timeout: 30_000 });

      // Switch selection to B (SMA) and fire immediately - no wait, no
      // intervening navigation - the whole point is to land inside the
      // window before any of readMarket's other dependencies refresh it.
      await emaChip.click(); // deselect MACD
      const smaChip = chip(page, 'SMA');
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

      /* THE SELECTION IS READ FROM THE REQUEST'S DATA, NOT FROM A PROMPT SENTENCE. This cell used to regex a
         "weigh these indicators: ..." sentence out of the posted body. Since #1631 item 5 the browser sends data
         (`{ context, chart, type, selection }`) and the server builds the prompt, so that sentence is no longer in
         the body at all - the old read would have found nothing and reported "no sentence found". The same claim
         (the DEEP call carries the selection current at click time, not the one from the first click) is now
         asserted on the `selection` array the client posts. The first call went out with MACD selected; the
         second, after switching to SMA, must name SMA and must not still name MACD. */
      const secondBody = JSON.parse(grokRequestBodies[1]) as { selection?: unknown };
      const sent = Array.isArray(secondBody.selection) ? (secondBody.selection as unknown[]).map(String) : [];

      test.info().annotations.push({
        type: 'result',
        description: `selection sent with the DEEP call: ${JSON.stringify(sent)}. ` +
          (sent.includes('SMA') && !sent.includes('MACD')
            ? 'CLEAN NEGATIVE: the DEEP call carried the new selection (SMA), not the pre-switch one (MACD) - latent hazard only for THIS run.'
            : sent.includes('MACD')
              ? 'CONFIRMED LIVE DEFECT: the DEEP call still carried the pre-switch selection (MACD).'
              : 'INCONCLUSIVE: the posted selection named neither - inspect manually.'),
      });

      expect(sent, 'the DEEP call\'s posted selection, sent immediately after switching from MACD to SMA, must name SMA')
        .toContain('SMA');
      expect(sent, 'the DEEP call\'s posted selection must not still name the pre-switch MACD selection')
        .not.toContain('MACD');
    } finally {
      await ctx.close();
    }
  });
});
