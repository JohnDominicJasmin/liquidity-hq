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

  test('the FAB survives the panel opening mid-scroll', async ({ page }) => {
    /* THE TIMER RACE. The first version of this test asserted the wrong thing in
       the wrong place and passed on the broken build - see the note at the
       bottom of this file. The mechanism, from GrokChat.tsx:
     *
     *     const mq = window.matchMedia('(max-width: 639px)');    // MOBILE ONLY
     *     const onScroll = () => {
     *       if (!mq.matches || openRef.current) return;          // and only while CLOSED
     *       setFabVisible(false);
     *       scrollTimer.current = setTimeout(() => setFabVisible(true), 400);
     *     };
     *
     * SCROLLING starts the 400ms window, not clicking. Pre-fix the effect
     * depended on [open] and its cleanup cleared that timer, so `open` flipping
     * inside the window cancelled the restore and left fabVisible false - until
     * the user happened to scroll again.
     *
     * `open` flips without the user touching the FAB because Arena opens the
     * panel programmatically via the `grok-chat` event. That is dev's own
     * account of how it happens in the wild, so it is what this fires. */
    test.skip(test.info().project.name !== 'mobile',
      'the scroll-hide effect is guarded by max-width:639px - there is no race to lose on desktop');

    await page.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    await gotoGuarded(page, '/arena');
    await page.waitForTimeout(9000);

    const before = await fabState(page);
    expect(before.present, 'no FAB on the page - this run measured nothing').toBe(true);
    expect(Number(before.opacity),
      'the FAB was already hidden before the scroll - nothing to race').toBeGreaterThan(0.1);

    /* Panel closed, so the scroll handler engages and arms the 400ms timer. */
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(120);            // inside the 400ms window

    /* Flip `open` while the restore is still pending. */
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('grok-chat', { detail: { coin: 'bitcoin' } }));
    });
    await page.waitForTimeout(400);

    /* Close it again and give the restore far longer than it needs. */
    await page.keyboard.press('Escape');
    const closeBtn = page.locator('.gchat-icon-btn').filter({ hasText: '✕' }).first();
    if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click();
    await page.waitForTimeout(3000);

    const after = await fabState(page);
    expect(Number(after.opacity),
      `the FAB is stranded at opacity ${after.opacity}. The panel opened during the 400ms ` +
      `scroll-hide window, the restore timer was cancelled with it, and nothing re-armed it - ` +
      `the button stays gone until the user scrolls again, which is exactly what "the FAB is ` +
      `missing" looks like from the outside.`).toBeGreaterThan(0.1);
    expect(after.pointer,
      'the FAB is visible but unclickable after the panel opened mid-scroll').not.toBe('none');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE FIRST VERSION OF THIS FILE GOT WRONG - kept because the mistake is
 * more instructive than the test.
 *
 * The race test originally ran on the DESKTOP project and triggered the window
 * by CLICKING the FAB. Both are wrong: the effect is guarded by
 * `max-width: 639px`, and the window opens on SCROLL. So it exercised nothing,
 * and it passed on qa @ d34377d - a build that did NOT contain the fix.
 *
 * It was reported as "verified on qa @ d34377d, which carries #327". The branch
 * carried the fix; the RUNNING SERVICE was still serving the older commit. The
 * check was `git show origin/qa:...` when it should have been the deployed
 * build. CONTRIBUTING.md says exactly this - `/api/version` reports what the
 * service is serving, quote it rather than the branch - and quoting the commit
 * while trusting git for its contents is the same error one step removed.
 *
 * A test that passes on the broken build and the fixed build measures neither.
 * Confirmed by measurement, not argument: 3/3 green on d34377d (no fix) and
 * 3/3 green on 6a03e58 (fix). The only way to know a regression test works is
 * to watch it fail.
 * ───────────────────────────────────────────────────────────────────────────── */
