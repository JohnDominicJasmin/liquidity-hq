import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROUTES } from './_shared';
import { installMarketFixtures } from './_fixtures';

/* Does the page LAY OUT correctly — not "is the DOM right".
 *
 * `qa/TEST_GAPS.md` §2 has said "nothing has ever looked at the pages" since the
 * first audit. Contrast is computed from CSS values, accessibility from
 * attributes, SEO from head tags. Every one of these still passes today:
 *
 *   - a control rendered underneath something else, so nobody can click it
 *   - a chart drawing at zero height
 *   - a modal opening off-screen
 *
 * WHY NOT `toHaveScreenshot()`, which is the obvious answer. Playwright suffixes
 * snapshots per platform, so baselines generated on Windows are never compared
 * against a Linux CI run - CI would silently generate its own on first run and
 * compare a build against itself. Pixel baselines need to be produced on the
 * platform that will judge them, which is a CI-side job and its own piece of
 * work. This file covers the failure modes that can be asserted DETERMINISTICALLY
 * and cross-platform, today, with no baseline files at all.
 *
 * TWO THINGS THIS MEASURES, both geometry rather than appearance:
 *
 *   OBSCURED - a visible, interactive control whose own centre point belongs to
 *              some unrelated element. That is the definition of "renders but
 *              cannot be used".
 *   ZERO-SIZE - a visible canvas or svg with no area. A chart that failed to
 *              size is invisible to every other check in this suite.
 *
 * MEASURED BEFORE ASSERTING, and the first attempt was useless: 4 false
 * "obscured" and 104 false "zero-size" across 12 routes. Both were my fault.
 * The obscured ones were the consent banner legitimately covering the page, and
 * the zero-size ones were mobile-nav icons correctly hidden at desktop width -
 * my check read each element's OWN computed style and never asked whether an
 * ancestor was hidden. `Element.checkVisibility()` answers that properly.
 * With those two corrections: 0 and 0 across all 32 routes.
 */

interface LayoutDefects { obscured: string[]; zeroSized: string[] }

/** Geometry only, evaluated in the page. No screenshots, no baselines. */
async function findLayoutDefects(page: Page): Promise<LayoutDefects> {
  return page.evaluate(() => {
    /* getAttribute('class'), NOT `.className`.
     *
     * On an SVG element `className` is an `SVGAnimatedString`, not a string, so
     * `typeof e.className === 'string'` is false for every svg on the page and
     * the label silently loses its class. The detector still found the element;
     * only its NAME was wrong - which is the kind of defect that survives
     * forever because the count looks right. The self-test below caught it. */
    const describe = (e: Element) => {
      const cls = (e.getAttribute('class') ?? '').trim().split(/\s+/)[0];
      return e.tagName.toLowerCase() + (cls ? '.' + cls : '');
    };

    /* checkVisibility walks the ANCESTOR chain. Reading getComputedStyle on the
     * element alone reports a mobile-nav icon as visible at desktop width,
     * because the icon is `display:block` inside a hidden container. That single
     * mistake produced 104 false positives on the first run of this check. */
    const visible = (e: Element) =>
      (e as Element & { checkVisibility?: (o: object) => boolean })
        .checkVisibility?.({ checkVisibilityCSS: true, checkOpacity: true }) ?? true;

    const obscured: string[] = [];
    const zeroSized: string[] = [];

    for (const el of document.querySelectorAll(
      'button, a[href], input:not([type=hidden]), select, textarea',
    )) {
      if (!visible(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      // Off-screen is not obscured - a control below the fold is normal.
      if (b.top >= innerHeight || b.bottom <= 0 || b.left >= innerWidth || b.right <= 0) continue;
      // Deliberately non-interactive; being covered is irrelevant.
      if (getComputedStyle(el).pointerEvents === 'none') continue;

      const x = Math.min(Math.max(b.left + b.width / 2, 1), innerWidth - 1);
      const y = Math.min(Math.max(b.top + b.height / 2, 1), innerHeight - 1);
      const hit = document.elementFromPoint(x, y);

      /* `contains` in BOTH directions on purpose. A button wrapping an icon
       * hit-tests to the icon, and a link inside a styled wrapper hit-tests to
       * the wrapper. Neither is a defect - only an UNRELATED element is. */
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        obscured.push(`${describe(el)} is covered by ${describe(hit)}`);
      }
    }

    for (const el of document.querySelectorAll('canvas, svg')) {
      if (!visible(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) zeroSized.push(describe(el));
    }

    return { obscured, zeroSized };
  });
}

test.describe('layout', () => {
  /* Runs on BOTH projects, unlike the HTTP-level specs which skip mobile. That
   * is the whole point here - layout is the one thing that genuinely differs
   * between 1440x900 and an iPhone 13, and "a layout collapsing at one specific
   * width" is on the §2 list. */

  /** Consent denied rather than granted: it dismisses the banner without
   *  starting PostHog, and an undismissed banner legitimately covers the page,
   *  which reads as every route having obscured controls. */
  async function preparedPage(browser: import('@playwright/test').Browser, viewport: { width: number; height: number }) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    const page = await ctx.newPage();
    page.on('dialog', d => d.dismiss());
    // Fixed market data: a chart's size must not depend on what BTC did today.
    await installMarketFixtures(page, 'as-recorded');
    return { page, close: () => ctx.close() };
  }

  /* THE SELF-TEST, AND IT RUNS FIRST.
   *
   * Both assertions below are "found nothing", and found-nothing is also what a
   * broken detector returns. This injects one real instance of each defect and
   * requires the detector to catch them, so a green sweep means "looked and saw
   * nothing" rather than "did not look".
   *
   * Without this the whole file could be replaced by `return {obscured: [],
   * zeroSized: []}` and stay green forever. */
  test('the detector actually detects (guards against a vacuous pass)', async ({ browser }, testInfo) => {
    const { page, close } = await preparedPage(browser, testInfo.project.use.viewport ?? { width: 1440, height: 900 });
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);

      const clean = await findLayoutDefects(page);
      expect(clean.obscured, `/ already has obscured controls: ${clean.obscured.join(', ')}`).toEqual([]);

      await page.evaluate(() => {
        const btn = document.createElement('button');
        btn.textContent = 'probe';
        Object.assign(btn.style, { position: 'fixed', left: '40px', top: '300px', width: '120px', height: '40px', zIndex: '1' });
        document.body.appendChild(btn);

        const veil = document.createElement('div');
        Object.assign(veil.style, { position: 'fixed', left: '0', top: '280px', width: '400px', height: '80px', zIndex: '2', background: 'rgba(0,0,0,0.01)' });
        veil.className = 'qa-probe-veil';
        document.body.appendChild(veil);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'qa-probe-svg');
        Object.assign(svg.style, { width: '0px', height: '0px', display: 'block' });
        document.body.appendChild(svg);
      });

      const seeded = await findLayoutDefects(page);
      expect(seeded.obscured.join(' '),
        'a button placed under an overlay was NOT reported as obscured - the detector is blind',
      ).toContain('qa-probe-veil');
      expect(seeded.zeroSized.join(' '),
        'a zero-size svg was NOT reported - the detector is blind',
      ).toContain('qa-probe-svg');
    } finally { await close(); }
  });

  test('no interactive control is covered by an unrelated element', async ({ browser }, testInfo) => {
    const { page, close } = await preparedPage(browser, testInfo.project.use.viewport ?? { width: 1440, height: 900 });
    /* DEDUPED to distinct route + control-kind pairs, and the reason is
     * measured rather than tidy-minded.
     *
     * Counting raw instances gave 13 on one run and 14 on the next, on the same
     * build. The variance is repeated elements - several footer links sit under
     * the same fixed tab bar, and how many have rendered when the sweep reaches
     * them moves with timing. A baseline on that number would flake, and a
     * flaky gate teaches people to re-run rather than read.
     *
     * The DISTINCT set is what a person would act on anyway: "on /calc, an input
     * is under the tab bar" is one defect whether it fires once or four times. */
    const found = new Set<string>();
    try {
      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const { obscured } = await findLayoutDefects(page);
        for (const o of obscured) found.add(`${route}: ${o}`);
      }
      testInfo.attach('obscured-controls.txt', {
        body: [...found].sort().join('\n') || '(none)',
        contentType: 'text/plain',
      });

      /* Printed, not only attached. `ci.yml` uploads artifacts on failure only,
       * so on a green run this number is unreachable - which is how "did it get
       * worse?" becomes unanswerable without re-running locally. Same reason the
       * contrast sweep prints its token counts. */
      console.log(`[layout] ${testInfo.project.name}: ${found.size} distinct obscured control(s) across ${ROUTES.length} routes`);

      /* STRICT on desktop, RATCHET on mobile, and the difference is a finding
       * rather than a convenience.
       *
       * Desktop measured 0 across all 32 routes, so zero is the correct number
       * and anything above it is a regression.
       *
       * Mobile measured 13, and they are real: the FIXED BOTTOM TAB BAR sits on
       * top of page content. Most are footer links, which is arguably cosmetic -
       * but `/calc` has `input.ps-inp` underneath it, and an input a thumb
       * cannot reach is a broken page, not a cosmetic one. Filed for dev rather
       * than asserted away.
       *
       * Baselined instead of set to 0 so the suite reports the truth today and
       * still fails if it gets worse. Lower this number as they are fixed - do
       * NOT raise it. */
      /* 11, measured twice on 2026-08-09 and identical both times. The raw
       * instance count was 13 then 14 on the same build, which is what forced
       * the dedupe above - I had written 12 here as a guess before measuring,
       * which is the habit this whole file exists to catch. */
      const MOBILE_OBSCURED_BASELINE = 11;
      const limit = testInfo.project.name === 'mobile' ? MOBILE_OBSCURED_BASELINE : 0;

      expect(found.size,
        `A visible, interactive control has another element at its own centre point, so a user ` +
        `cannot click it. Limit for ${testInfo.project.name} is ${limit}, found ${found.size}.\n` +
        (limit > 0
          ? 'Mobile carries a baseline because the fixed bottom tab bar overlays content. ' +
            'Lower it as they are fixed; never raise it.\n'
          : 'Desktop is strict - zero was measured on 2026-08-09 and zero is correct.\n') +
        [...found].sort().join('\n'),
      ).toBeLessThanOrEqual(limit);
    } finally { await close(); }
  });

  test('no visible chart or icon renders at zero size', async ({ browser }, testInfo) => {
    const { page, close } = await preparedPage(browser, testInfo.project.use.viewport ?? { width: 1440, height: 900 });
    const found: string[] = [];
    try {
      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const { zeroSized } = await findLayoutDefects(page);
        for (const z of zeroSized) found.push(`${route}: ${z}`);
      }
      testInfo.attach('zero-size-graphics.txt', { body: found.join('\n') || '(none)', contentType: 'text/plain' });
      expect(found,
        'A canvas or svg is visible per checkVisibility() but has no area. A chart that failed to ' +
        'size is invisible to every other check in this suite - contrast finds no colours in it, ' +
        'and axe finds no violations.\n' + found.join('\n'),
      ).toEqual([]);
    } finally { await close(); }
  });
});
