/* #2068 / #1630: the post-purchase states on /upgrade, and the hydration seam a82342a1 created.
 *
 * THE HYDRATION CELLS ARE THE NEW PART AND THE REASON THIS FILE EXISTS NOW. a82342a1 replaced
 * `useSearchParams()` with a lazy `useState(() => window.location.search)` so the /upgrade prerender
 * stays static. That is a real fix for #1630 - the params are readable on the FIRST client render, so
 * the redirect guard at `:179` (`isPro && !fromCheckout`) no longer fires before the marker resolves.
 *
 * But it creates a seam nothing checked: the page is prerendered on the server with NO params, so the
 * server HTML is the no-marker variant and the first client render is the marker variant. Two things
 * can go wrong there and neither shows up in a unit test or a build:
 *   H1  React logs a hydration mismatch, because server and client markup differ.
 *   H2  the marker-driven UI FLASHES - rendered, then replaced - which a screenshot taken after
 *       settling cannot see and a human on a slow connection can.
 *
 * H2 is measured with a MutationObserver armed in an init script, BEFORE any page script runs,
 * because by the time a test could call `page.evaluate` the transition is already over. An assertion
 * that the banner "is visible" at the end is compatible with it having flashed twice on the way.
 *
 * THE STATE CELLS: `arrivedFromPurchase` is `?purchase=whop` (:103) and `fromCheckout` is that OR a
 * `?status=` value (:153). S2 is Dev's control and the one that gives the others meaning - a Pro
 * account WITHOUT the marker must still bounce to /arena. Without it, "a Pro account stayed on
 * /upgrade" is satisfied by a page that never redirects anyone.
 *
 * `?purchase=whop` IS URL-KEYED AND DISPLAY-ONLY, so the page has not verified that any payment
 * happened - only that someone arrived at a URL. Every cell therefore asserts the page does not
 * claim a completed payment, and that assertion is the one to keep if any gets dropped. The definite
 * wording is allowed in exactly one place: "You're on Pro" is gated on `isPro`, which comes from the
 * entitlement read rather than the URL (:151).
 */
import { test, expect } from '@playwright/test';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';
import { signedInContext, AUTH_READY, AUTH_SKIP_REASON } from './_auth';

const BASE = process.env.E2E_BASE_URL ?? '';
const MARKER = '?purchase=whop';
const BANNER = '[data-testid="upgrade-return-banner"]';

/* Wording that asserts a completed payment as FACT. Conditional phrasings are fine - the point is
   that the page must not tell someone their money arrived when all it saw was a query string. */
const ASSERTS_PAYMENT = /payment received|thanks for your (payment|purchase)|purchase complete|you (have |'ve )?paid|within a minute/i;

/* React's hydration complaints, across the shapes it uses. The minified error codes are included
   because a production build reports those rather than the prose. */
const HYDRATION_ERROR = /hydrat|did not match|Minified React error #(418|419|422|423|425)/i;

/** Records every add/remove of the marker-driven nodes, from before the first page script runs. */
const armFlashRecorder = (page: import('@playwright/test').Page) => page.addInitScript(() => {
  (window as unknown as { __flash: string[] }).__flash = [];
  const log = (s: string) => (window as unknown as { __flash: string[] }).__flash.push(`${Math.round(performance.now())}ms ${s}`);
  const start = () => {
    const seen = new Set<Element>();
    const scan = () => {
      for (const el of document.querySelectorAll('[data-testid="upgrade-return-banner"]')) {
        if (!seen.has(el)) { seen.add(el); log(`banner ADDED status=${el.getAttribute('data-status')}`); }
      }
      for (const el of [...seen]) if (!el.isConnected) { seen.delete(el); log('banner REMOVED'); }
    };
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
    scan();
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
});

const readFlash = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __flash?: string[] }).__flash ?? []);

test.describe('#2068 /upgrade post-purchase states, and a82342a1\'s hydration seam', () => {
  test.skip(!BASE, 'E2E_BASE_URL required');

  test('H1. signed out with ?status=succeeded: no React hydration error, and the banner does not flash out', async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e.message)));
      await armFlashRecorder(page);

      await page.goto(`${BASE}/upgrade?status=succeeded`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await expect(page.locator(BANNER), 'the return banner never rendered, so this cell cannot see the seam').toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(3000);

      const flash = await readFlash(page);
      const hydration = errors.filter((e) => HYDRATION_ERROR.test(e));

      /* CONTROL: the recorder must have observed the banner arrive. An empty log would make the
         "never removed" assertion below vacuously true. */
      expect(flash.filter((f) => f.includes('ADDED')), `the flash recorder saw no banner at all: ${JSON.stringify(flash)}`).not.toHaveLength(0);
      expect(flash.filter((f) => f.includes('REMOVED')), `the banner was removed after rendering - it flashes. Timeline: ${JSON.stringify(flash)}`).toHaveLength(0);
      expect(hydration, `React reported a hydration mismatch on a URL-driven render: ${JSON.stringify(hydration)}`).toHaveLength(0);

      assertNoUnstubbedPaidAi(page, 'upgrade-purchase-marker');
    } finally { await ctx.close(); }
  });

  for (const width of [390, 1280]) {
    test(`S1. signed out with the marker at ${width}: renders, and claims no completed payment`, async ({ browser }) => {
      test.setTimeout(150_000);
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      try {
        await installPaidAiFence(page);
        await page.goto(`${BASE}/upgrade${MARKER}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.waitForTimeout(3500);
        const main = page.locator('main').first();
        const text = (await main.innerText()).replace(/\s+/g, ' ').trim();

        expect(text.length, 'nothing rendered').toBeGreaterThan(200);
        expect(ASSERTS_PAYMENT.test(text), `the page asserts a completed payment with nothing behind it but a query string (signed out, ${width}). Text: ${text.slice(0, 300)}`).toBe(false);
        /* Sideways scroll measured against the REQUESTED width, not innerWidth - a resize that did
           not take would otherwise compare a number against itself. */
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(await page.evaluate(() => innerWidth), `the viewport is not ${width}, so the overflow number below would be meaningless`).toBe(width);
        expect(sw - width, `sideways scroll of ${sw - width}px at ${width}`).toBeLessThanOrEqual(0);

        assertNoUnstubbedPaidAi(page, 'upgrade-purchase-marker');
      } finally { await ctx.close(); }
    });
  }

  test('S2. CONTROL (Dev\'s): a Pro account WITHOUT the marker still bounces to /arena', async ({ browser }) => {
    test.setTimeout(180_000);
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await page.goto(`${BASE}/upgrade`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      /* The redirect is `router.replace('/arena')` from an effect gated on the entitlement read, so
         it needs the read to settle - poll rather than assume a fixed delay. */
      await expect
        .poll(() => page.evaluate(() => location.pathname), { message: 'a Pro account without the marker was NOT bounced off /upgrade - so "stayed on /upgrade" in S3 proves nothing', timeout: 60_000 })
        .toBe('/arena');
      assertNoUnstubbedPaidAi(page, 'upgrade-purchase-marker');
    } finally { await ctx.close(); }
  });

  test('S3. a Pro account WITH the marker stays on /upgrade and is not left on "Redirecting"', async ({ browser }) => {
    test.setTimeout(180_000);
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await page.goto(`${BASE}/upgrade${MARKER}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.waitForTimeout(6000);
      expect(await page.evaluate(() => location.pathname), 'a Pro account was bounced off /upgrade despite the marker, so the confirmation is unreadable - this is #1630').toBe('/upgrade');
      const text = (await page.locator('main').first().innerText()).replace(/\s+/g, ' ').trim();
      expect(/redirecting/i.test(text), `the page is stuck on a redirect message. Text: ${text.slice(0, 300)}`).toBe(false);
      expect(text.length, 'nothing rendered for a Pro account').toBeGreaterThan(200);
      assertNoUnstubbedPaidAi(page, 'upgrade-purchase-marker');
    } finally { await ctx.close(); }
  });

  test('S4. signed in and NOT Pro (the pending state) with the marker: no claim that a payment completed', async ({ browser }) => {
    test.setTimeout(180_000);
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    /* Fixture b is the signed-in non-Pro account: "paid, entitlement not yet applied" as the page
       sees it. This account has NOT paid, and the marker is URL-keyed, so this is the state anyone
       can reach by typing the param - which is why the claim must not be made here. */
    const ctx = await signedInContext(browser, 'b');
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await page.goto(`${BASE}/upgrade${MARKER}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.waitForTimeout(6000);
      const text = (await page.locator('main').first().innerText()).replace(/\s+/g, ' ').trim();
      expect(text.length, 'nothing rendered').toBeGreaterThan(200);
      expect(ASSERTS_PAYMENT.test(text), `the page tells a signed-in NON-PAYING account that a payment was received. Text: ${text.slice(0, 300)}`).toBe(false);
      assertNoUnstubbedPaidAi(page, 'upgrade-purchase-marker');
    } finally { await ctx.close(); }
  });
});
