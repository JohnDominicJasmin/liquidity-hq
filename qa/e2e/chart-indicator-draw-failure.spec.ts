import { test, expect, type Page } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';

/* #1347 item 11, chart half (#1369, fix by Dev Team) - the strategy-indicator
 * sync effect in KLineProChart had silent failure paths, so the chart could
 * stop reflecting what the chip list still showed as selected with nothing on
 * screen saying so. Now every failing indicator lands in one list and the chart
 * says "Couldn't draw: X" in its top-right corner.
 *
 * THE SEAM (read from Dev's diff, commit 3c1db93e, not from anyone's relay):
 *   window.__LHQ_QA_FORCE_CHART_INDICATOR_FAIL__ =
 *     'override-throw' | 'create-null' | 'create-throw'
 * One value per real failure path; ANYTHING ELSE, `true` included, is ignored.
 * It is read every time the sync effect runs, so it can be set before load with
 * an init script OR later with page.evaluate - which is what makes
 * 'override-throw' drivable (draw normally, THEN force the params-edit path).
 * Dead on a `NEXT_PUBLIC_APP_ENV=prod` build, so this cannot run against
 * production and does not try to. Same shape as #1184's entitlements hook.
 *
 * WHAT EACH PATH MEANS:
 *   create-null   klinecharts' createIndicator returns null for a name it does
 *                 not know. The chip reads pressed with nothing drawn.
 *   create-throw  createIndicator throws.
 *   override-throw overrideIndicator throws on a param EDIT of an indicator that
 *                 is already drawn: the chart keeps the OLD line under the
 *                 input's NEW value. Dev did not exercise this one; it is this
 *                 file's.
 *
 * EVERY FAILURE TEST ALSO TESTS RECOVERY. A failed create leaves the map empty
 * and a failed override leaves the stale snapshot, so the next sync retries.
 * "Badge clears once the failure stops" is what the code does; a test that only
 * saw the badge appear would not catch a badge that sticks. Recovery is driven
 * by changing the selection with the flag OFF, NOT by deselecting the failing
 * indicator - that empties the failed list and clears the badge for the wrong
 * reason.
 *
 * NEGATIVE ASSERTIONS ARE ONLY AS GOOD AS THEIR TIMING. "No badge" is asserted
 * after a settle wait once a chart canvas is present, and the failure tests use
 * the same wait before expecting the badge, so a control that passes because
 * the effect had not run yet would be a failure test that fails for the same
 * reason.
 *
 * Not run yet: the seam is unmerged (#1369) and the machine is Dev's. No AI
 * credits. It writes to account A's saved params in the shared dev database (a
 * param edit persists), so it restores the default value and clears the
 * selection in `finally`.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const FLAG = '__LHQ_QA_FORCE_CHART_INDICATOR_FAIL__';
const BADGE = /Couldn.t draw:/;
const SETTLE_MS = 2_000;

async function resetStrategySelection(page: Page, selection: string[]) {
  const result = await page.evaluate(async (sel) => {
    const raw = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const token = raw ? JSON.parse(localStorage.getItem(raw)!).access_token : null;
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ strategy_selection: sel, knownAsOf: { strategy_selection: new Date().toISOString() } }),
    });
    const body = await res.json();
    localStorage.removeItem('lhq_settings_v1');
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('lhq_settings_unconfirmed_v1')) localStorage.removeItem(k);
    }
    return { status: res.status, accepted: body.accepted as string[] | undefined };
  }, selection);
  expect(result.accepted, `strategy_selection reset was rejected by the concurrency guard: ${JSON.stringify(result)}`)
    .toContain('strategy_selection');
}

const setFlag = (page: Page, value: unknown) =>
  page.evaluate(([k, v]) => { (window as unknown as Record<string, unknown>)[k as string] = v; }, [FLAG, value] as [string, unknown]);

/** Signs in as A (Pro - params are editable), starts on an empty selection and
 *  lands on Arena in custom mode with the chart drawn. `flagAtLoad`, when given,
 *  is set BEFORE any page script via an init script. */
async function openArena(browser: import('@playwright/test').Browser, flagAtLoad?: unknown) {
  const ctx = await signedInContext(browser, 'a');
  if (flagAtLoad !== undefined) {
    await ctx.addInitScript(([k, v]) => { (window as unknown as Record<string, unknown>)[k as string] = v; }, [FLAG, flagAtLoad] as [string, unknown]);
  }
  const page = await ctx.newPage();
  await gotoSignedIn(page, '/about');
  await resetStrategySelection(page, []);
  await page.goto('/arena');
  await page.locator('select.strat-sel').selectOption('custom');
  await expect(page.locator('canvas').first(), 'no chart canvas ever rendered - this run measured nothing').toBeVisible({ timeout: 30_000 });
  return { ctx, page, badge: page.getByText(BADGE) };
}

async function pick(page: Page, name: string) {
  const chip = page.locator('button.strat-chip', { hasText: name });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  return chip;
}

test.describe('The chart says so when it cannot draw a selected indicator (#1347 item 11, #1369)', () => {
  test('CONTROL: with the flag unset, a normal selection draws and shows no badge', async ({ browser }) => {
    const { ctx, page, badge } = await openArena(browser);
    try {
      await pick(page, 'SMA');
      await page.waitForTimeout(SETTLE_MS);
      await expect(badge, 'a "Couldn\'t draw" badge appeared on the normal path - the badge must only show on a real failure').toHaveCount(0);
    } finally {
      await resetStrategySelection(page, []).catch(() => {});
      await ctx.close();
    }
  });

  test('CONTROL: a bare `true` is ignored - the seam names one path per value, it does not pick one for a boolean', async ({ browser }) => {
    const { ctx, page, badge } = await openArena(browser, true);
    try {
      await pick(page, 'SMA');
      await page.waitForTimeout(SETTLE_MS);
      await expect(badge, 'flag = true made the chart fail; only the three named string values may').toHaveCount(0);
    } finally {
      await resetStrategySelection(page, []).catch(() => {});
      await ctx.close();
    }
  });

  for (const mode of ['create-null', 'create-throw'] as const) {
    test(`'${mode}': the badge names the indicator, the chip stays pressed, and the badge clears once a later sync succeeds`, async ({ browser }) => {
      const { ctx, page, badge } = await openArena(browser, mode);
      try {
        const sma = await pick(page, 'SMA');
        await expect(badge, `'${mode}' must surface "Couldn't draw: SMA" - a chip that reads pressed with nothing drawn and nothing said is the defect`)
          .toBeVisible({ timeout: 10_000 });
        await expect(badge).toContainText('SMA');
        await expect(sma, 'the chip stays pressed - only the missing signal was fixed, the selection is the user\'s').toHaveAttribute('aria-pressed', 'true');

        // Stop the failure, then change the selection so the sync effect
        // re-runs. SMA is not in the drawn map, so it is retried - and must
        // succeed. Deselecting SMA instead would clear the badge trivially.
        await setFlag(page, null);
        await pick(page, 'RSI');
        await expect(badge, 'the badge stuck after the failure stopped - the next successful sync must clear it').toHaveCount(0, { timeout: 10_000 });
        await expect(sma).toHaveAttribute('aria-pressed', 'true');
      } finally {
        await resetStrategySelection(page, []).catch(() => {});
        await ctx.close();
      }
    });
  }

  test(`'override-throw': a param edit that cannot be applied says so, and clears once a later edit applies`, async ({ browser }) => {
    const { ctx, page, badge } = await openArena(browser);
    let restore: { input: import('@playwright/test').Locator; value: string } | null = null;
    try {
      await pick(page, 'SMA');
      await page.waitForTimeout(SETTLE_MS);
      await expect(badge, 'SMA must draw normally first - override-throw only applies to an indicator that is already drawn').toHaveCount(0);

      const input = page.locator('.strat-params input[type="number"]').first();
      await expect(input, 'the params box never rendered for the focused indicator - cannot drive a param edit').toBeVisible({ timeout: 10_000 });
      // The input is DISABLED until the entitlements read resolves as Pro
      // (StrategyPanel `readOnly={!entitled}`), and that window is real and can
      // be long on a slow dev Supabase (#1347 item 6, loading half). Waiting for
      // it to enable is the honest precondition; failing here means A never
      // resolved as entitled, NOT that the chart badge is broken.
      await expect(input, 'the params input stayed DISABLED - account A did not resolve as entitled in time (entitlements read still in flight, or A has drifted from Pro), so a param edit cannot be driven. Not a finding about the chart badge.')
        .toBeEnabled({ timeout: 60_000 });
      restore = { input, value: await input.inputValue() };

      await setFlag(page, 'override-throw');
      await input.fill('21');
      await expect(badge,
        'overrideIndicator threw on a param edit and nothing said the chart still shows the OLD line under the input\'s NEW value')
        .toBeVisible({ timeout: 10_000 });
      await expect(badge).toContainText('SMA');

      await setFlag(page, null);
      await input.fill('34');
      await expect(badge, 'the badge stuck after overrideIndicator started succeeding again - the next applied edit must clear it')
        .toHaveCount(0, { timeout: 10_000 });
    } finally {
      // The edit persisted to the shared account; put the default back.
      if (restore) await restore.input.fill(restore.value).catch(() => {});
      await resetStrategySelection(page, []).catch(() => {});
      await ctx.close();
    }
  });
});
