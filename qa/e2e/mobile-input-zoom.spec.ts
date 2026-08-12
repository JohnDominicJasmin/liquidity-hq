import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';

/* Every text input must be >= 16px at mobile width. (#326)
 *
 * Mobile browsers auto-zoom when focusing an input whose COMPUTED font-size is
 * under 16px, and nothing resets that zoom on navigation - so one sub-16px
 * field on a login page leaves the whole app zoomed afterwards.
 *
 * `app/globals.css:196` already guards this:
 *
 *     @media (max-width: 640px), (hover: none) and (pointer: coarse) {
 *       input, select, textarea { font-size: 16px !important; }
 *     }
 *
 * WHY THIS SPEC EXISTS ANYWAY, and it is the whole point: BOTH dev and QA
 * independently "found" this bug within the same hour, both reasoning from the
 * `--fs-label: 0.8125rem` token to 13px, and both proposing a fix that was
 * already implemented. Dev had written theirs. Nothing measured the computed
 * value, so nothing contradicted us.
 *
 * A rule protected only by a comment is protected by whoever last read it. This
 * asserts the computed value on the rendered page, where the token, the media
 * query and the cascade have all already been applied.
 */

const AUTH_ROUTES = ['/login', '/forgot-password'] as const;

async function inputs(page: Page) {
  return page.evaluate(() => {
    const out: Array<{ id: string; px: number; type: string }> = [];
    for (const el of Array.from(document.querySelectorAll('input, textarea, select'))) {
      const e = el as HTMLInputElement;
      if (e.type === 'hidden') continue;
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;          // not rendered
      if (!(e as Element & { checkVisibility?: () => boolean }).checkVisibility?.()) continue;
      out.push({
        id: (e.getAttribute('data-testid') || e.className || e.tagName).toString().slice(0, 40),
        px: parseFloat(getComputedStyle(e).fontSize),
        type: e.type,
      });
    }
    return out;
  });
}

test.describe('mobile input zoom', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
  });

  for (const route of AUTH_ROUTES) {
    test(`${route}: every visible input is >= 16px`, async ({ page }) => {
      test.skip(test.info().project.name !== 'mobile', 'the 16px rule is viewport-conditional');

      await gotoGuarded(page, route);
      await page.waitForTimeout(6000);
      const found = await inputs(page);

      /* CONTROL. "No input is under 16px" is satisfied perfectly by a page with
         no inputs - the empty-result trap. An auth page that rendered nothing
         would pass silently, which is exactly the shape this file exists to
         stop. */
      expect(found.length,
        `no visible inputs found on ${route} - the page did not render its form, so the ` +
        `assertion below would pass without measuring anything`).toBeGreaterThan(0);

      const small = found.filter(f => f.px < 16);
      expect(small,
        `${route} has inputs under 16px: ${small.map(s => `${s.id}=${s.px}px`).join(', ')}. ` +
        `Focusing one auto-zooms the mobile viewport, and nothing resets that zoom on ` +
        `navigation - the user lands on the next page still zoomed. globals.css:196 is the ` +
        `rule that should prevent this.`).toEqual([]);
    });
  }

  test('CONTROL: the desktop project is NOT held to 16px', async ({ page }) => {
    /* The rule is deliberately viewport-conditional - 13px inputs are correct on
       desktop, where no auto-zoom exists. Without this, someone "fixing" the
       spec by applying 16px everywhere would pass the tests above and make the
       desktop UI worse for no reason. */
    test.skip(test.info().project.name !== 'desktop', 'this control is the desktop half');

    await gotoGuarded(page, '/login');
    await page.waitForTimeout(6000);
    const found = await inputs(page);
    expect(found.length, 'no visible inputs on /login at desktop width').toBeGreaterThan(0);
    // Deliberately no size assertion - desktop sizing is a design choice, not a
    // correctness one. This test exists to record that, and to fail loudly if
    // the page stops rendering inputs at all.
  });
});
