import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';

/* Quantitative axes must NOT mirror under RTL. (#353)
 *
 * WRITTEN BEFORE STEP 2 LANDS, and the requirement it encodes is the CORRECTED
 * one. My first understanding was wrong in a way that would have pinned a bug:
 * I was going to assert these ten sites move to the MIRRORED position. Dev
 * opened the first one and stopped -
 *
 *     briefing          JPY rate scale, 140 at one end and 165 at the other
 *     hours             session bars on a TIME axis
 *     VolatilityRegime  a percentile, 0-100
 *     CycleDayCounter   a ratio through a window
 *     MagicBento        ripple origin from POINTER coordinates
 *
 * Numbers and time do not mirror. An Arabic reader reads the surrounding text
 * right-to-left and still reads a 140->165 scale left-to-right; value axes,
 * charts and progress bars conventionally stay LTR. And a pointer coordinate
 * has no reading direction at all - mirroring it puts the ripple on the
 * opposite side of the screen from the tap.
 *
 * So step 2 is an EXEMPTION, not a conversion: `dir="ltr"` on the container so
 * it is immune to the document direction, rather than accidentally surviving
 * it.
 *
 * THE ASSERTION IS THEREFORE **SAME POSITION**, NOT MIRRORED - and the fact
 * that I nearly wrote the opposite is why this file says so at length. A test
 * written before the feature has never run against a build where the property
 * holds, so it can encode a wrong requirement just as easily as a right one.
 *
 * WHY IT ALSO CHECKS FOR THE ATTRIBUTE. Holding a position physical BY ACCIDENT
 * and ON PURPOSE look identical from geometry alone - until someone refactors
 * and the accident stops. `dir="ltr"` present is the durable half.
 */

const ROUTES = ['/briefing', '/hours', '/arena'] as const;

/** Every element carrying an explicit dir="ltr", with its box. */
async function exempt(page: Page) {
  return page.evaluate(() => {
    const out: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    /* EXCLUDE <html>. Step 1's plumbing sets dir on the document root, so a
       bare [dir="ltr"] selector matches the root itself - and flipping
       document.dir makes it stop matching, which reads as "an exempt container
       moved". The first run of this file failed on exactly that: one element
       reported as shifted, and it was <html>. The exemptions are containers
       INSIDE the document, never the document. */
    for (const el of Array.from(document.querySelectorAll('body [dir="ltr"]'))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      out.push({
        id: `${el.tagName}.${(el.className || '').toString().slice(0, 30)}`,
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
    return out;
  });
}

const setDir = (page: Page, dir: 'ltr' | 'rtl') =>
  page.evaluate(d => { document.documentElement.dir = d; }, dir);

test.describe('quantitative axes are exempt from RTL mirroring', () => {
  for (const route of ROUTES) {
    test(`${route}: dir="ltr" containers hold the same position under rtl`, async ({ page }) => {
      await page.addInitScript(() => {
        try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
      });
      await gotoGuarded(page, route);
      await page.waitForTimeout(9000);

      await setDir(page, 'ltr');
      await page.waitForTimeout(1200);
      const before = await exempt(page);

      /* POSITIVE CONTROL. Before step 2 there are no exemptions, so "nothing
         moved" is satisfied by nothing existing - the empty-result trap that
         has produced meaningless green results repeatedly on this project. */
      expect(before.length,
        `no dir="ltr" containers on ${route}. Either step 2 has not landed yet - in which ` +
        `case this failure is EXPECTED and not a defect - or the exemptions were applied ` +
        `somewhere this route does not render.`).toBeGreaterThan(0);

      await setDir(page, 'rtl');
      await page.waitForTimeout(1200);
      const after = await exempt(page);

      const moved = before.filter((b, i) => {
        const a = after[i];
        return !a || Math.abs(a.x - b.x) > 2 || Math.abs(a.w - b.w) > 2;
      });

      expect(moved,
        `${moved.length} quantitative container(s) shifted when the document went RTL: ` +
        `${moved.map(m => m.id).join(', ')}. These are value and time axes - a 140->165 scale ` +
        `reads left-to-right in Arabic too, and a pointer coordinate has no reading direction ` +
        `at all. They must hold their PHYSICAL position, which is what dir="ltr" on the ` +
        `container is for.`).toEqual([]);
    });
  }

  test('CONTROL: ordinary text DOES flip, so the document direction is really changing', async ({ page }) => {
    /* Without this, every assertion above passes on a build where setting
       document.dir does nothing at all - the exemptions would be "working"
       because RTL was never applied. This proves the mechanism is live before
       the exemptions are credited with resisting it. */
    await page.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    await gotoGuarded(page, '/briefing');
    await page.waitForTimeout(9000);

    const probe = async () => page.evaluate(() => {
      const el = document.querySelector('h1, h2, p');
      if (!el) return null;
      return { dir: getComputedStyle(el).direction, x: Math.round(el.getBoundingClientRect().x) };
    });

    await setDir(page, 'ltr');
    await page.waitForTimeout(1200);
    const ltr = await probe();

    await setDir(page, 'rtl');
    await page.waitForTimeout(1200);
    const rtl = await probe();

    expect(ltr, 'no text element found to probe - control measured nothing').not.toBeNull();
    expect(rtl!.dir,
      `setting document.dir did not change computed direction on ordinary text (still ` +
      `${rtl!.dir}). RTL is not being applied at all, so nothing above proves the exemptions ` +
      `resist it.`).toBe('rtl');
  });
});
