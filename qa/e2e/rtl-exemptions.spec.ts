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

/**
 * Pin USD/JPY so the briefing's yen scale actually renders.
 *
 * `app/briefing/page.tsx:651` gates the whole block on `jpyUsd == null`, so the
 * exempt container does not exist until the macro data arrives. The first run
 * against step 2 reported "no dir=ltr containers on /briefing" - which reads
 * exactly like a missing exemption and was a DATA DEPENDENCY in this spec.
 * The exemption was in the deployed commit the whole time.
 *
 * 150 is a quiet value: below the 158 warning and 160 danger thresholds, so the
 * scale renders in its ordinary state rather than an alert variant.
 */
async function pinMacro(page: Page) {
  await page.route('**/api/macro**', async route => {
    let body: Record<string, unknown> = {};
    try { body = await (await route.fetch()).json(); } catch { /* upstream down */ }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...body, jpy: { value: 150, changePct: 0.1 } }),
    });
  });
}

/**
 * For every exempt axis, where its markers sit WITHIN it - as a fraction of the
 * container's own width.
 *
 * NOT absolute page position. The first version asserted that, and dev caught
 * why it is unsatisfiable: `dir="ltr"` stops a container's CONTENTS mirroring;
 * it does not stop the container moving when the page around it mirrors. And
 * the page moving is the feature.
 *
 *     the page mirrors           correct - that IS RTL working
 *     a card inside it moves     unavoidable consequence
 *     the axis inside the card   holds its orientation   <- the requirement
 *
 * So an assertion that absolute x is unchanged could only pass on a build where
 * RTL does not work. **A test whose success implies the feature is broken.**
 * That is the third wrong requirement on this issue and none of the three were
 * code bugs - see the note at the bottom.
 *
 * A fraction of container width is direction-invariant: a marker 30% along a
 * 140->165 scale is 30% along it in either direction, however the card moved.
 */
async function exempt(page: Page) {
  return page.evaluate(() => {
    const out: Array<{ id: string; frac: number[] }> = [];
    /* EXCLUDE <html>. Step 1's plumbing sets dir on the document root, so a
       bare [dir="ltr"] selector matches the root itself - and flipping
       document.dir makes it stop matching, which reads as "an exempt container
       moved". The first run of this file failed on exactly that: one element
       reported as shifted, and it was <html>. The exemptions are containers
       INSIDE the document, never the document. */
    for (const el of Array.from(document.querySelectorAll('body [dir="ltr"]'))) {
      const box = (el as HTMLElement).getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      /* Every descendant that is positioned - the markers, bars and midlines
         whose place along the axis is the thing that must not flip. */
      const frac: number[] = [];
      for (const kid of Array.from(el.querySelectorAll('*'))) {
        const k = (kid as HTMLElement).getBoundingClientRect();
        if (k.width < 1 || k.height < 1) continue;
        frac.push(Math.round(((k.x - box.x) / box.width) * 1000) / 1000);
      }
      out.push({ id: `${el.tagName}.${(el.className || '').toString().slice(0, 30)}`, frac });
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
      await pinMacro(page);
      await gotoGuarded(page, route);
      await page.waitForTimeout(12_000);

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

      /* Compare WITHIN each container. The container itself is expected to move
         - that is the page mirroring, which is the feature working. */
      const flipped = before.filter((b, i) => {
        const a = after[i];
        if (!a || a.frac.length !== b.frac.length) return true;
        return b.frac.some((f, j) => Math.abs(a.frac[j] - f) > 0.02);
      });

      expect(flipped,
        `${flipped.length} quantitative axis/axes had their contents move under RTL: ` +
        `${flipped.map(m => m.id).join(', ')}. A marker 30% along a 140->165 scale must be 30% ` +
        `along it in either direction - the scale reads low-to-high in Arabic too. The card ` +
        `moving is FINE and expected; the marker moving within it is not.`).toEqual([]);
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
    await pinMacro(page);
    await gotoGuarded(page, '/briefing');
    await page.waitForTimeout(12_000);

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

/* ─────────────────────────────────────────────────────────────────────────────
 * THREE WRONG REQUIREMENTS ON THIS FEATURE, AND NOT ONE WAS A CODE BUG.
 *
 *   1  dev   "each site needs 100 - x as well as a property change"
 *            -> wrong: these are quantitative axes and must not mirror at all
 *
 *   2  QA    "assert the marker is at the MIRRORED position"
 *            -> would have PINNED the bug. A 140->165 scale reversed.
 *
 *   3  QA    "assert absolute page-x is unchanged"
 *            -> could only pass on a build where RTL does not work. A test
 *               whose SUCCESS implies the feature is broken.
 *
 * Each was caught by the other session reading the requirement, never by a
 * failing test - because each would have produced a PASSING test enforcing
 * wrong behaviour.
 *
 * Writing the invariant before the implementation stops it being shaped by the
 * code. It does nothing to stop it being wrong about the requirement, and this
 * file is the third worked example in two days. The check that works is the
 * other session reading what you asserted and asking what it would mean if it
 * passed.
 * ───────────────────────────────────────────────────────────────────────────── */
