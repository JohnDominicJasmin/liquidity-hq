/* #2428 (C1, C4), in a browser, on Free fixture B (account A belongs to the release gate). Run on a deployed build that has #2428:
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/settings-saves-one-at-a-time.spec.ts -f project=desktop -f base_url=<qa url>
 *   C1  two edits of the SAME field with the first PATCH still in flight: the second PATCH does not start until the first has answered (it waits for the timestamp that save produced), both succeed
 *       (no 409 conflict), and the account keeps the SECOND value after a reload
 *   C4  the server REFUSES a patch with a 400: exactly ONE request (no retries), and after a reload the saved value shows, not this device's refused one
 * C2 (an edit made before the account resolves is saved at sign-in) needs control of the auth timing and is not in this spec.
 * The field is Account Size on /settings; its original value is put back at the end. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const field = (page: Page) => page.getByLabel('Account Size', { exact: true }).first();
async function setValue(page: Page, v: string) { const f = field(page); await f.fill(v); await f.blur(); }

test('C1. two overlapping saves of one field run one after the other and the second value wins', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await signedInContext(browser, 'b');
  const page = await ctx.newPage();
  const log: { start: number; end?: number; status?: number; body: string }[] = [];
  let first = true;
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const entry = { start: Date.now(), body: route.request().postData() ?? '' } as (typeof log)[number];
    log.push(entry);
    if (first) { first = false; await new Promise((r) => setTimeout(r, 2500)); }   // hold the first save so an edit lands while it is in flight
    const res = await route.fetch();
    entry.end = Date.now(); entry.status = res.status();
    await route.fulfill({ response: res });
  });
  let original = '';
  try {
    await gotoSignedIn(page, '/settings');
    await expect(field(page), 'Account Size never rendered: this run measured nothing').toBeVisible({ timeout: 20_000 });
    original = await field(page).inputValue();
    const a = String((Number(original) || 10_000) + 111), b = String((Number(original) || 10_000) + 222);
    await setValue(page, a);
    await expect.poll(() => log.length, { message: 'the first save never left: the overlap was not exercised', timeout: 20_000 }).toBe(1);
    await setValue(page, b);                                         // while the first PATCH is held
    await expect.poll(() => log.filter((l) => l.end).length, { message: 'the saves did not both finish', timeout: 40_000 }).toBe(2);
    expect(log[1].start, 'the second save started before the first had answered: it carried the OLD timestamp and the server rejects that as a conflict').toBeGreaterThanOrEqual(log[0].end! - 50);
    expect(log.map((l) => l.status), 'a save was rejected (a conflict reverts the newer edit)').toEqual([200, 200]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(field(page)).toBeVisible({ timeout: 20_000 });
    expect(await field(page).inputValue(), 'the account kept the OLDER value').toBe(b);
  } finally {
    await page.unroute('**/api/settings').catch(() => {});
    try { if (original) { await setValue(page, original); await page.waitForTimeout(3000); } } catch { /* best effort */ }
    await ctx.close();
  }
});

test('C4. a patch the server REFUSES (400) is sent once, not retried, and a reload shows the saved value', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedInContext(browser, 'b');
  const page = await ctx.newPage();
  let patches = 0;
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    patches++;
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid value' }) });
  });
  try {
    await gotoSignedIn(page, '/settings');
    await expect(field(page)).toBeVisible({ timeout: 20_000 });
    const original = await field(page).inputValue();
    const changed = String((Number(original) || 10_000) + 333);
    await setValue(page, changed);
    await expect.poll(() => patches, { message: 'the save never left: the refusal was not exercised', timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(9_000);                                // longer than three attempts with their backoff
    expect(patches, 'a refused patch was retried (it used to be sent three times and stay unconfirmed for ever)').toBe(1);
    await page.unroute('**/api/settings');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(field(page)).toBeVisible({ timeout: 20_000 });
    expect(await field(page).inputValue(), 'this device\'s REFUSED value is shown over the saved one after a reload').toBe(original);
  } finally { await ctx.close(); }
});
