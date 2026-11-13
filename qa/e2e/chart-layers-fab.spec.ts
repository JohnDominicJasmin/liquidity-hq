/* #2207 / #1185: Chart Layers text and switches stay clear of the Ask AI button at every width.
 *
 * PM's sign-off found "· BTC only" on the Options levels row still under the button at 1280 (#2190 limited the 72px gutter to
 * 1100px and below). #2207 makes the gutter apply at every width. This measures it: for every row of the Chart Layers section, the
 * row's text and its switch are scrolled past the (fixed) button and their boxes are compared with the button's box.
 *
 *   L1  1280 and 1440: no Chart Layers element overlaps the Ask AI button, and none overflows the panel
 *   L2  390 and 768 (already proven by #2190): the same assertion as controls - a failure there is the harness
 *
 * Anonymous is not enough (the Strategy panel needs a session), so this signs in as fixture A; nothing is written, nothing billed.
 * Every width is shot (screenshots=true on dispatch) so PM can look. */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const DIR = 'qa/.shots';
const hits = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

for (const width of [1440, 1280, 768, 390]) {
  test(`#2207 Chart Layers clears the Ask AI button at ${width}px`, async ({ browser }) => {
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    test.setTimeout(150_000);
    const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : 1000 } });
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h');
      const layers = page.locator('.strat-layers').first();
      await expect(layers, 'the Chart Layers section never rendered').toBeAttached({ timeout: 30_000 });
      await page.waitForTimeout(4_000);
      const fab = page.locator('.gchat-fab').first();
      await expect(fab, 'the Ask AI button is not on the page').toBeAttached({ timeout: 15_000 });

      /* Every leaf element with text and every switch inside the section. Scroll each one into view and compare it with the
         FAB's box AT THAT MOMENT (the button is fixed, so the pair changes as the page scrolls). */
      const count = await layers.evaluate((el) => {
        const items = Array.from(el.querySelectorAll('*')).filter((n) => {
          const e = n as HTMLElement;
          return e.getAttribute('role') === 'switch' || (e.children.length === 0 && (e.textContent ?? '').trim().length > 0);
        });
        items.forEach((n, i) => (n as HTMLElement).setAttribute('data-lf', String(i)));
        return items.length;
      });
      expect(count, 'the Chart Layers section has no rows or switches to measure').toBeGreaterThan(2);

      const bad: string[] = []; let compared = 0; let overflow = 0;
      for (let i = 0; i < count; i += 1) {
        const item = layers.locator(`[data-lf="${i}"]`);
        await item.scrollIntoViewIfNeeded().catch(() => {});
        const ib = await item.boundingBox(); const fb = await fab.boundingBox();
        const panel = await layers.boundingBox();
        if (!ib || !fb) continue;
        compared += 1;
        if (hits(ib, fb)) bad.push(`${(await item.innerText().catch(() => '')).trim().slice(0, 40) || 'switch'} @ x${Math.round(ib.x)}-${Math.round(ib.x + ib.width)}, fab x${Math.round(fb.x)}-${Math.round(fb.x + fb.width)}`);
        if (panel && ib.x + ib.width > panel.x + panel.width + 1) overflow += 1;
      }
      mkdirSync(DIR, { recursive: true });
      await page.screenshot({ path: `${DIR}/chart-layers-${width}.png`, mask: [page.locator('.tnav-drop-email'), page.locator('text=/@/')], maskColor: '#000000' });
      const sideways = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      console.log(`[layers ${width}] items=${count} compared=${compared} overlapping=${JSON.stringify(bad)} overflowingPanel=${overflow} scrollWidth=${sideways.sw}/${sideways.iw}`);

      expect(compared, 'no Chart Layers item was ever on screen together with the button, so nothing was compared').toBeGreaterThan(2);
      expect(bad, `Chart Layers content sits under the Ask AI button at ${width}px`).toEqual([]);
      expect(overflow, `${overflow} Chart Layers item(s) run past the panel's right edge at ${width}px`).toBe(0);
      expect(sideways.sw, `the page scrolls sideways at ${width}px`).toBeLessThanOrEqual(sideways.iw);
    } finally { await ctx.close(); }
  });
}
