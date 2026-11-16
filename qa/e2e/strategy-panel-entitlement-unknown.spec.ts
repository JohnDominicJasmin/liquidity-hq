import { test, expect } from '@playwright/test';
import { installSyntheticSocket } from './_fixtures';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

/* #1347 item 6 (#1362, fix by Dev Team) - the Strategy Panel's `entitled`
 * boolean (`entitlementStatus === 'entitled'`) fed the indicator limit, the
 * at-limit block and the read-only params box, so 'not_entitled' and
 * 'unknown' were enforced identically. A paying user whose entitlements read
 * had not resolved (or had failed) was told, by the interactive UI, that they
 * were on the free plan: chips capped at 1, params read-only. The header badge
 * already rendered '···' for unknown; the controls beneath it did not.
 *
 * THE FIX: while `entitlementStatus === 'unknown'` the strategy-set selector,
 * the indicator chips and the params box are replaced by the SAME
 * `EntitlementUnknownCard` + `retryEntitlements` the Arena page's Confluence
 * card already uses. "Run the read" (QUICK / DEEP / ASK AI) is untouched - it
 * was never gated on entitlement.
 *
 * SAME HOOK AS entitlement-unknown.spec.ts (#1184): `window.__LHQ_QA_FORCE_
 * ENTITLEMENTS_FAIL__`, set with an init script so it beats the reload race.
 * That file's header explains why route-stubbing and re-signing-in do not work
 * here; this file does not re-derive it.
 *
 * SCOPED TO `.strat-panel`, not the page. The Confluence card on the same page
 * renders an identical [data-testid="entitlement-unknown"], so an unscoped
 * assertion would pass on that card and say nothing about the panel - the
 * exact defect this PR fixes lived in the panel while the card next to it was
 * already correct.
 *
 * Not run yet: the fix is unmerged and the machine is Dev's. Expected against
 * `dev`/`qa` without #1362: the forced-unknown tests are RED (the chip grid,
 * capped at one, is what renders); the two controls are green either way and
 * exist to prove the fix did not change confirmed-free or confirmed-Pro.
 * No AI credits - nothing here presses QUICK/DEEP/ASK AI.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const PANEL = '.strat-panel';
const UNKNOWN_CARD = '[data-testid="entitlement-unknown"]';

const forceEntitlementsFail = () => {
  (window as unknown as { __LHQ_QA_FORCE_ENTITLEMENTS_FAIL__?: boolean }).__LHQ_QA_FORCE_ENTITLEMENTS_FAIL__ = true;
};

test.describe('Strategy Panel does not assert a free plan while entitlement is unknown (#1347 item 6)', () => {
  test('a Pro account whose entitlements read fails sees the couldn\'t-verify card in the panel, not a free-capped chip grid', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    await ctx.addInitScript(forceEntitlementsFail);
    const page = await ctx.newPage();
    await installSyntheticSocket(page); // deterministic prices with no Binance from a US runner
    await installPaidAiFence(page);   // #1632: refuse any paid AI path this spec has not stubbed
    try {
      await gotoSignedIn(page, '/arena');
      const panel = page.locator(PANEL);
      await expect(panel, 'the Strategy Panel never rendered on /arena - this run measured nothing').toBeVisible({ timeout: 15_000 });

      await expect(panel.locator(UNKNOWN_CARD),
        'the panel must show EntitlementUnknownCard while the plan cannot be verified - the Confluence card being correct is not enough, ' +
        'the panel is where the defect lived').toBeVisible({ timeout: 15_000 });

      await expect(panel.locator('button.strat-ind-chip'),
        'the indicator chip grid must not render while the plan is unknown - a Pro account capped at one chip is the fail-closed ' +
        'direction #1119 forbids').toHaveCount(0);
      await expect(panel.locator('select.strat-sel'),
        'the strategy-set selector must not render while the plan is unknown').toHaveCount(0);

      // Untouched by the fix, and worth pinning: the card replaces the
      // selection UI, not the whole panel.
      for (const name of ['QUICK', 'DEEP', 'ASK AI']) {
        await expect(panel.getByRole('button', { name, exact: true }),
          `"${name}" must still be present - the fix replaces the selection UI only, "Run the read" was never gated on entitlement`).toBeVisible();
      }
    } finally {
      await ctx.close();
    }
  });

  test('the panel\'s Try again is the SHARED retry - one click clears the panel card AND the Confluence card, and restores the chips', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    await ctx.addInitScript(forceEntitlementsFail);
    const page = await ctx.newPage();
    await installSyntheticSocket(page); // deterministic prices with no Binance from a US runner
    await installPaidAiFence(page);   // #1632: refuse any paid AI path this spec has not stubbed
    try {
      await gotoSignedIn(page, '/arena');
      const panel = page.locator(PANEL);
      await expect(panel.locator(UNKNOWN_CARD)).toBeVisible({ timeout: 15_000 });

      // Two cards showing at once (panel + Confluence) is what makes the next
      // check meaningful: a private retry inside the panel would clear one and
      // leave the other.
      await expect.poll(() => page.locator(UNKNOWN_CARD).count(), {
        message: 'expected the panel card AND the Confluence card to both show while entitlements are unknown',
        timeout: 10_000,
      }).toBeGreaterThanOrEqual(2);

      // The real backend "recovering", then the user's own action - the same
      // order entitlement-unknown.spec.ts uses and for the same reason.
      await page.evaluate(() => {
        (window as unknown as { __LHQ_QA_FORCE_ENTITLEMENTS_FAIL__?: boolean }).__LHQ_QA_FORCE_ENTITLEMENTS_FAIL__ = false;
      });
      // ENTITLEMENT_UNKNOWN_RETRY_BUTTON resolves to "Try again" (not "Retry").
      await panel.locator(UNKNOWN_CARD).getByRole('button', { name: 'Try again' }).click();

      await expect(page.locator(UNKNOWN_CARD),
        'clicking the PANEL\'s Try again left an unknown card on the page - the panel is not calling the shared retryEntitlements ' +
        '(a second implementation of the same pattern is exactly what this PR says it did not add)').toHaveCount(0, { timeout: 15_000 });
      await expect(panel.locator('button.strat-ind-chip').first(),
        'once the plan is confirmed the chip grid must come back').toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });

  test('CONTROL: a confirmed-FREE account (B) still sees the ordinary chip grid, not the unknown card', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'b');
    const page = await ctx.newPage();
    await installSyntheticSocket(page); // deterministic prices with no Binance from a US runner
    await installPaidAiFence(page);   // #1632: refuse any paid AI path this spec has not stubbed
    try {
      await gotoSignedIn(page, '/arena');
      const panel = page.locator(PANEL);
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel.locator('button.strat-ind-chip').first(),
        'a confirmed-free account must still get the chip grid (limit 1) - the fix must not have turned not_entitled into unknown').toBeVisible({ timeout: 15_000 });
      await expect(panel.locator(UNKNOWN_CARD), 'a confirmed-free account must not be shown the couldn\'t-verify card').toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('CONTROL: a confirmed-PRO account (A) is unaffected', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    await installSyntheticSocket(page); // deterministic prices with no Binance from a US runner
    await installPaidAiFence(page);   // #1632: refuse any paid AI path this spec has not stubbed
    try {
      await gotoSignedIn(page, '/arena');
      const panel = page.locator(PANEL);
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel.locator('button.strat-ind-chip').first(), 'a confirmed-Pro account must get the chip grid').toBeVisible({ timeout: 15_000 });
      await expect(panel.locator(UNKNOWN_CARD), 'a confirmed-Pro account must not be shown the couldn\'t-verify card').toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  /* ASSERTION OF THE CHOSEN BEHAVIOUR (was a measurement until #2406). While a signed-in plan read is still in
   * flight the panel must not pretend to know the plan: the strategy-set select and every indicator chip are
   * DISABLED, the note says "Checking your plan…", the free-plan note ("Defaults on free") is NOT shown, and
   * nothing is written to the account's saved strategy selection. The entitlements request is held, never
   * answered, so the account stays inside that window. Every action is time-bounded: a disabled control is the
   * expected state, so a forced click that does nothing is an observation, never a 240 s hang. */
  test('Pro account A while the entitlements read is in flight: select and chips disabled, "Checking your plan…", no free note, nothing saved', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    await installSyntheticSocket(page); // deterministic prices with no Binance from a US runner
    await installPaidAiFence(page);   // #1632: refuse any paid AI path this spec has not stubbed
    const held: Array<import('@playwright/test').Route> = [];
    const writes: string[] = [];
    try {
      await page.route('**/rest/v1/*user_subscriptions*', route => { held.push(route); });
      /* any WRITE of the saved selection is recorded and answered with an empty success, so nothing reaches the shared dev database */
      await page.route(/\/api\/settings(\?|$)/, async route => {
        const q = route.request();
        if (q.method() === 'GET') return route.fallback();
        writes.push(`${q.method()} ${(q.postData() ?? '').slice(0, 120)}`);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [], settings: null }) });
      });
      await gotoSignedIn(page, '/arena');

      const panel = page.locator(PANEL);
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => held.length, {
        message: 'the entitlements request was never issued, so this run is not inside the loading window and asserts nothing',
        timeout: 15_000,
      }).toBeGreaterThan(0);

      const select = panel.locator('select.strat-sel');
      const chips = panel.locator('button.strat-ind-chip');
      await expect(select, 'the strategy-set select is missing').toBeVisible({ timeout: 15_000 });
      await expect(select, 'the strategy-set select must be DISABLED while the plan is unsettled').toBeDisabled({ timeout: 10_000 });
      await expect(chips.first(), 'no indicator chips rendered').toBeVisible({ timeout: 15_000 });
      const n = await chips.count();
      for (let i = 0; i < n; i++) {
        await expect(chips.nth(i), `indicator chip ${i} must be DISABLED while the plan is unsettled`).toBeDisabled({ timeout: 5_000 });
      }
      await expect(panel.getByText('Checking your plan…'), 'the note must read "Checking your plan…"').toBeVisible({ timeout: 5_000 });
      await expect(panel.getByText(/Defaults on free/i), 'the free-plan note must NOT show while the plan is unknown').toHaveCount(0);
      await expect(panel.locator(UNKNOWN_CARD), 'the couldn\'t-verify card is for a FAILED read; this read is still in flight').toHaveCount(0);

      // A forced tap on a disabled chip and a forced pick on the disabled select must do nothing and save nothing.
      await chips.first().click({ force: true, timeout: 3_000 }).catch(() => { /* disabled: the expected outcome */ });
      await select.selectOption('custom', { force: true, timeout: 3_000 }).catch(() => { /* disabled: the expected outcome */ });
      await page.waitForTimeout(1_500);
      expect(writes, 'a write of the saved selection was issued while the plan was unsettled').toHaveLength(0);
      await expect(panel.locator('button.strat-ind-chip.on'), 'a chip became selected while the plan was unsettled').toHaveCount(0);
    } finally {
      await Promise.allSettled(held.map(r => r.abort()));
      await ctx.close();
    }
  });
});
