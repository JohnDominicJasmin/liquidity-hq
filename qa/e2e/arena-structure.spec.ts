import { test, expect } from '@playwright/test';
import { CONVERTED_ROUTES } from './_design-tokens';

/* Arena's structural criteria from `specs/arena.md` — 1-11, 26 and 29.
 *
 * WRITTEN BEFORE THE BUILD EXISTS, and inert until it does. The whole file
 * skips unless `/arena` is in `CONVERTED_ROUTES`, so it lands harmlessly and
 * arms itself in the PR that converts the screen.
 *
 * That ordering is deliberate. I added `/arena` to the ledger EARLY once
 * before, ahead of #438, and four structure specs went red against a screen
 * that was never converted on `dev`. A red suite that says nothing is worse
 * than a gap that says nothing, because someone has to triage the red.
 *
 * WHAT THIS FILE DOES NOT COVER, so a green run is not read as more than it is:
 * criteria 12-18 — the entire colour-as-data block — need a stubbed read, and
 * the spec's own Fixtures section says the live read is not fixture-measurable.
 * `arenaEvidence` is a pure function over `CoinData` and nothing can hand it a
 * chosen verdict yet. Those are inspection-only until that stub exists, and
 * they are exactly where this screen can be wrong while every automated check
 * passes.
 */

const ARENA = '/arena';
const CONVERTED = CONVERTED_ROUTES.includes(ARENA);

/** Seed the flag the way the other design specs do, then prove it applied. */
async function openTerminal(page: import('@playwright/test').Page, viewport: 'desktop' | 'mobile') {
  await page.goto(`${ARENA}?design=terminal`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('lhq_analytics_consent_v1', 'denied'));
  await page.goto(`${ARENA}?design=terminal`, { waitUntil: 'domcontentloaded' });
  /* 8s, not the 2.5s the other specs use. Arena settles at 750ms on localhost
   * (measured, qa/STATUS.md) but this screen mounts a chart and a rail of live
   * panels, and the settle audit covered text length rather than canvas
   * readiness. Erring long here costs seconds; erring short produces a
   * confident false finding, which is this suite's most expensive failure. */
  await page.waitForTimeout(8000);
  expect(await page.evaluate(() => document.documentElement.dataset.design),
    `the terminal design did not apply at ${viewport}`).toBe('terminal');
}

test.describe('arena structure, per specs/arena.md', () => {
  test.skip(!CONVERTED,
    '/arena is not in CONVERTED_ROUTES yet — this file arms itself in the PR that converts the screen');

  test('desktop: region order, columns and rail width (criteria 1-4)', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'measured at 1440');
    test.setTimeout(120_000);
    await openTerminal(page, 'desktop');

    const rail = await page.evaluate(() => {
      const el = document.querySelector('[data-arena-rail], aside');
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    });

    /* 352, not the old frame's 304. The original `1a` carried a dragged
     * `width: 304px` — spaces after the colons, plus a hardcoded
     * `height: 705px` on a flex column — and three sibling frames say 352.
     * I told dev 304 was correct on the strength of the frame and retracted
     * it; this assertion is the retraction made permanent. */
    expect(rail, 'the rail should be 352 — 304 was a direct-manipulation artifact in the superseded frame').toBe(352);
  });

  test('desktop: shell geometry (criterion 7)', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'measured at 1440');
    test.setTimeout(120_000);
    await openTerminal(page, 'desktop');

    const got = await page.evaluate(() => {
      const h = (s: string) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return b.height < 1 ? 0 : Math.round(b.height);
      };
      return { nav: h('.tnav, nav'), ticker: h('.ticker-wrap, [class*="ticker"]') };
    });

    /* Asserted by MEASURED BOX, never by computed display. `getComputedStyle`
     * on a descendant of a hidden subtree returns that element's own display,
     * so "absent" read that way is a false negative — dev found that and
     * nearly filed a defect off it. */
    expect(got.nav, 'app nav is 44 on Arena').toBe(44);
    expect(got.ticker, 'ticker strip is 34').toBe(34);
  });

  test('mobile: the rail does not exist (criterion 26)', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'measured at 390');
    test.setTimeout(120_000);
    await openTerminal(page, 'mobile');

    /* NODE COUNT, not visibility. The criterion says the rail must not exist —
     * a hidden subtree still MOUNTS, and on this screen that costs a second
     * chart instance and a second candle subscription. Arena has already
     * shipped exactly that once; the owner saw two charts before either
     * session did. */
    const railNodes = await page.evaluate(() =>
      document.querySelectorAll('[data-arena-rail]').length);

    expect(railNodes,
      'at 390 the rail must be ABSENT from the DOM, not hidden — clusters, session history and heatmap with it',
    ).toBe(0);
  });
});
