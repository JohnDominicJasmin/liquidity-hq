/* #2202 / #1263: Draw Structure on a phone.
 *
 * Until #2202 the phone block of globals.css (max-width 420px) hid every `.klc-tool-btn` except timeframe, Clear and
 * Fullscreen - Draw Structure included, as collateral (gate 43264183678 measured the button's count as 0 at 390).
 * #2202 exempts it by class (`.klc-ds-btn`) and spans its menu across the chart container.
 *
 *   D1  390: Draw Structure is visible, and the MANUAL Draw button stays hidden
 *   D2  390: a press opens the menu after the read; the menu's edges are inside the viewport; scrollWidth <= innerWidth
 *   D3  390: Escape closes it with the lines kept (#2192)
 *   D4  768: nothing changed - the manual Draw button is visible and the menu sits under its own button (left edge aligned)
 *   S   shots at 390, menu OPEN and menu DISMISSED, dark and light - PM signs the menu placement from these
 *
 * "TAP" IS A MOUSE CLICK: signedInContext takes no touch option, and the question is what the press does, not how
 * the pointer got there. ZERO AI SPEND: /api/draw-structure is fulfilled with the real response shape (the one
 * signoff-shots uses); the fence goes in first and the stub second. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';

const DIR = 'qa/.shots';
const themes = ['dark', 'light'] as const;

async function arrange(page: Page, width: number) {
  await installPaidAiFence(page);
  let calls = 0;
  await page.route('**/api/draw-structure', async (route) => {
    calls += 1;
    const HOUR = 3_600_000;
    const t0 = Math.floor(Date.now() / HOUR) * HOUR - 120 * HOUR;
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        structures: ['trendline', 'channel', 'horizontal'].map((type, n) => ({
          type, side: n % 2 ? 'high' : 'low',
          touchTimestamps: [t0 + n * 10 * HOUR, t0 + (n * 10 + 30) * HOUR, t0 + (n * 10 + 60) * HOUR],
          from: { timestamp: t0 + n * 10 * HOUR, price: 100 + n },
          to: { timestamp: t0 + (n * 10 + 60) * HOUR, price: 110 + n },
        })),
      }),
    });
  });
  await gotoSignedIn(page, '/arena?coin=btc&tf=4h');
  await page.waitForTimeout(8_000);
  /* DOM click on the timeframe: at 390 the toolbar can clip a button outside the viewport (gate 43264183678). */
  const tf = page.locator('.klc-tf-btn', { hasText: /^4h$/ }).first();
  if (await tf.count()) { await tf.evaluate((el) => (el as HTMLElement).click()); await page.waitForTimeout(5_000); }
  return { calls: () => calls, ds: page.locator('.klc-ds-btn').first(), menu: page.locator('.klc-ds-wrap .klc-draw-menu'), width };
}

const sideways = (page: Page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));

test.describe('#2202 Draw Structure on a phone', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 180_000 });

  const run = (name: string, width: number, theme: 'dark' | 'light', fn: (a: Awaited<ReturnType<typeof arrange>>, page: Page) => Promise<void>) =>
    test(name, async ({ browser }) => {
      const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : 1000 }, theme });
      const page = await ctx.newPage();
      try {
        const a = await arrange(page, width);
        await fn(a, page);
        assertNoUnstubbedPaidAi(page, 'draw-structure-phone');
      } finally { await ctx.close(); }
    });

  run('D1. 390: Draw Structure is visible, the manual Draw button stays hidden', 390, 'dark', async ({ ds }, page) => {
    await expect(ds, 'Draw Structure is not visible at 390 - the phone rule still hides it').toBeVisible({ timeout: 15_000 });
    const manual = page.locator('.klc-draw-btn:not(.klc-ds-btn)').first();
    if (await manual.count()) await expect(manual, 'the manual Draw button is visible on a phone').toBeHidden();
    const toolsVisible = await page.locator('.klc-tool-btn:not(.klc-tf-btn):not(.klc-clear):not(.klc-fullscreen-btn):not(.klc-ds-btn)').evaluateAll(
      (els) => els.filter(e => (e as HTMLElement).offsetParent !== null).length);
    expect(toolsVisible, 'a manual drawing tool button became visible at 390').toBe(0);
  });

  run('D2. 390: a press opens the menu, its edges are inside the viewport, and the page does not scroll sideways', 390, 'dark', async ({ ds, menu, calls }, page) => {
    await ds.click({ timeout: 15_000 });
    await expect(menu, 'the menu did not open when the read finished').toBeVisible({ timeout: 30_000 });
    expect(calls(), 'the read was not requested exactly once').toBe(1);
    const box = await menu.boundingBox();
    const { sw, iw } = await sideways(page);
    console.log(`[phone D2] menu box=${JSON.stringify(box && { x: Math.round(box.x), w: Math.round(box.width) })} scrollWidth=${sw} innerWidth=${iw}`);
    expect(box, 'no menu box').not.toBeNull();
    expect(box!.x, 'the menu spills off the left edge').toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, 'the menu spills off the right edge').toBeLessThanOrEqual(iw + 0.5);
    expect(sw, `the page scrolls sideways with the menu open (${sw} > ${iw})`).toBeLessThanOrEqual(iw);
  });

  run('D3. 390: Escape closes the menu and the lines stay', 390, 'dark', async ({ ds, menu }, page) => {
    await ds.click({ timeout: 15_000 });
    await expect(menu).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden({ timeout: 5_000 });
    await expect(ds, 'Escape removed the lines: the button is no longer "on"').toHaveClass(/\bon\b/);
    const { sw, iw } = await sideways(page);
    expect(sw).toBeLessThanOrEqual(iw);
  });

  run('D4. 768: nothing changed - the manual Draw button is visible and the menu sits under its own button', 768, 'dark', async ({ ds, menu }, page) => {
    const manual = page.locator('.klc-draw-btn:not(.klc-ds-btn)').first();
    await expect(manual, 'the manual Draw button is not visible at 768').toBeVisible({ timeout: 15_000 });
    await ds.click({ timeout: 15_000 });
    await expect(menu).toBeVisible({ timeout: 30_000 });
    const mb = await menu.boundingBox(); const bb = await ds.boundingBox();
    console.log(`[phone D4] menu x=${Math.round(mb?.x ?? -1)} button x=${Math.round(bb?.x ?? -1)}`);
    expect(Math.abs((mb?.x ?? 1e9) - (bb?.x ?? -1e9)), 'at 768 the menu is no longer aligned under its button (old position changed)').toBeLessThanOrEqual(2);
  });

  for (const theme of themes) {
    run(`S. 390 ${theme}: shots, menu open and dismissed`, 390, theme, async ({ ds, menu }, page) => {
      const mask = [page.locator('.tnav-drop-email'), page.locator('text=/@/')];
      mkdirSync(DIR, { recursive: true });
      await ds.click({ timeout: 15_000 });
      await expect(menu).toBeVisible({ timeout: 30_000 });
      const open = await sideways(page);
      expect(open.sw, 'sideways scroll with the menu open').toBeLessThanOrEqual(open.iw);
      await page.screenshot({ path: `${DIR}/draw-structure-phone-open-390-${theme}.png`, mask, maskColor: '#000000' });
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden({ timeout: 5_000 });
      await expect(ds).toHaveClass(/\bon\b/);
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: `${DIR}/draw-structure-phone-closed-390-${theme}.png`, mask, maskColor: '#000000' });
    });
  }
});
