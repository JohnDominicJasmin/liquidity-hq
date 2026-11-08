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

/* ASSERTED POSITIVELY, AFTER A BLACKLIST GOT THIS WRONG ON THE FIRST RUN.
 *
 * My first version matched a list of payment-asserting phrasings, including `you (have |'ve )?paid`.
 * That fires on UPGRADE_PURCHASE_SIGNED_OUT - "sign in with the email YOU PAID WITH to use Pro" -
 * which asserts nothing and is the correct copy. It reported right copy as a defect at both widths.
 * I have made this exact mistake before, on this exact string.
 *
 * So the invariant is stated the other way round, and it is sharper: there is exactly ONE definite
 * claim on this page - "You're on Pro", gated on the verified entitlement rather than the URL
 * (page.tsx:151) - and it must appear ONLY for a Pro account. Each state asserts its own label is
 * present and that the Pro claim is absent. A blacklist guesses at wordings; this reads the label
 * the page is supposed to show. */
const SAYS_ON_PRO = /you'?re on pro/i;
const SIGNED_OUT_COPY = /if you'?ve just completed a purchase, sign in with the email/i;
const PENDING_COPY = /if you'?ve just completed a purchase, pro usually activates/i;

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

  /* H1 IS EXPECTED TO FAIL, against the second open defect this file found - #1630's comment of
   * 2026-11-08. a82342a1 keeps the /upgrade prerender static, so the server HTML has no banner and
   * the first client render does: React reports a TEXT hydration mismatch, `Minified React error
   * #418` (`args[]=text`). Scoped by two controls - bare `/upgrade` and `/arena` both produce zero -
   * and it needs no sign-in, so any visitor following a return URL hits it.
   *
   * The FLASH half of this cell passes: the banner is added once and never removed. So the defect is
   * the mismatch itself rather than visible flicker, which is worth separating - a mismatch makes
   * React discard and re-render that subtree, which is a correctness and a performance cost rather
   * than something a user necessarily sees.
   *
   * test.fail() for the same reason as S3: a standing red trains people to skim, and this goes RED
   * the moment it is fixed, which is the prompt to delete the annotation. */
  test('H1. signed out with a return status: no React hydration error, and the banner does not flash out', async ({ browser }) => {
    test.setTimeout(150_000);
    test.fail(true, 'open defect: URL-driven render on a static prerender gives React #418 - see #1630 (2026-11-08)');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e.message)));
      await armFlashRecorder(page);

      /* `canceled` RATHER THAN `succeeded`, and that is not arbitrary. `returnStatus` nulls a
         `succeeded` that has no `payment=pay_...` id (page.tsx:138) - good design, and it means
         `?status=succeeded` alone renders NO banner, which is why my first version of this cell
         failed with "the banner never rendered". `canceled` needs no payment id, so it exercises the
         same URL-driven render without me fabricating a payment reference. */
      await page.goto(`${BASE}/upgrade?status=canceled`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
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
        expect(SIGNED_OUT_COPY.test(text), `the signed-out purchase copy is missing, so the cell below cannot mean anything (${width}). Text: ${text.slice(0, 300)}`).toBe(true);
        expect(SAYS_ON_PRO.test(text), `the page claims "You're on Pro" to a SIGNED-OUT visitor on the strength of a query string (${width})`).toBe(false);
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

  /* EXPECTED TO FAIL, AGAINST AN OPEN DEFECT THIS CELL FOUND - see #1630's comment of 2026-11-08.
   *
   * `page.tsx:449` returns a full-page "Redirecting…" gated on `isPro` ALONE, never checking
   * `fromCheckout`, while the redirect effect at `:179` deliberately does NOT fire when the marker is
   * present. So the page shows a placeholder for a redirect that never happens. Measured on qa
   * `76064af` over 24 seconds: path stays /upgrade, "Redirecting…" persists, "You're on Pro" never
   * appears. The no-marker control (S2) redirects correctly, so this is stuck rather than slow.
   *
   * `test.fail()` rather than a plain failing cell, deliberately. A standing red teaches everyone to
   * skim the failure list - I spent today removing three of those from terminal-default. This states
   * the defect as the current expectation and goes RED THE MOMENT IT IS FIXED, which is the prompt to
   * delete this annotation. It is not a way of ignoring it: #1630 carries the finding. */
  test('S3. a Pro account WITH the marker sees the confirmation, not a redirect placeholder', async ({ browser }) => {
    test.setTimeout(180_000);
    test.skip(!AUTH_READY, AUTH_SKIP_REASON);
    test.fail(true, 'open defect: /upgrade:449 gates the full-page "Redirecting…" on isPro alone - see #1630 (2026-11-08)');
    const ctx = await signedInContext(browser, 'a');
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await page.goto(`${BASE}/upgrade${MARKER}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.waitForTimeout(8000);

      /* This half already PASSES and is the part #2073 fixed - keep it, because if the redirect ever
         comes back the message below would blame the wrong thing. */
      expect(await page.evaluate(() => location.pathname), 'a Pro account was bounced off /upgrade despite the marker - #2073 regressed').toBe('/upgrade');

      const text = (await page.locator('main').first().innerText()).replace(/\s+/g, ' ').trim();
      expect(/redirecting/i.test(text), `stuck on a redirect placeholder for a redirect that never fires (page.tsx:449). Text: ${text.slice(0, 200)}`).toBe(false);
      /* The one definite claim the page is allowed to make, and the buyer's whole reason for being
         here. Unreachable today. */
      expect(SAYS_ON_PRO.test(text), `the Pro confirmation is not shown to a Pro account returning from checkout. Text: ${text.slice(0, 200)}`).toBe(true);

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
      expect(PENDING_COPY.test(text), `the pending purchase copy is missing, so the Pro-claim check below cannot mean anything. Text: ${text.slice(0, 300)}`).toBe(true);
      expect(SAYS_ON_PRO.test(text), 'the page claims "You\'re on Pro" to a signed-in account that is NOT Pro - the marker is URL-keyed, so anyone can reach this').toBe(false);
      assertNoUnstubbedPaidAi(page, 'upgrade-purchase-marker');
    } finally { await ctx.close(); }
  });
});
