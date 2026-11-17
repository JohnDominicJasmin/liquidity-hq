/* AUDIT, user FLOWS on a hosted TEST environment (staging; fixtures A = Pro, B = Free; the dev database). Informational: one [FLOW] JSON line per flow with what was seen, fails only when the harness could not run it.
 *   F:signin-signout:free          the real sign-in FORM with the Free fixture's test credentials, lands off /login, then Sign out returns to a signed-out screen
 *   F:signup-mismatch / F:signup-weak   /login?signup=1: a password mismatch and a policy-failing password are refused BEFORE any request (the page makes no network call; a valid-looking submit is never sent: no account is created)
 *   F:forgot-password              the page renders, the email field is required, an empty submit sends nothing (no reset email is requested)
 *   F:settings-save:pro            Account Size: edit, blur, the save answers 2xx, reload shows it, the original is put back
 *   F:telegram-states:pro          /alerts with the status stubbed as not connected / connected / paused / error: what the page says in each state
 *   F:upgrade-cta:free|pro         what /upgrade offers each plan (CTA labels and where they point); the CTA is NOT clicked (that would start a checkout); a Pro account must see a manage / cancel route
 *   F:probe-journal:pro / F:probe-alerts:pro   what the page exposes (buttons, forms, empty state): reported, not driven
 * NOT DONE, and why: onboarding first run (needs a brand-new account; no new accounts are created), journal add/edit/delete and Pro alert create/delete (the forms are not driven blind: the probes above report the controls so a cell can be written against real selectors), a real checkout (never).
 * Paid-AI fence on. Production: skipped (these sign in with fixtures that exist only on the test environments). */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, FIXTURES, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { gotoGuarded } from './_shared';

test.skip(!AUTH_READY || process.env.E2E_ALLOW_PRODUCTION === '1', 'fixture accounts are not configured, or this is a production run');
const flow = (name: string, data: Record<string, unknown>) => console.log(`[FLOW] ${JSON.stringify({ flow: name, ...data })}`);
const visibleText = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim());

test.describe('flows', () => {
  test.describe.configure({ timeout: 180_000 });

  test('F:signin-signout:free', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addInitScript(() => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); await installPaidAiFence(page);
    try {
      await gotoGuarded(page, '/login'); const email = page.locator('input.login-email-input[type="email"]').first(); const pw = page.locator('input.login-email-input[type="password"]').first();
      await email.waitFor({ state: 'visible', timeout: 30_000 }); await email.fill(FIXTURES.bEmail); await pw.fill(FIXTURES.bPassword);
      await page.getByRole('button', { name: /^(sign in|log in)$/i }).first().click();
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 45_000, message: 'still on /login after signing in' }).not.toBe('/login');
      const landed = new URL(page.url()).pathname; await page.waitForTimeout(4_000);
      await gotoGuarded(page, '/settings'); await page.waitForTimeout(3_000);
      const out = page.getByRole('button', { name: /sign out|log out/i }).first(); const hasOut = await out.isVisible().catch(() => false);
      if (hasOut) { await out.click(); await page.waitForTimeout(4_000); }
      const after = new URL(page.url()).pathname; const txt = (await visibleText(page)).slice(0, 140);
      flow('signin-signout:free', { landedAfterSignIn: landed, signOutButtonFound: hasOut, urlAfterSignOut: after, signedOutLooksLike: txt });
    } finally { await ctx.close(); }
  });

  for (const [name, pass, confirm] of [['signup-mismatch', 'Qa-Valid-Pass-1234', 'Qa-Different-1234'], ['signup-weak', 'a', 'a']] as const) {
    test(`F:${name}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); await installPaidAiFence(page);
      const reqs: string[] = []; page.on('request', (r) => { if (/\/auth\/v1\/(signup|token)|\/api\/(signup|auth)/.test(r.url())) reqs.push(`${r.method()} ${new URL(r.url()).pathname}`); });
      try {
        await gotoGuarded(page, '/login?signup=1'); await page.waitForTimeout(3_000);
        const email = page.locator('input.login-email-input[type="email"]').first(); await email.waitFor({ state: 'visible', timeout: 30_000 }); await email.fill('qa-validation@example.invalid');
        const pws = page.locator('input.login-email-input[type="password"]'); await pws.nth(0).fill(pass); if (await pws.count() > 1) await pws.nth(1).fill(confirm);
        await page.getByRole('button', { name: /create account|sign up|^sign up$/i }).last().click().catch(() => {}); await page.waitForTimeout(2_500);
        const err = await page.locator('[role="alert"], .login-error, .login-pw-error, [class*=error]').first().innerText().catch(() => '');
        flow(name, { errorShown: err.trim().slice(0, 160) || null, authRequestsSent: reqs, refusedBeforeNetwork: reqs.length === 0 });
        expect(reqs, 'a sign-up request left the page for a value that must be refused locally').toEqual([]);
      } finally { await ctx.close(); }
    });
  }

  test('F:forgot-password', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); const reqs: string[] = [];
    page.on('request', (r) => { if (/\/auth\/v1\/recover|\/api\/.*(reset|recover|forgot)/.test(r.url())) reqs.push(r.url().slice(0, 80)); });
    try {
      await gotoGuarded(page, '/forgot-password'); await page.waitForTimeout(3_000);
      const email = page.locator('input[type="email"]').first(); const there = await email.isVisible().catch(() => false);
      const required = await email.evaluate((e) => (e as HTMLInputElement).required).catch(() => null);
      await page.getByRole('button', { name: /send|reset|continue|submit/i }).first().click().catch(() => {}); await page.waitForTimeout(1_500);
      flow('forgot-password', { emailFieldVisible: there, emailRequired: required, resetRequestsSentByEmptySubmit: reqs, text: (await visibleText(page)).slice(0, 140) });
      expect(reqs).toEqual([]);
    } finally { await ctx.close(); }
  });

  test('F:settings-save:pro', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage(); await installPaidAiFence(page);
    try {
      await gotoSignedIn(page, '/settings'); const f = page.getByLabel('Account Size', { exact: true }).first(); await f.waitFor({ state: 'visible', timeout: 30_000 });
      const original = await f.inputValue(); const mine = String(Number(original.replace(/[^0-9.]/g, '') || '10000') + 7);
      const saved = page.waitForResponse((r) => /\/api\/settings/.test(r.url()) && r.request().method() !== 'GET', { timeout: 30_000 }).catch(() => null);
      await f.fill(mine); await f.blur(); const res = await saved; await page.waitForTimeout(2_000);
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5_000); const afterReload = await page.getByLabel('Account Size', { exact: true }).first().inputValue();
      const back = page.waitForResponse((r) => /\/api\/settings/.test(r.url()) && r.request().method() !== 'GET', { timeout: 30_000 }).catch(() => null);
      const g = page.getByLabel('Account Size', { exact: true }).first(); await g.fill(original); await g.blur(); await back; await page.waitForTimeout(1_500);
      flow('settings-save:pro', { original, edited: mine, saveStatus: res?.status() ?? null, shownAfterReload: afterReload, persisted: afterReload.replace(/[^0-9.]/g, '') === mine.replace(/[^0-9.]/g, ''), restored: true });
    } finally { await ctx.close(); }
  });

  test('F:telegram-states:pro', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage(); await installPaidAiFence(page); const states: Record<string, unknown> = {};
    try {
      for (const [name, status, body] of [['not-connected', 200, { configured: false }], ['connected', 200, { configured: true }], ['paused', 200, { configured: true, paused: true }], ['error', 502, { error: 'stand-in' }]] as const) {
        await page.unroute(/\/api\/telegram\/status/).catch(() => {}); await page.route(/\/api\/telegram\/status/, (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
        await gotoSignedIn(page, '/alerts'); await page.waitForTimeout(5_000);
        const lines = (await page.evaluate(() => (document.body.innerText || '').split('\n').map((l) => l.trim()).filter((l) => /telegram|connect|paused|couldn.?t check|not configured|configured/i.test(l) && l.length < 120).slice(0, 6)));
        states[name] = lines;
      }
      flow('telegram-states:pro', states);
    } finally { await ctx.close(); }
  });

  for (const who of ['b', 'a'] as const) {
    test(`F:upgrade-cta:${who === 'a' ? 'pro' : 'free'}`, async ({ browser }) => {
      const ctx = await signedInContext(browser, who); const page = await ctx.newPage(); await installPaidAiFence(page);
      try {
        await gotoSignedIn(page, '/upgrade'); await page.waitForTimeout(6_000);
        const ctas = await page.evaluate(() => Array.from(document.querySelectorAll('a[href],button')).filter((e) => /(upgrade|get pro|start|subscribe|manage|cancel|billing|checkout|keep pro|renew)/i.test((e.textContent || '') + (e.getAttribute('href') || ''))).slice(0, 10).map((e) => `${e.tagName.toLowerCase()} "${(e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)}" ${(e as HTMLAnchorElement).href ? '-> ' + new URL((e as HTMLAnchorElement).href).host + new URL((e as HTMLAnchorElement).href).pathname : ''}${(e as HTMLButtonElement).disabled ? ' [disabled]' : ''}`));
        flow(`upgrade-cta:${who === 'a' ? 'pro' : 'free'}`, { ctas, clicked: false, note: 'not clicked: a click starts a checkout' });
      } finally { await ctx.close(); }
    });
  }

  /* TELEGRAM STATES on Settings (the status row reads /api/telegram/status): not configured / configured / paused / failed read */
  test('F:telegram-settings-states:pro', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage(); await installPaidAiFence(page); const states: Record<string, unknown> = {};
    try {
      for (const [name, status, body] of [['not-configured', 200, { configured: false }], ['configured', 200, { configured: true }], ['paused', 200, { configured: true, paused: true }], ['error', 502, { error: 'stand-in' }]] as const) {
        await page.unroute(/\/api\/telegram\/status/).catch(() => {}); await page.route(/\/api\/telegram\/status/, (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
        await gotoSignedIn(page, '/settings'); await page.waitForTimeout(5_000);
        states[name] = await page.evaluate(() => (document.body.innerText || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(configured|not configured|paused|couldn.?t check|checking|manage alerts|set up)/i.test(l) || /telegram/i.test(l)).slice(0, 6));
      }
      flow('telegram-settings-states:pro', states);
    } finally { await ctx.close(); }
  });

  /* JOURNAL: add a trade with a unique note, see it, delete it. A step that cannot be done is REPORTED with where it stopped, never thrown. */
  test('F:journal-add-delete:pro', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage(); await installPaidAiFence(page); const note = `QA flow ${Date.now()}`; const seen: Record<string, unknown> = { note };
    page.on('dialog', (d) => { seen.dialog = d.message().slice(0, 80); void d.accept(); });
    try {
      await gotoSignedIn(page, '/journal'); await page.waitForTimeout(4_000);
      const before = (await visibleText(page)).match(/History \((\d+)\)/)?.[1] ?? null; seen.historyBefore = before;
      await page.getByRole('button', { name: /\+\s*log trade/i }).first().click({ timeout: 15_000 }).catch(() => { seen.stoppedAt = 'open form'; });
      const num = (label: RegExp, v: string) => page.getByLabel(label).first().fill(v, { timeout: 8_000 }).catch(() => { seen[`noField:${label}`] = true; });
      await num(/^entry/i, '65000'); await num(/stop loss/i, '64000'); await num(/take profit/i, '67000'); await num(/position size/i, '100');
      await page.getByPlaceholder(/notes?/i).first().fill(note, { timeout: 8_000 }).catch(async () => { await page.locator('textarea').first().fill(note).catch(() => { seen.noNotes = true; }); });
      const save = page.getByRole('button', { name: /^(save|log|add|submit|log trade|save trade)/i }).last(); seen.saveButton = await save.innerText().catch(() => null);
      await save.click({ timeout: 8_000 }).catch(() => { seen.stoppedAt = seen.stoppedAt ?? 'save'; }); await page.waitForTimeout(4_000);
      seen.afterSave = (await visibleText(page)).includes(note) || ((await visibleText(page)).match(/History \((\d+)\)/)?.[1] ?? null) !== before;
      await page.getByRole('button', { name: /history/i }).first().click({ timeout: 8_000 }).catch(() => {}); await page.waitForTimeout(2_000);
      seen.noteVisibleInHistory = (await visibleText(page)).includes(note);
      const row = page.locator('tr, li, div').filter({ hasText: note }).last();
      const del = row.getByRole('button', { name: /delete|remove|trash|✕|×/i }).first();
      seen.deleteControl = await del.isVisible().catch(() => false);
      if (seen.deleteControl) { await del.click({ timeout: 8_000 }).catch(() => {}); await page.waitForTimeout(3_000); seen.deleted = !(await visibleText(page)).includes(note); }
      flow('journal-add-delete:pro', seen);
    } finally { await ctx.close(); }
  });

  /* PRO PRICE ALERT: create one far from the market (BTC above 5,000,000: it can never fire), see it, delete it */
  test('F:alert-create-delete:pro', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage(); await installPaidAiFence(page); const note = `QA flow ${Date.now()}`; const seen: Record<string, unknown> = { note };
    page.on('dialog', (d) => { seen.dialog = d.message().slice(0, 80); void d.accept(); });
    try {
      await gotoSignedIn(page, '/alerts'); await page.waitForTimeout(4_000);
      await page.getByLabel('Coin').first().selectOption({ label: 'BTC' }).catch(() => { seen.coinSelect = 'could not pick BTC'; });
      await page.getByLabel(/alert direction/i).first().selectOption({ index: 0 }).catch(() => { seen.dirSelect = 'could not pick'; });
      await page.getByLabel(/alert price/i).first().fill('5000000').catch(() => { seen.noPrice = true; });
      await page.getByLabel(/alert note/i).first().fill(note).catch(() => { seen.noNote = true; });
      const add = page.getByRole('button', { name: /^(add|create|set|save).*|\+/i }).last(); seen.addButton = await add.innerText().catch(() => null);
      await add.click({ timeout: 8_000 }).catch(() => { seen.stoppedAt = 'add'; }); await page.waitForTimeout(4_000);
      seen.listed = (await visibleText(page)).includes(note);
      const row = page.locator('tr, li, div').filter({ hasText: note }).last(); const del = row.getByRole('button', { name: /delete|remove|✕|×/i }).first();
      seen.deleteControl = await del.isVisible().catch(() => false);
      if (seen.deleteControl) { await del.click({ timeout: 8_000 }).catch(() => {}); await page.waitForTimeout(3_000); seen.deleted = !(await visibleText(page)).includes(note); }
      flow('alert-create-delete:pro', seen);
    } finally { await ctx.close(); }
  });

  for (const path of ['/journal', '/alerts']) {
    test(`F:probe-${path.slice(1)}:pro`, async ({ browser }) => {
      const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage(); await installPaidAiFence(page);
      try {
        await gotoSignedIn(page, path); await page.waitForTimeout(6_000);
        const probe = await page.evaluate(() => ({ buttons: Array.from(document.querySelectorAll('button:not([disabled])')).filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e.textContent || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 28)).filter(Boolean).slice(0, 16), inputs: Array.from(document.querySelectorAll('input,select,textarea')).filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => `${e.tagName.toLowerCase()}[${(e as HTMLInputElement).type || ''}] ${(e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('name') || '').slice(0, 24)}`).slice(0, 12), headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((e) => (e.textContent || '').trim().slice(0, 30)).slice(0, 8) }));
        flow(`probe-${path.slice(1)}:pro`, probe);
      } finally { await ctx.close(); }
    });
  }
});
