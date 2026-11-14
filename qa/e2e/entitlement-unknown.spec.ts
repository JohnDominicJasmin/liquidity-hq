import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

/* #1119: a failed/exhausted entitlements read must resolve to a distinct
 * 'unknown' state - never a silent downgrade to a confirmed-free assertion,
 * and never a false grant either. Exercised here via #1184's deterministic
 * test hook (`window.__LHQ_QA_FORCE_ENTITLEMENTS_FAIL__`, checked inside
 * AuthProvider's `attempt()`), because the two more obvious approaches don't
 * work on this app:
 *
 *   - A `page.route()`/`window.fetch` override loses the reload race - the
 *     entitlements effect can already be mid-attempt before a test's
 *     override finishes installing (confirmed live during #1180's review,
 *     `document.readyState` was already 'complete' by the time the override
 *     landed).
 *   - Forcing a fresh sign-in to re-trigger the effect hits the login
 *     form's Turnstile widget (`_auth.ts`'s own documented limitation).
 *
 * `page.addInitScript()` on the context beats both: Playwright guarantees it
 * runs before ANY page script, on every navigation including a reload, so
 * the flag is reliably set before AuthProvider's effect ever checks it - no
 * race, no fresh sign-in needed.
 */

const UNKNOWN_CARD = '[data-testid="entitlement-unknown"]';
const LOCKED_CARD   = '[data-testid="locked-feature"]';
/* ConfluenceScore's root - `.sms-card`, not a data-testid. The component has
 * no unconditional testid of its own; `confluence-perp-line` (tried first)
 * only renders under a specific data condition (`!perpCaution && perpLine`
 * in components/ConfluenceScore.tsx) and is absent on plenty of genuinely
 * real, entitled renders - a live run against deployed qa hit exactly that:
 * the card was visibly showing a real verdict ("Neutral Confluence Score")
 * while this locator still reported not-found, which is the test being
 * wrong about the app, not the app being wrong. */
const REAL_CONTENT = '.sms-card';

test.describe('#1119 entitlement retry-exhaustion (#1184 hook)', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);

  test('exhausting all 3 retries lands on EntitlementUnknownCard, not a locked or free-looking state', async ({ browser }) => {
    /* Account A is pinned Pro (_auth.ts) - if the forced failure leaked into
       a real 'entitled' read anywhere, this account is exactly where it
       would be invisible without this test, since it would already be
       expected to see the unlocked Confluence card. */
    const ctx = await signedInContext(browser, 'a');
    await ctx.addInitScript(() => {
      (window as unknown as { __LHQ_QA_FORCE_ENTITLEMENTS_FAIL__?: boolean }).__LHQ_QA_FORCE_ENTITLEMENTS_FAIL__ = true;
    });
    const page = await ctx.newPage();
    await installPaidAiFence(page);   // #1632: refuse any paid AI path this spec has not stubbed
    try {
      await gotoSignedIn(page, '/arena');

      /* 3 attempts, 1s + 2s backoff between them - each forced attempt
         resolves immediately (no real network call), so exhaustion lands at
         roughly the backoff sum (~3s), not the 15s-per-attempt timeout a
         real failure would cost. Timeout here is generous headroom, not the
         expected wait. */
      await expect(page.locator(UNKNOWN_CARD).first(),
        'a Pro account whose entitlements read is forced to fail must see the couldn\'t-verify card, not silently keep/lose access').toBeVisible({ timeout: 15_000 });

      /* CONTROL, in the same test rather than a separate one - the two
         states are mutually exclusive by construction (one ternary chain in
         app/arena/page.tsx), so proving the unknown card renders already
         proves the locked card doesn't. Asserted directly anyway: the two
         card shapes read identically to a casual glance, and this is
         exactly the distinction #1119 exists to protect. */
      await expect(page.locator(LOCKED_CARD),
        'must never show the confirmed-free/upsell card on a merely-unknown read - that is the exact bug #1119 fixed').toHaveCount(0);
      await expect(page.locator(REAL_CONTENT),
        'must never show real Pro content either - the account is not confirmed entitled').toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('clearing the flag and clicking Retry recovers to the real entitled state', async ({ browser }) => {
    const ctx = await signedInContext(browser, 'a');
    await ctx.addInitScript(() => {
      (window as unknown as { __LHQ_QA_FORCE_ENTITLEMENTS_FAIL__?: boolean }).__LHQ_QA_FORCE_ENTITLEMENTS_FAIL__ = true;
    });
    const page = await ctx.newPage();
    await installPaidAiFence(page);   // #1632: refuse any paid AI path this spec has not stubbed
    try {
      await gotoSignedIn(page, '/arena');
      await expect(page.locator(UNKNOWN_CARD).first()).toBeVisible({ timeout: 15_000 });

      /* Clearing the flag alone must not resolve anything on its own -
         retryEntitlements() is what re-runs the fetch effect. Clicking
         BEFORE clearing would just fail again immediately; the order here
         is deliberate and matches what a real user does (flag off = the
         real backend recovering, Retry = the user's own action). */
      await page.evaluate(() => {
        (window as unknown as { __LHQ_QA_FORCE_ENTITLEMENTS_FAIL__?: boolean }).__LHQ_QA_FORCE_ENTITLEMENTS_FAIL__ = false;
      });
      // ENTITLEMENT_UNKNOWN_RETRY_BUTTON resolves to "Try again"
      // (lib/labelDefaults.en.json), not "Retry" - this locator never
      // matched, so .click() hung to the test's own 240s timeout rather
      // than a clean assertion failure. The label is the source of truth;
      // fixed here, not there.
      await page.locator(UNKNOWN_CARD).first().getByRole('button', { name: 'Try again' }).click();

      // PROBE (QA, 2026-11-14): print what the page holds at 3, 8 and 20 s after the click, to tell a stale locator from an app that does not recover.
      for (const wait of [3000, 5000, 12000]) {
        await page.waitForTimeout(wait);
        const st = await page.evaluate(() => ({ unknown: document.querySelectorAll('[data-testid="entitlement-unknown"]').length, locked: document.querySelectorAll('[data-testid="locked-feature"]').length, sms: document.querySelectorAll('.sms-card').length, smsText: Array.from(document.querySelectorAll('.sms-card')).map(e => (e.textContent || '').replace(/\s+/g, ' ').slice(0, 60)), planBadge: (document.body.innerText.match(/\b(PRO|FREE|TRIAL)\b/) || [''])[0], url: location.pathname }));
        console.log(`[ENT] after ${wait} ms: ${JSON.stringify(st)}`);
      }
      await page.screenshot({ path: 'qa/.shots/ent-after-retry.png' });
      await expect(page.locator(REAL_CONTENT),
        'Retry must recover to the real Pro state once the backend answers again').toBeVisible({ timeout: 15_000 });
      /* NO .first() HERE, DELIBERATELY. This asserts the card is GONE, so it has to count every
         match - `.first()` narrows to one element and would pass while a second card remained. The
         sites above use `.first()` because the app renders the card twice and strict mode refuses
         an ambiguous match; counting zero is the one assertion that needs the opposite. */
      await expect(page.locator(UNKNOWN_CARD)).toHaveCount(0);
      await expect(page.locator(LOCKED_CARD)).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
