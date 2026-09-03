import { test, expect } from '@playwright/test';
import { useEntitledSession } from './_entitled-session';

/* THE ENTITLED BRANCH OF THE MACRO CARDS (#717).
 *
 * `GlobalMacroContext` gates on `entitled` and renders `LockedFeatureCard` to
 * everyone else. #717 compressed the spacing INSIDE the entitled branch, and
 * that branch has never been verified by anyone: QA measured 227px twice,
 * hours apart, read the stability as confirmation, and was looking at the
 * static locked card both times. The measurement was of a different component
 * than the one that changed.
 *
 * Why it is worth a spec rather than one manual look: after #719 ships terminal
 * on landing only, `app/dashboard/page.tsx` is the dashboard every user sees,
 * and both cards render there (`:579`, `:587`). The gated branch is on the
 * highest-traffic screen in the app.
 *
 * THE CONTROL IS THE POINT. `locked-feature` being absent proves an entitled
 * render only if it is PRESENT without the fixture. Asserting one without the
 * other would pass just as happily against a page that failed to load, which is
 * this project's most repeated failure: a check that measures nothing and
 * reports clean.
 */

const DASHBOARD = '/dashboard';

test.describe('macro cards, entitled branch', () => {
  test('CONTROL: signed out, the dashboard shows the Pro gate', async ({ page }) => {
    await page.goto(DASHBOARD);
    /* If this ever reports 0, the fixture below is proving nothing - either the
       marker was renamed (#441 put it on LockedFeatureCard) or the gate stopped
       being applied at the call site, which is #442's whole subject. */
    await expect(page.getByTestId('locked-feature')).not.toHaveCount(0);
  });

  test('as pro: the gate is gone and the real breakdown renders', async ({ page }) => {
    await useEntitledSession(page, { as: 'pro' });
    await page.goto(DASHBOARD);

    await expect(page.getByTestId('locked-feature')).toHaveCount(0);
    /* PerpSpotCard has no entitlement gate of its own, so it renders either
       way - it is here because #717 changed its layout, not its visibility. */
    await expect(page.getByTestId('perp-spot-card')).toBeVisible();
  });

  test('as trial: entitled too - the OTHER half of isPro || isTrial', async ({ page }) => {
    /* A real new signup lands here, not on 'pro': the trigger writes
       role 'free' with a 14-day window. If these two branches ever diverge,
       every trial user sees a paywall they should not, and no pro-only
       fixture would notice. */
    await useEntitledSession(page, { as: 'trial' });
    await page.goto(DASHBOARD);

    await expect(page.getByTestId('locked-feature')).toHaveCount(0);
  });

  test('#717: the verdict pill and the number are one flex row, not two blocks', async ({ page }) => {
    /* The change under test: two stacked blocks, each carrying its own 8px
       marginBottom, became one flex row.
     *
     * THIS ASSERTS THE DOM, NOT THE PIXELS, AND THAT IS DELIBERATE. My first
     * version compared their vertical centres, and it failed once then passed
     * on a re-measure. Not flake in the harness - the rail is 330px wide with
     * `flexWrap: 'wrap'`, and the verdict string is data-driven:
     *
     *     NORMAL           pill  79px  + gap 10 + number 182 = 271  fits
     *     CANNOT MEASURE   pill ~140px + gap 10 + number 182 = 332  wraps
     *
     * So whether the two sit on one visual line depends on what the market is
     * doing when the test runs. A pixel assertion here is a coin flip, and a
     * coin-flip test gets muted rather than fixed.
     *
     * The wrapping is a real limitation of #717 at this width and is filed
     * separately - it is not this spec's job to fail intermittently as a way
     * of remembering it. */
    await useEntitledSession(page);
    await page.goto(DASHBOARD);

    const card = page.getByTestId('perp-spot-card');
    await expect(card).toBeVisible();
    await expect(card.locator('.psc-verdict-pill')).toBeVisible();

    const shape = await card.evaluate((el: HTMLElement) => {
      const pill = el.querySelector('.psc-verdict-pill');
      const row = pill?.parentElement;
      if (!pill || !row) return null;
      return {
        display: getComputedStyle(row).display,
        // The number block must be the pill's SIBLING. Stacked, it was the
        // pill's parent's sibling instead - a different tree, which is what
        // regressing this change would restore.
        numberIsSibling: pill.nextElementSibling !== null,
        rowChildren: row.children.length,
      };
    });

    expect(shape, 'verdict pill or its row did not render').not.toBeNull();
    expect(shape!.display).toBe('flex');
    expect(shape!.numberIsSibling).toBe(true);
    expect(shape!.rowChildren).toBe(2);
  });

  test('#723: the row holds one line at EVERY verdict, not just the short ones', async ({ page }) => {
    /* The deterministic version of the assertion I had to remove.
     *
     * The original compared the pill's and number's vertical centres against
     * whatever verdict the live market produced, so it failed once and passed
     * on a re-measure - the string is data-driven and the long ones wrapped.
     * Waiting for the market to produce `CANNOT MEASURE` is not a test, it is
     * a stakeout.
     *
     * So the verdict is INJECTED. Every one of the four real strings is written
     * into the pill and the row re-measured, which tests the CSS at the
     * boundary that actually matters rather than at whichever point the data
     * happened to be. Nothing about the layout depends on where the string came
     * from. */
    await useEntitledSession(page);
    await page.goto(DASHBOARD);

    const card = page.getByTestId('perp-spot-card');
    await expect(card).toBeVisible();

    const VERDICTS = ['NORMAL', 'SPOT LEADING', 'FUTURES LEADING', 'CANNOT MEASURE'];
    const wrapped: string[] = [];

    for (const verdict of VERDICTS) {
      const sameRow = await card.evaluate((el: HTMLElement, v: string) => {
        const pill = el.querySelector('.psc-verdict-pill') as HTMLElement | null;
        const span = pill?.querySelector('span') as HTMLElement | null;
        const num = pill?.nextElementSibling as HTMLElement | null;
        if (!pill || !span || !num) return null;
        span.textContent = v;
        const p = pill.getBoundingClientRect();
        const n = num.getBoundingClientRect();
        /* Centres within half the taller box = same row. Stacked, they differ
           by roughly a full box height. */
        return Math.abs((p.y + p.height / 2) - (n.y + n.height / 2)) < Math.max(p.height, n.height) / 2;
      }, verdict);

      expect(sameRow, `could not measure the row at "${verdict}"`).not.toBeNull();
      if (!sameRow) wrapped.push(verdict);
    }

    expect(wrapped, 'these verdicts push the number onto a second line - the number block is not shrinking, so check flex/minWidth on it').toEqual([]);
  });
});
