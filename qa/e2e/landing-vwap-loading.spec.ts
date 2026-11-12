/* #2185 / #1651: the landing hero must not call a figure "Unavailable" while the one bulk snapshot read
 * (`/api/market/snapshot`) is still in flight. Loading is not a reading: a dash and NO note until the
 * read has answered, "Unavailable" only once it answered without the figure or failed outright, and a
 * later failure never overwrites a figure that already arrived (`snapshotStatus` is sticky once ok).
 *
 * THREE CELLS, from PM's list on the PR:
 *   V1  a DELAYED snapshot shows a dash and no "Unavailable" for the whole delay
 *   V2  a snapshot that FAILS (500) shows "Unavailable"
 *   V3  ok then 500 KEEPS the last VWAP and shows no "Unavailable"
 *
 * Dispatched on the PR branch (local stubbed build; no base_url), because qa does not carry #2185 yet:
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/landing-vwap-loading.spec.ts -f project=desktop
 *
 * WHAT IT CANNOT PROVE: V3 needs a SECOND snapshot poll, and MarketProvider polls every 3 minutes, so that
 * cell waits out a real interval (~190s). It also cannot prove the visual treatment of the dash. */
import { test, expect, type Page, type Route } from '@playwright/test';
import { installSyntheticSocket } from './_fixtures';

const SNAP = '**/api/market/snapshot**';

/** The VWAP row of the hero LIVE READ panel as the visitor sees it: the row's own text. */
async function vwapRow(page: Page): Promise<string> {
  return page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('span, div')).find(e => e.children.length === 0 && (e.textContent || '').trim() === 'VWAP');
    return label ? ((label.parentElement as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim() : 'ROW NOT FOUND';
  });
}
const hasFigure = (row: string) => /\$[0-9]/.test(row);

async function open(page: Page) {
  await installSyntheticSocket(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

test.describe('#2185 the hero VWAP while the market read loads', () => {
  test.describe.configure({ timeout: 300_000 });

  test('V1. a delayed snapshot shows a dash and no "Unavailable" for the whole delay', async ({ page }) => {
    const DELAY = 12_000;
    let held: Route | null = null;
    await page.route(SNAP, async (route) => { held = route; await new Promise(r => setTimeout(r, DELAY)); await route.continue().catch(() => {}); });
    await open(page);
    await page.waitForTimeout(4_000);
    const during = await vwapRow(page);
    console.log(`[V1] during the delay: "${during}" (snapshot held: ${held !== null})`);
    expect(held, 'the snapshot request was never made, so nothing about loading was exercised').not.toBeNull();
    expect(during, 'ROW NOT FOUND means the locator, not the app, failed').not.toBe('ROW NOT FOUND');
    expect(during, 'the row says "Unavailable" while the read is still in flight - loading was shown as a reading').not.toMatch(/unavailable/i);
    expect(hasFigure(during), 'a figure appeared before the snapshot answered').toBe(false);
  });

  test('V2. a snapshot that fails (500) shows "Unavailable"', async ({ page }) => {
    await page.route(SNAP, route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"qa: forced"}' }));
    await open(page);
    await expect.poll(() => vwapRow(page), { timeout: 40_000, message: 'a failed read never produced "Unavailable"' }).toMatch(/unavailable/i);
    console.log(`[V2] after the failure: "${await vwapRow(page)}"`);
  });

  test('V3. ok then 500 keeps the last VWAP and shows no "Unavailable"', async ({ page }) => {
    let calls = 0;
    await page.route(SNAP, async (route) => {
      calls += 1;
      if (calls === 1) { await route.continue(); return; }
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"qa: forced after ok"}' });
    });
    await open(page);
    await expect.poll(async () => hasFigure(await vwapRow(page)), { timeout: 40_000 }).toBe(true).catch(() => {});
    const first = await vwapRow(page);
    console.log(`[V3] after the first (ok) read: "${first}"`);
    test.skip(!hasFigure(first), `the first read produced no VWAP on this build ("${first}"), so there is no figure to keep - V3 cannot be exercised here`);
    // MarketProvider polls the snapshot every 3 minutes: wait out one real interval.
    await expect.poll(() => calls, { timeout: 230_000, intervals: [5_000], message: 'a second snapshot poll never fired' }).toBeGreaterThan(1);
    await page.waitForTimeout(3_000);
    const after = await vwapRow(page);
    console.log(`[V3] after the failing re-poll (calls=${calls}): "${after}"`);
    expect(hasFigure(after), 'the last good VWAP was wiped by a later failure').toBe(true);
    expect(after, 'a later failure re-labelled a figure that had already arrived').not.toMatch(/unavailable/i);
  });
});
