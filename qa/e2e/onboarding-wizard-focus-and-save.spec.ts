import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, SUPABASE_URL, signedInContext } from './_auth';
import { gotoGuarded, servedLabels } from './_shared';

/* #1309 batch 3 round 1 (#1386, Dev Team), the ONBOARDING WIZARD - "How to test (QA)"
 * items 7, 8 and 9.
 *
 *   7. FOCUS TRAP. The trap was opened with a constant `true`, so its setup ran once at
 *      mount - while the "Setting up your account" screen was showing, which has no dialog
 *      element. It found no container and never ran again. Focus was never moved in, Tab
 *      could leave the dialog, and Escape (the shortcut for the last step's "skip this
 *      question") did nothing. It now opens when the dialog itself is on screen.
 *   8. SAVE FAILURE. A failed `user_onboarding` upsert was ignored: the wizard closed as if
 *      done and came back on the next load with no explanation. It now stays on the last
 *      step, says so (role=alert, ONBOARDING_FLOW_SAVE_FAILED) and lets the user retry.
 *   9. NAMES AND STATE. The display-name input had no programmatic label, the country
 *      picker and account-size group had no accessible name, and none of the choice
 *      buttons said which is selected. They now carry aria-pressed / labels.
 *
 * WRITTEN AGAINST THE PR'S SOURCE, NOT RUN. Nothing may touch the dev database until
 * PM/DevOps says it answers quickly, and this spec needs a signed-in session, which mints
 * one against dev auth. Against `dev`/`qa` WITHOUT #1386 every test below is expected RED
 * (no focus move, Tab escapes, Escape does nothing, no alert, no aria-pressed).
 *
 * NOTHING IS WRITTEN. Fixture account A is a finished account, and it must stay one: the
 * page is shown an INCOMPLETE `user_onboarding` row by a route stub, every write to that
 * table is answered by the test (201, or 500 for the failure case) and the settings PATCH
 * the wizard sends on finish is answered too. `gotoSignedIn()` is deliberately not used -
 * it throws when the wizard shows, and the wizard is what this looks at.
 *
 * DIFFERENT FROM onboarding-load-failure.spec.ts, which forces a real read failure with a
 * server-side injector to prove the client copes with a REAL Supabase error. This spec is
 * about what the wizard does with its own SAVE result, and a stubbed response is the
 * honest way to make that fail on demand.
 *
 * ASSERTED BY LABEL KEY: wording comes from the served labels, never typed. */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const DIALOG = '[role="dialog"].obw-root';

interface Wizard {
  ctx: BrowserContext;
  page: Page;
  /** Every write the page sent to user_onboarding: the body, and what the stub answered. */
  writes: Array<{ method: string; body: unknown; answered: number }>;
  failWrites: (on: boolean) => void;
}

async function openWizard(browser: Browser): Promise<Wizard> {
  const ctx = await signedInContext(browser, 'a');
  const page = await ctx.newPage();
  const writes: Wizard['writes'] = [];
  let failing = false;

  await page.route(`${SUPABASE_URL}/rest/v1/**`, async route => {
    const req = route.request();
    if (!/user_onboarding/.test(req.url())) return route.fallback();
    if (req.method() === 'GET' || req.method() === 'HEAD') {
      const row = {
        user_id: 'qa-stub', profile_complete: false, tour_seen: true,
        checklist_telegram: false, checklist_price_alert: false, checklist_grok: false, checklist_coins: false,
      };
      // .maybeSingle() asks for ONE object via the Accept header; the wrong shape reads as "no row".
      const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single ? row : [row]) });
    }
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { /* empty body */ }
    const status = failing ? 500 : 201;
    writes.push({ method: req.method(), body, answered: status });
    return failing
      ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ message: 'qa forced failure', code: 'XX000' }) })
      : route.fulfill({ status, body: '' });
  });
  // The wizard's finish() also saves the answers as settings. Answered, never sent on.
  await page.route('**/api/settings', route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [], settings: null }) })
    : route.fallback());

  await gotoGuarded(page, '/dashboard');
  await expect(page.locator(DIALOG), 'the onboarding wizard never appeared for a stubbed INCOMPLETE account - this run measured nothing')
    .toBeVisible({ timeout: 60_000 });
  return { ctx, page, writes, failWrites: on => { failing = on; } };
}

async function pickFirst(page: Page, selector: string) {
  await page.locator(selector).first().click();
}

/** Step 0 needs a country and an account size; steps 1-3 need one choice each; step 4 (the
 *  last) is optional. Leaves the wizard ON the last step. */
async function advanceToLastStep(page: Page) {
  await page.locator('.obw-select').click();
  await pickFirst(page, '.obw-menu-list button');
  await pickFirst(page, '.obw-tile');
  for (let step = 0; step < 4; step++) {
    if (step > 0) await pickFirst(page, '.obw-row');
    await page.locator('.obw-btn-next').click();
  }
  await expect(page.locator('.obw-chip').first(), 'never reached the last step (source chips)').toBeVisible();
}

const activeInsideDialog = (page: Page) => page.evaluate((sel) => {
  const root = document.querySelector(sel);
  return !!root && root.contains(document.activeElement) && document.activeElement !== document.body;
}, DIALOG);

test.describe('the wizard traps focus and Escape works on the last step (item 7)', () => {
  test('focus moves INTO the dialog when it opens', async ({ browser }) => {
    const w = await openWizard(browser);
    try {
      await expect.poll(() => activeInsideDialog(w.page), {
        message: 'focus never moved into the wizard: the trap was set up while the loading screen showed and never re-ran (#1309 item 4)',
        timeout: 10_000,
      }).toBe(true);
    } finally { await w.ctx.close(); }
  });

  test('Tab and Shift+Tab wrap inside the dialog and never leave it', async ({ browser }) => {
    const w = await openWizard(browser);
    try {
      await expect.poll(() => activeInsideDialog(w.page), { timeout: 10_000, message: 'focus never entered the dialog, so wrapping cannot be measured' }).toBe(true);
      const count = await w.page.evaluate((sel) => {
        const root = document.querySelector(sel)!;
        return Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
          .filter(e => e.getClientRects().length > 0).length;
      }, DIALOG);
      expect(count, 'found no focusable controls in the dialog').toBeGreaterThan(2);

      const escaped: string[] = [];
      for (const [key, dir] of [['Tab', 'forward'], ['Shift+Tab', 'backward']] as const) {
        for (let i = 0; i < count + 3; i++) {
          await w.page.keyboard.press(key);
          if (!(await activeInsideDialog(w.page))) {
            escaped.push(`${dir} press ${i + 1}: ${await w.page.evaluate(() => document.activeElement?.tagName + '.' + (document.activeElement as HTMLElement | null)?.className)}`);
            break;
          }
        }
      }
      expect(escaped, `keyboard focus LEFT the modal dialog (${count} focusable controls inside): ${escaped.join('; ')}`).toEqual([]);
    } finally { await w.ctx.close(); }
  });

  test('Escape does nothing on an early step (no universal dismiss), and finishes on the last', async ({ browser }) => {
    const w = await openWizard(browser);
    try {
      await expect.poll(() => activeInsideDialog(w.page), { timeout: 10_000, message: 'focus never entered the dialog' }).toBe(true);
      await w.page.keyboard.press('Escape');
      await w.page.waitForTimeout(500);
      await expect(w.page.locator(DIALOG), 'Escape CLOSED the wizard on step 1 - the profile is required, only the last step may be skipped').toBeVisible();
      expect(w.writes, 'Escape on step 1 saved something').toEqual([]);

      await advanceToLastStep(w.page);
      await w.page.keyboard.press('Escape');
      await expect(w.page.locator(DIALOG), 'Escape on the LAST step did not finish the wizard (it is the shortcut for "skip this question")').toBeHidden({ timeout: 15_000 });
      expect(w.writes.some(x => (x.body as { profile_complete?: boolean } | null)?.profile_complete === true),
        'the wizard closed without sending the profile_complete write').toBe(true);
    } finally { await w.ctx.close(); }
  });
});

test.describe('a failed profile save keeps the wizard open and says so (item 8)', () => {
  test('the write fails: the alert shows, the wizard stays on the last step, and a retry can succeed', async ({ browser, request }) => {
    const labels = await servedLabels(request);
    const saveFailed = labels.ONBOARDING_FLOW_SAVE_FAILED;
    expect(saveFailed, 'ONBOARDING_FLOW_SAVE_FAILED is in neither the served labels nor the shipped defaults - the build under test does not carry #1386').toBeTruthy();

    const w = await openWizard(browser);
    try {
      await advanceToLastStep(w.page);
      w.failWrites(true);
      await w.page.locator('.obw-btn-next').click();

      await expect(w.page.getByRole('alert').filter({ hasText: saveFailed }),
        'no failure message after the profile write was refused - the wizard is treating a failed save as done').toBeVisible({ timeout: 15_000 });
      await expect(w.page.locator(DIALOG), 'the wizard CLOSED although its save failed: it will come back on the next load with no explanation').toBeVisible();
      await expect(w.page.locator('.obw-btn-next'), 'the button stayed disabled/"Saving" after the failure - the user cannot retry').toBeEnabled();
      const failedWrites = w.writes.filter(x => x.answered === 500 && (x.body as { profile_complete?: boolean } | null)?.profile_complete === true);
      expect(failedWrites.length, 'the failing write was never attempted, so this run did not exercise the failure path').toBeGreaterThanOrEqual(1);

      // CONTROL: the same button, the write now succeeds. Without this a wizard that can
      // never finish would also "keep the wizard open and show the alert".
      w.failWrites(false);
      await w.page.locator('.obw-btn-next').click();
      await expect(w.page.locator(DIALOG), 'the retry did not finish the wizard after the write succeeded').toBeHidden({ timeout: 15_000 });
      await expect(w.page.getByRole('alert').filter({ hasText: saveFailed }), 'the failure message is still showing after a successful retry').toHaveCount(0);
    } finally { await w.ctx.close(); }
  });
});

test.describe('the wizard exposes names and selection state (item 9)', () => {
  /** Every control in the group has aria-pressed, none is pressed yet, and after choosing
   *  the one at `index` exactly that one is. */
  async function expectGroup(page: Page, selector: string, what: string, index = 0, afterChoice?: () => Promise<void>) {
    const all = page.locator(selector);
    const n = await all.count();
    expect(n, `no ${what} found (${selector})`).toBeGreaterThan(1);
    const missing = await all.evaluateAll(els => els.filter(e => !e.hasAttribute('aria-pressed')).length);
    expect(missing, `${missing} of ${n} ${what} carry no aria-pressed - a screen reader cannot tell which is selected`).toBe(0);
    expect(await page.locator(`${selector}[aria-pressed="true"]`).count(), `${what}: something is pressed before any choice was made`).toBe(0);
    await all.nth(index).click();
    // A menu closes on choosing; the caller reopens it so the state can be read.
    if (afterChoice) await afterChoice();
    await expect(page.locator(`${selector}[aria-pressed="true"]`), `${what}: after one choice, exactly one must be pressed`).toHaveCount(1);
    await expect(all.nth(index)).toHaveAttribute('aria-pressed', 'true');
  }

  test('step 1: display name is labelled, the country picker and account group are named, every choice reports its state', async ({ browser, request }) => {
    const labels = await servedLabels(request);
    const w = await openWizard(browser);
    try {
      const { page } = w;
      await expect(page.getByLabel(labels.ONBOARDING_FLOW_DISPLAY_NAME_LABEL).first(),
        'the display-name input has no programmatic label (its <label> has no htmlFor) - a screen reader announces an unnamed edit box').toBeVisible();

      const country = page.getByRole('button', { name: labels.ONBOARDING_FLOW_COUNTRY_LABEL }).first();
      await expect(country, 'the country picker button has no accessible name of the country label').toBeVisible();
      await expect(country).toHaveAttribute('aria-expanded', 'false');
      await country.click();
      await expect(country, 'the country picker does not say it is expanded').toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByLabel(labels.ONBOARDING_FLOW_SEARCH_COUNTRY_PLACEHOLDER).first(),
        'the country search box has only a placeholder for a name - it vanishes on typing and is not a label').toBeVisible();
      await expectGroup(page, '.obw-menu-list button', 'country options', 0, async () => {
        await expect(page.locator('.obw-menu-list'), 'the country menu did not close after a choice').toBeHidden();
        await country.click();
        await expect(page.locator('.obw-menu-list')).toBeVisible();
      });

      await expect(page.getByRole('group', { name: labels.ONBOARDING_FLOW_ACCOUNT_RANGE_LABEL }),
        'the account-size tiles are not a named group').toBeVisible();
      await expectGroup(page, '.obw-tile', 'account-size tiles');
    } finally { await w.ctx.close(); }
  });

  test('steps 2 to 4: experience, style, goal and source choices each report their state', async ({ browser }) => {
    const w = await openWizard(browser);
    try {
      const { page } = w;
      await page.locator('.obw-select').click();
      await pickFirst(page, '.obw-menu-list button');
      await pickFirst(page, '.obw-tile');
      await page.locator('.obw-btn-next').click();

      for (const what of ['experience options', 'trading-style options', 'goal options']) {
        await expectGroup(page, '.obw-row', what, 1);
        await page.locator('.obw-btn-next').click();
      }
      await expectGroup(page, '.obw-chip', 'source chips', 2);
    } finally { await w.ctx.close(); }
  });
});
