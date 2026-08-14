import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { CONVERTED_ROUTES, UNCONVERTED_CHROME } from './_design-tokens';
import { DESIGN_STORAGE_KEY } from '@/lib/designMode';

/* Does the converted screen have the design's STRUCTURE, or just its colours?
 *
 * THIS FILE EXISTS BECAUSE THE OWNER HAD TO SAY IT OUT LOUD:
 *
 *     "hey take note we are not just changing color, i want the same design on
 *      the files i gave you"
 *
 * They were right, and my tooling was reinforcing the misconception.
 * `design-tokens.spec.ts` reads `color`, `background-color`, borders, `fill`
 * and `stroke` — nothing else. So a green conformance run means **no off-palette
 * colour**, and says nothing whatever about layout, type scale, spacing or
 * component structure.
 *
 * `/disclaimer` passed that sweep and I reported it as "the loop working". True
 * about the loop. Silent about whether the screen looked like the frame.
 *
 * WHAT MAKES THIS ASSERTABLE. The handoff README is full of measured values
 * rather than adjectives — 44px nav, 34px ticker, 33px rows, 268px rail, 40px
 * cells, 34px title. Those are checkable against a rendered page exactly like a
 * colour is, and they are the difference between a restyle and a rebuild.
 *
 * THE RADIUS RULE IS THE CHEAPEST AND SHARPEST. The handoff says:
 *
 *     "Radius is 0 EVERYWHERE in this direction. Not a token - an absence.
 *      The current app uses border-radius extensively, so opting a screen in
 *      means removing radii, not overriding them."
 *
 * The current app rounds nearly everything. So one assertion — no radius on a
 * converted screen — catches "recoloured but not rebuilt" on any screen, without
 * needing a per-screen expectation for it.
 */

/* ── SHELLS FIRST, THEN SCREENS ──────────────────────────────────────────────
 *
 * THE DESIGN HAS TWO CHROMES AND MY FIRST VERSION COULD NOT EXPRESS THAT.
 *
 * README:167, one sentence, stating four values:
 *
 *     "Shared static shell: 56px marketing nav, 264px page index rail (active
 *      item has a 2px amber left border), content column, right rail."
 *
 * **Neither dev nor I read it.** Dev built `/disclaimer` from the per-screen
 * prose; I transcribed the per-screen values into a per-route table. The shell
 * is described in a different paragraph — under the Static FILE's section — and
 * we both indexed on the screen name.
 *
 * The consequence was a real miss: `/disclaimer` renders the app's 44px nav
 * because it sits inside `AppShell`, and it should carry the 56px marketing bar
 * along with six other static screens. **A per-route table cannot say "these
 * seven share a chrome", so it could not have caught it.**
 *
 * "The README does not say" was wrong twice on 2026-08-14 — once about this nav,
 * once by me about mobile values. The handoff is organised shell-first for about
 * a third of its content and we were both reading it screen-first.
 */

/** Routes that render inside the static/marketing shell (README:167). */
const STATIC_SHELL_ROUTES = [
  '/disclaimer', '/about', '/faq', '/learn', '/terms', '/privacy', '/refund',
];

/** Values that apply to a whole shell, not to one screen. */
const SHELL = {
  static: { nav: 56, indexRail: 264, activeBorder: 2, note: 'README:167' },
  app:    { nav: 44, ticker: 34,     note: 'README:78, README:81' },
};

/** Measured values from the handoff README, per route. */
const STRUCTURE: Record<string, { title?: number; rail?: number; note: string }> = {
  '/disclaimer': {
    title: 34,
    rail: 264,
    note: 'README:172 numbered sections with a contents rail; grid 264px + content, 34px title',
  },
};

async function seedTerminal(page: Page) {
  await page.addInitScript((k) => {
    try { localStorage.setItem(k, 'terminal'); } catch { /* private mode */ }
  }, DESIGN_STORAGE_KEY);
  await page.addInitScript(() => {
    try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
  });
}

/** Elements inside `main` that still carry a border radius. */
async function roundedElements(page: Page): Promise<string[]> {
  return page.evaluate((chrome) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('main *')) {
      if (!(el as HTMLElement).checkVisibility?.()) continue;
      /* Unconverted global components keep their radii until they convert —
       * same list, same rule, same removal trigger as the colour sweep. */
      if (chrome.some(sel => el.closest(sel))) continue;
      const r = getComputedStyle(el).borderRadius;
      if (!r || r === '0px') continue;
      const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/)[0];
      out.push(`${r}  ${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`);
    }
    return [...new Set(out)].sort();
  }, [...UNCONVERTED_CHROME, '.tnav']);
}

test.describe('design structure', () => {
  /* THE SELF-TEST, AND IT RUNS FIRST.
   *
   * Both assertions below are "found nothing" / "matches". A detector that
   * never looked returns the same. Two specs in this suite turned out on
   * 2026-08-14 to have never asserted anything at all, so every new one gets a
   * positive control before it is trusted. */
  test('the radius detector actually detects', async ({ page }) => {
    await seedTerminal(page);
    await gotoGuarded(page, '/disclaimer?design=terminal');
    await page.waitForTimeout(2500);

    const before = await roundedElements(page);

    await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.cssText = 'width:20px;height:20px;border-radius:9px';
      el.className = 'radius-bait';
      document.querySelector('main')?.appendChild(el);
    });

    const after = await roundedElements(page);
    expect(after.some(f => f.includes('radius-bait')),
      'a rounded element was injected into main and the detector did not report it. ' +
      'Every other assertion here is "found nothing", so a broken detector passes silently.')
      .toBe(true);
    expect(after.length, 'injecting one rounded element changed the count by more than one')
      .toBe(before.length + 1);
  });

  /* SHELL BEFORE SCREEN. A converted screen inside the wrong chrome is wrong
   * no matter how well its own content matches the frame — and it is the error
   * a per-route table structurally cannot report. */
  for (const route of CONVERTED_ROUTES) {
    const isStatic = STATIC_SHELL_ROUTES.includes(route);
    const shell = isStatic ? SHELL.static : SHELL.app;

    test(`${route} renders inside the ${isStatic ? 'static' : 'app'} shell`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop',
        'shell heights are the 1440x900 values; mobile frames have their own');

      await seedTerminal(page);
      await gotoGuarded(page, `${route}?design=terminal`);
      await page.waitForTimeout(3000);

      const got = await page.evaluate(() => {
        const nav = document.querySelector('.tnav, header nav, nav');
        return { nav: nav ? Math.round(nav.getBoundingClientRect().height) : null };
      });

      expect(got.nav,
        `${route} has a ${got.nav}px nav; the ${isStatic ? 'static' : 'app'} shell is ` +
        `${shell.nav}px (${shell.note}). ` +
        (isStatic
          ? 'The seven static routes should carry the MARKETING bar, not the app bar they ' +
            'inherit from AppShell. A screen whose own content matches the frame is still ' +
            'wrong inside the wrong chrome.'
          : 'App screens carry the 44px bar.'))
        .toBe(shell.nav);
    });

    test(`${route} has no border radius`, async ({ page }) => {
      await seedTerminal(page);
      await gotoGuarded(page, `${route}?design=terminal`);
      await page.waitForTimeout(3000);

      const mode = await page.evaluate(() => document.documentElement.dataset.design ?? null);
      expect(mode, `${route} did not render in terminal mode; nothing below is measurable`)
        .toBe('terminal');

      expect(await roundedElements(page),
        `Elements on ${route} still carry a border radius. The handoff is explicit: ` +
        `"Radius is 0 EVERYWHERE in this direction. Not a token - an absence." ` +
        `Rounded corners on a converted screen mean it was restyled rather than rebuilt.`)
        .toEqual([]);
    });

    const spec = STRUCTURE[route];
    if (!spec) continue;

    test(`${route} matches the handoff's measured structure`, async ({ page }, testInfo) => {
      /* DESKTOP ONLY, because the values in STRUCTURE were measured at
       * 1440x900 and the design ships SEPARATE mobile frames.
       *
       * My first version applied them to both projects and mobile failed at
       * `title is 26px, the handoff says 34px` — which is almost certainly the
       * design's own responsive step, not a defect. **An expectation applied at
       * a viewport it was not measured at produces a confident false finding**,
       * and I would have taken it to dev as a structural miss.
       *
       * Mobile is NOT covered here rather than silently assumed correct. Its
       * values are in the 390x844 frames and need reading out of the prototype
       * before they can be asserted. Stated so nobody reads a green desktop run
       * as "the screen matches at both sizes". */
      test.skip(testInfo.project.name !== 'desktop',
        'STRUCTURE holds values measured at 1440x900; mobile frames have their own and are not yet transcribed');

      await seedTerminal(page);
      await gotoGuarded(page, `${route}?design=terminal`);
      await page.waitForTimeout(3000);

      const got = await page.evaluate(() => {
        const h1 = document.querySelector('main h1');
        const rail = document.querySelector('.dterm-toc, [class*="toc"], main aside');
        return {
          title: h1 ? Math.round(parseFloat(getComputedStyle(h1).fontSize)) : null,
          rail: rail ? Math.round(rail.getBoundingClientRect().width) : null,
        };
      });

      /* ±1px, not exact. Sub-pixel layout and font metrics move a rendered
       * width by a fraction; the design's intent is the integer. A tighter
       * tolerance would fail on rounding and teach people to widen it. */
      if (spec.title !== undefined) {
        expect(got.title,
          `${route} title is ${got.title}px, the handoff says ${spec.title}px. ${spec.note}`)
          .toBeGreaterThanOrEqual(spec.title - 1);
        expect(got.title!).toBeLessThanOrEqual(spec.title + 1);
      }
      if (spec.rail !== undefined) {
        expect(got.rail,
          `${route} rail is ${got.rail}px, the handoff says ${spec.rail}px. ${spec.note}`)
          .toBeGreaterThanOrEqual(spec.rail - 1);
        expect(got.rail!).toBeLessThanOrEqual(spec.rail + 1);
      }
    });
  }
});
