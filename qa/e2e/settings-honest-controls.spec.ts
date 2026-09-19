import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { servedLabels } from './_shared';

/* #1309 batch 3 round 1 (#1386, Dev Team), the SETTINGS page - "How to test (QA)" items
 * 1 to 4. Each was a control that lied or could not be reached:
 *
 *   1. TELEGRAM STATUS. The check sent no sign-in token, so /api/telegram/status answered
 *      with the SERVER's env-var configuration and every user saw the same thing; and a
 *      failed check read "Not configured". Now it sends the bearer token and a failed or
 *      malformed check is its own state, "Couldn't check" (SETTINGS_TG_STATUS_ERROR).
 *   2. PUSH TOGGLE. It turned on whatever the server said. Now a refused subscribe leaves
 *      it off, drops the browser subscription and shows SETTINGS_PUSH_ENABLE_FAILED.
 *   3. RISK %. The field kept a NUMBER, so typing "0" blanked it before ".5" could follow.
 *   4. aria-pressed on timeframe chips, risk presets, theme chips and language chips.
 *
 * WRITTEN AGAINST THE PR'S SOURCE, NOT RUN. Not run because nothing may touch the dev
 * database until PM/DevOps says it answers quickly, and because the fix is unmerged: against
 * `dev`/`qa` without #1386 every test below is expected RED (bare status, toggle turns on,
 * field blanks, no aria-pressed). Per the merge order the fix lands first, so no test.fail()
 * is needed at merge time; if these are ever merged ahead of it, mark them test.fail().
 *
 * NO WRITES REACH THE ACCOUNT. `/api/settings` PATCHes, the Telegram route and the push
 * subscribe route are all answered by the test; nothing is sent to the shared database.
 *
 * ASSERTED BY LABEL KEY: the expected wording is read from the served labels (database
 * rows over shipped defaults), never typed. The three NEW keys fall back to the English
 * default until PM/DevOps applies the rows, so a run before then sees English in every
 * locale - fine, this file runs in English. */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const STATUS = '.st-tg-status';

async function openSettings(page: Page) {
  // Every write the page could make is answered here, so a stray click cannot reach the account.
  await page.route('**/api/settings', route => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: ['risk_pct', 'default_tf', 'theme', 'language'] }) });
    }
    return route.fallback();
  });
  await gotoSignedIn(page, '/settings');
  await expect(page.locator('[data-testid="settings-page"]').first(), 'the settings page never rendered').toBeVisible({ timeout: 30_000 });
}

test.describe('Telegram status is per user, and a failed check is not "Not configured" (item 16)', () => {
  const cases: Array<{ name: string; respond: (r: import('@playwright/test').Route) => Promise<void>; key: 'SETTINGS_TG_CONFIGURED' | 'SETTINGS_TG_NOT_CONFIGURED' | 'SETTINGS_TG_STATUS_ERROR' }> = [
    { name: '{configured:true} reads Configured', key: 'SETTINGS_TG_CONFIGURED',
      respond: r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) }) },
    { name: '{configured:false} reads Not configured', key: 'SETTINGS_TG_NOT_CONFIGURED',
      respond: r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false }) }) },
    { name: 'a 500 reads "Couldn\'t check", NOT "Not configured"', key: 'SETTINGS_TG_STATUS_ERROR',
      respond: r => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) },
    { name: 'a malformed 200 reads "Couldn\'t check"', key: 'SETTINGS_TG_STATUS_ERROR',
      respond: r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unexpected: 'shape' }) }) },
    { name: 'a dropped connection reads "Couldn\'t check"', key: 'SETTINGS_TG_STATUS_ERROR',
      respond: r => r.abort('failed') },
  ];
  for (const c of cases) {
    test(c.name, async ({ browser, request }) => {
      const labels = await servedLabels(request);
      const expected = labels[c.key];
      expect(expected, `${c.key} is in neither the served labels nor the shipped defaults - the build under test does not carry #1386's new key`).toBeTruthy();

      const ctx = await signedInContext(browser, 'a');
      const page = await ctx.newPage();
      const auth: Array<string | undefined> = [];
      try {
        await page.route('**/api/telegram/status', route => { auth.push(route.request().headers()['authorization']); return c.respond(route); });
        await openSettings(page);
        await expect(page.locator(STATUS), `the Telegram status did not read "${expected}"`).toContainText(expected, { timeout: 20_000 });
        if (c.key === 'SETTINGS_TG_STATUS_ERROR') {
          await expect(page.locator(STATUS), 'a FAILED check must not read "Not configured"').not.toContainText(labels.SETTINGS_TG_NOT_CONFIGURED);
        }
        expect(auth.length, 'the page never requested /api/telegram/status').toBeGreaterThan(0);
        expect(auth[0], 'the status request carried no Authorization: Bearer token - without it the route answers with the SERVER\'s config, the same for every user')
          .toMatch(/^Bearer .{10,}/);
      } finally {
        await ctx.close();
      }
    });
  }
});

test.describe('The push toggle does not claim what the server refused (item 21)', () => {
  async function pushContext(browser: import('@playwright/test').Browser) {
    const ctx = await signedInContext(browser, 'a');
    // Headless Chromium has no push service, so the BROWSER side is faked; the server's
    // answer - the code path under test - is the real handler reacting to a stubbed response.
    await ctx.addInitScript(() => {
      const w = window as unknown as { __pushCalls: { subscribe: number; unsubscribe: number } };
      w.__pushCalls = { subscribe: 0, unsubscribe: 0 };
      const fakeSub = {
        endpoint: 'https://push.invalid/qa-fake-endpoint',
        toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'qa', auth: 'qa' } }; },
        async unsubscribe() { w.__pushCalls.unsubscribe++; return true; },
      };
      if (typeof PushManager !== 'undefined') {
        PushManager.prototype.subscribe = async function () { w.__pushCalls.subscribe++; return fakeSub as unknown as PushSubscription; };
        PushManager.prototype.getSubscription = async function () { return null; };
      }
      if (typeof Notification !== 'undefined') {
        Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
        Notification.requestPermission = async () => 'granted';
      }
    });
    return ctx;
  }

  async function clickPushToggle(page: Page, request: import('@playwright/test').APIRequestContext) {
    const labels = await servedLabels(request);
    const dialogs: string[] = [];
    page.on('dialog', d => { dialogs.push(d.message()); void d.dismiss(); });
    const toggle = page.getByRole('switch', { name: labels.SETTINGS_FIELD_PUSH_NOTIFICATIONS });
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    // serviceWorker.ready must resolve or the handler hangs before it reaches the server.
    const swReady = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise<boolean>(r => setTimeout(() => r(false), 8_000)),
    ])).catch(() => false);
    test.skip(!swReady, 'no service worker registered on this build, so the push handler cannot run here');
    await toggle.click();
    await page.waitForTimeout(1_500);
    test.skip(dialogs.some(d => /VAPID|not configured|not supported/i.test(d)), `this build cannot exercise push (${dialogs.join(' | ')})`);
    return { toggle, labels };
  }

  test('a subscribe the server REFUSES (500) leaves the toggle off, drops the browser subscription and says so', async ({ browser, request }) => {
    const ctx = await pushContext(browser);
    const page = await ctx.newPage();
    try {
      await page.route('**/api/push/subscribe', route => route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : route.fallback());
      await openSettings(page);
      const { toggle, labels } = await clickPushToggle(page, request);

      await expect(toggle, 'the toggle turned ON although the server refused the subscription - it promises notifications that will never arrive')
        .toHaveAttribute('aria-checked', 'false');
      await expect(page.getByRole('alert').filter({ hasText: labels.SETTINGS_PUSH_ENABLE_FAILED }),
        'no failure caption after the server refused the subscription').toBeVisible();
      const calls = await page.evaluate(() => (window as unknown as { __pushCalls: { subscribe: number; unsubscribe: number } }).__pushCalls);
      expect(calls.subscribe, 'the app never asked the browser to subscribe - this run measured nothing').toBeGreaterThan(0);
      expect(calls.unsubscribe, 'the browser-side subscription was NOT dropped after the server refused it - both sides must agree it is off').toBe(1);
    } finally {
      await ctx.close();
    }
  });

  test('CONTROL: a subscribe the server ACCEPTS (200) turns the toggle on', async ({ browser, request }) => {
    const ctx = await pushContext(browser);
    const page = await ctx.newPage();
    try {
      await page.route('**/api/push/subscribe', route => route.request().method() === 'POST'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }) : route.fallback());
      await openSettings(page);
      const { toggle } = await clickPushToggle(page, request);
      await expect(toggle, 'the toggle stayed off although the server accepted the subscription - the failure path is always on').toHaveAttribute('aria-checked', 'true');
    } finally {
      await ctx.close();
    }
  });
});

test.describe('The risk % field can hold 0.5 (item 27)', () => {
  test('typing 0, ., 5 one key at a time never blanks the field, ends at 0.5 and saves 0.5', async ({ browser, request }) => {
    const labels = await servedLabels(request);
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    const patches: Array<Record<string, unknown>> = [];
    try {
      await page.route('**/api/settings', route => {
        if (route.request().method() === 'PATCH') {
          patches.push(route.request().postDataJSON() as Record<string, unknown>);
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: ['risk_pct'] }) });
        }
        return route.fallback();
      });
      await gotoSignedIn(page, '/settings');
      const field = page.getByLabel(labels.SETTINGS_FIELD_RISK_PER_TRADE);
      await expect(field, 'the risk % field never rendered').toBeVisible({ timeout: 30_000 });

      await field.fill('');
      await field.focus();
      // One key at a time, like a person. The bug: the field held a NUMBER, so "0" parsed to
      // 0, which is falsy, and `value={risk_pct || ''}` blanked the box before ".5" could
      // follow. Only the first key and the end state are asserted: what a number input
      // REPORTS for the half-typed "0." differs between browsers ("" in some), so reading
      // it would be measuring the browser, not the page.
      await field.press('0');
      await expect(field, 'typing "0" BLANKED the field - the next keys ("." then "5") land in an empty box and the result is 5, not 0.5')
        .toHaveValue('0');
      await field.press('.');
      await field.press('5');
      await expect(field, 'the field did not end at 0.5 after typing 0, ., 5').toHaveValue('0.5');
      await expect.poll(() => patches.some(p => p.risk_pct === 0.5), { message: `the value 0.5 was never saved (saw ${JSON.stringify(patches.map(p => p.risk_pct))})`, timeout: 8_000 }).toBe(true);
      // Leaving the field hands it back to the saved value: still 0.5, not blank.
      await field.blur();
      await expect(field, 'the field lost its value on blur').toHaveValue('0.5');
    } finally {
      await ctx.close();
    }
  });

  test('CONTROL: a preset still sets the field', async ({ browser, request }) => {
    const labels = await servedLabels(request);
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await openSettings(page);
      const field = page.getByLabel(labels.SETTINGS_FIELD_RISK_PER_TRADE);
      // First and last, so at least one differs from whatever the account already holds.
      for (const which of ['first', 'last'] as const) {
        const preset = which === 'first' ? page.locator('.st-preset').first() : page.locator('.st-preset').last();
        const text = (await preset.innerText()).replace(/[^0-9.]/g, '');
        await preset.click();
        await expect(field, `clicking the ${which} preset (${text}%) did not set the field`).toHaveValue(text);
      }
    } finally {
      await ctx.close();
    }
  });
});

test('every chip and preset on Settings exposes aria-pressed, true on exactly the selected one (item 51)', async ({ browser }) => {
  const ctx = await signedInContext(browser, 'a');
  const page = await ctx.newPage();
  try {
    await openSettings(page);
    const report = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="settings-page"]') as HTMLElement;
      const controls = Array.from(root.querySelectorAll<HTMLElement>('button.st-chip, button.st-preset'));
      const groups = new Map<Element, HTMLElement[]>();
      for (const c of controls) { const p = c.parentElement!; groups.set(p, [...(groups.get(p) ?? []), c]); }
      return {
        total: controls.length,
        missing: controls.filter(c => !c.hasAttribute('aria-pressed')).map(c => `${c.className}:${c.textContent?.trim()}`),
        groups: Array.from(groups.values()).map(g => ({
          kind: g[0].classList.contains('st-preset') ? 'preset' : 'chip',
          size: g.length,
          pressed: g.filter(c => c.getAttribute('aria-pressed') === 'true').length,
        })),
      };
    });
    expect(report.total, 'no chips or presets found on Settings - this run measured nothing').toBeGreaterThan(10);
    expect(report.missing, 'these controls carry no aria-pressed, so a screen reader cannot tell which is selected').toEqual([]);
    const chipGroups = report.groups.filter(g => g.kind === 'chip');
    expect(chipGroups.length, 'expected the timeframe, theme and language chip groups').toBeGreaterThanOrEqual(3);
    for (const g of chipGroups) expect(g.pressed, `a chip group of ${g.size} has ${g.pressed} pressed; exactly one must be`).toBe(1);
    for (const g of report.groups.filter(g => g.kind === 'preset')) expect(g.pressed, 'more than one risk preset is pressed').toBeLessThanOrEqual(1);
  } finally {
    await ctx.close();
  }
});
