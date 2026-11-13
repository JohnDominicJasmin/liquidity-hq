/* #1173 box 2 (fix #2154): a signed-in load of / goes straight to Arena with no landing paint.
 * Fixture A, signed in by session injection. An init script on a fresh page watches the DOM from the first
 * node and records whether the landing hero heading (.lp-hero-h1) ever exists; the final URL must be /arena.
 * F0 is the positive control: the same observer on a signed-OUT page must see the hero, or a silent observer proves nothing. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext } from './_auth';
import { gotoGuarded } from './_shared';

const OBSERVER = () => {
  const w = window as unknown as { __heroSeen: boolean; __heroAt: number };
  w.__heroSeen = false; w.__heroAt = 0;
  const t0 = performance.now();
  const check = () => { if (!w.__heroSeen && document.querySelector('.lp-hero-h1')) { w.__heroSeen = true; w.__heroAt = Math.round(performance.now() - t0); } };
  new MutationObserver(check).observe(document, { childList: true, subtree: true });
  check();
};
const read = (page: Page) => page.evaluate(() => { const w = window as unknown as { __heroSeen: boolean; __heroAt: number }; return { seen: w.__heroSeen, at: w.__heroAt, url: location.pathname }; });

test.describe('#1173 no landing flash for a signed-in load', () => {
  test.describe.configure({ timeout: 150_000 });

  test('F0. control: the observer sees the hero for a signed-out visitor', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(OBSERVER); const page = await ctx.newPage();
    try { await gotoGuarded(page, '/'); await page.waitForTimeout(6_000); const r = await read(page); console.log('[F0] ' + JSON.stringify(r)); expect(r.seen, 'the observer never saw the hero on the landing page, so a silent result below proves nothing').toBe(true); } finally { await ctx.close(); }
  });

  for (const path of ['/', '/ko']) {
    test(`F1. fixture A loading ${path} reaches Arena and never paints the hero`, async ({ browser }) => {
      test.skip(!AUTH_READY, AUTH_SKIP_REASON);
      const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } });
      await ctx.addInitScript(OBSERVER); const page = await ctx.newPage();
      try {
        await gotoGuarded(page, path); await page.waitForTimeout(12_000);
        const r = await read(page); console.log(`[F1] ${path} ${JSON.stringify(r)}`);
        expect(r.url, 'did not end on /arena: ' + r.url).toMatch(/\/arena/);
        expect(r.seen, `the landing hero was painted ${r.at} ms after navigation start`).toBe(false);
      } finally { await ctx.close(); }
    });
  }
});
