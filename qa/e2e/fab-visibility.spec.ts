import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';

/* The Ask AI button must become visible, on a FIRST VISIT and after a toggle. (#326, #327)
 *
 * TWO INDEPENDENT WAYS IT DISAPPEARED, and neither was reachable by any spec I
 * had written before today:
 *
 *   1. `body.consent-pending` hides the FAB outright (visibility:hidden). It is
 *      set in the server markup and removed ONLY by a useEffect in
 *      CookieConsent.tsx - so a blocked script, failed hydration or aggressive
 *      browser shields leave it permanently invisible, with no error anywhere.
 *
 *   2. A timer race: the restore was cancelled if `open` changed during the
 *      400ms the FAB was hidden, leaving it at opacity 0 with pointer-events
 *      none until the user happened to trigger it again.
 *
 * WHY MY OWN SUITE MASKED THE FIRST ONE, which is the durable lesson:
 *
 *     localStorage.setItem('lhq_analytics_consent_v1', 'denied')
 *
 * appears at the top of nearly every spec in this directory. It is there for a
 * good reason - an undismissed banner covers the page and inflated the
 * layout.spec obscured count by ~32 - but it makes CookieConsent take the
 * already-decided path, so `consent-pending` clears immediately and the FAB is
 * always visible. `layout.spec.ts` records `.gchat-fab` covering controls on
 * three routes, meaning my suite was OBSERVING THE BUTTON PRESENT on every run
 * while the owner could not see it at all.
 *
 * A fixture that removes noise can remove the defect with it. THIS FILE
 * DELIBERATELY DOES NOT PIN CONSENT.
 */

const FAB = '.gchat-fab';

/** Visible means rendered AND actually clickable - the bug left it at opacity 0. */
async function fabState(page: Page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return { present: false, opacity: '0', visibility: 'hidden', pointer: 'none', pending: false };
    const cs = getComputedStyle(el);
    return {
      present: true,
      opacity: cs.opacity,
      visibility: cs.visibility,
      pointer: cs.pointerEvents,
      pending: document.body.classList.contains('consent-pending'),
    };
  }, FAB);
}

test.describe('Ask AI button visibility', () => {
  test('FIRST VISIT: the FAB becomes usable without touching the consent banner', async ({ browser }) => {
    /* No consent pinning, no localStorage seeding - a genuinely undecided
       first visit, which is the state the owner was in and the state every
       other spec in this directory removes. */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/arena');
      await page.waitForTimeout(12_000);   // past the 3s failsafe with room to spare

      const s = await fabState(page);
      expect(s.present, 'the Ask AI button is not in the DOM at all').toBe(true);
      expect(s.visibility,
        `the FAB is visibility:${s.visibility} on a first visit. body.consent-pending=${s.pending}. ` +
        `That class is removed only by CookieConsent's effect, so this is the state a blocked or ` +
        `delayed script leaves behind - the button is fine and waiting for a signal that never came.`)
        .not.toBe('hidden');
      expect(s.pointer,
        'the FAB renders but cannot be clicked - pointer-events:none').not.toBe('none');
      expect(Number(s.opacity),
        `the FAB is at opacity ${s.opacity} - present, unclickable, and invisible`).toBeGreaterThan(0.1);
    } finally { await ctx.close(); }
  });

  test('CONTROL: the failsafe is not the only thing making it visible', async ({ browser }) => {
    /* The 3s failsafe would mask a broken normal path - the FAB would always
       appear eventually and this file would pass on a build where CookieConsent
       never works. Sampling BEFORE the failsafe fires proves the normal path
       still does its job.

       Not a hard assert: on a slow cold start the normal path can legitimately
       take longer than 2s, and failing there would be a false alarm. It records
       which path won so a regression in the normal one is visible in the log
       rather than hidden behind the net. */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/arena');
      await page.waitForTimeout(2000);     // before the 3s failsafe
      const early = await fabState(page);
      await page.waitForTimeout(10_000);
      const late = await fabState(page);

      // eslint-disable-next-line no-console
      console.log(`[fab] at 2s: visibility=${early.visibility} pending=${early.pending}`
        + `  |  at 12s: visibility=${late.visibility} pending=${late.pending}`
        + `  |  ${early.visibility !== 'hidden' ? 'NORMAL PATH won' : 'FAILSAFE was needed'}`);

      expect(late.visibility, 'the FAB never became visible, even after the failsafe').not.toBe('hidden');
    } finally { await ctx.close(); }
  });

  test('the FAB returns after opening and closing the panel', async ({ browser }) => {
    /* The timer race, independent of consent and reachable on any browser: the
       restore was cancelled if `open` changed during the 400ms hide window,
       stranding the button at opacity 0 with pointer-events none. */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    try {
      await gotoGuarded(page, '/arena');
      await page.waitForTimeout(9000);

      const fab = page.locator(FAB).first();
      await expect(fab, 'no FAB to open - this run measured nothing').toBeVisible({ timeout: 20_000 });

      await fab.click();
      await page.waitForTimeout(300);          // inside the 400ms hide window
      const close = page.locator('.gchat-icon-btn', { hasText: '✕' }).first();
      if (await close.isVisible().catch(() => false)) await close.click();
      else await page.keyboard.press('Escape');

      await page.waitForTimeout(6000);
      const s = await fabState(page);
      expect(Number(s.opacity),
        `the FAB is stranded at opacity ${s.opacity} after a fast open/close - the restore timer ` +
        `was cancelled by the state change and never re-armed`).toBeGreaterThan(0.1);
      expect(s.pointer, 'the FAB is visible but not clickable after a fast open/close').not.toBe('none');
    } finally { await ctx.close(); }
  });
});
