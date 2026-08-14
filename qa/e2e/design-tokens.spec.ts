import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { ALLOWED, CONVERTED_ROUTES, DESIGN_TOKENS } from './_design-tokens';

/* Does the rendered page use ONLY the Monochrome Terminal palette?
 *
 * THE FIRST CHECK IN THIS SUITE WITH AN EXTERNAL REFERENCE. Every other spec
 * compares the app against a baseline derived from the app — `KNOWN_OBSCURED`,
 * tap-target counts, contrast failures. Those answer "did this get worse than it
 * was", never "is this right". A design export finally supplies a right.
 *
 * The owner's ruling on tolerance (2026-08-14) is what this file implements:
 *
 *     TOKENS   exact, asserted mechanically   <- this file
 *     LAYOUT   judged by eye, reported by significance
 *
 * So off-token is a defect and off-mock is a judgement. This file only ever
 * makes the first kind of claim.
 *
 * WHY IT READS COMPUTED CSS RATHER THAN COMPARING SCREENSHOTS. Pixel diffing
 * needs baselines generated on the platform that will judge them, and it reports
 * "something moved" rather than "this colour is not in the system". A token
 * check names the defect: `#7c5cff is not a design token`. That is actionable
 * where a diff image is not.
 *
 * WHAT IT CANNOT SEE, stated rather than discovered later:
 *
 *   raster assets    the logo is a blue <img> with no colour declaration.
 *                    Invisible to a property read - exempt by construction, not
 *                    by an exemption list. If it is ever inlined as SVG with
 *                    hardcoded fills, this file WILL flag it, correctly.
 *   gradients        parsed for hex, but a gradient is one property with many
 *                    colours; each is checked, the shape is not.
 *   canvas           charts draw pixels this cannot read at all. The heatmap
 *                    ramp is exempt for the same reason it is unreadable.
 */

const COLOUR_PROPS = [
  'color', 'backgroundColor', 'borderTopColor', 'borderRightColor',
  'borderBottomColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke',
] as const;

/** `rgb(216, 166, 38)` / `rgba(…)` -> `#d8a626`. Null for transparent. */
function toHex(v: string): string | null {
  const m = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?/i);
  if (!m) return null;
  const a = m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
  /* FULLY TRANSPARENT IS NOT A COLOUR. `rgba(0,0,0,0)` is the initial value of
   * every border-*-color on every element - reporting it would bury the sweep in
   * thousands of findings about elements that have no border. */
  if (a === 0) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(n => Math.round(parseFloat(n)));
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}

async function offTokenColours(page: Page): Promise<string[]> {
  return page.evaluate(({ allowed, props }) => {
    const hex = (v: string): string | null => {
      const m = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?/i);
      if (!m) return null;
      const a = m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
      if (a === 0) return null;
      const [r, g, b] = [m[1], m[2], m[3]].map(n => Math.round(parseFloat(n)));
      return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    };

    const found = new Map<string, string>();
    for (const el of document.querySelectorAll('*')) {
      if (!(el as HTMLElement).checkVisibility?.()) continue;
      const cs = getComputedStyle(el);
      for (const p of props) {
        const raw = cs[p as keyof CSSStyleDeclaration] as string | undefined;
        if (!raw || typeof raw !== 'string') continue;
        /* A gradient is ONE property carrying MANY colours, so every hex inside
         * it is extracted rather than the property being skipped. */
        for (const part of raw.match(/rgba?\([^)]*\)/gi) ?? [raw]) {
          const h = hex(part);
          if (!h || allowed.includes(h)) continue;
          if (found.has(h)) continue;
          const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 2).join('.');
          found.set(h, `${h}  ${p}  ${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`);
        }
      }
    }
    return [...found.values()].sort();
  }, { allowed: [...ALLOWED], props: [...COLOUR_PROPS] });
}

test.describe('design token conformance', () => {
  /* THE SELF-TEST, AND IT RUNS FIRST.
   *
   * Every assertion below is "found nothing", which is also what a detector that
   * never looked returns. Two of this suite's specs turned out on 2026-08-14 to
   * have never asserted anything at all — one skipped on every run in its life,
   * one read clean on the exact commit that carried the bug it was written for.
   *
   * A conformance spec failing this way would be the most expensive version:
   * it would certify 31 screens as correct while looking at nothing. */
  test('the detector actually detects (guards against a vacuous pass)', async ({ page }) => {
    await gotoGuarded(page, '/');
    await page.waitForTimeout(2000);

    const before = await offTokenColours(page);

    await page.evaluate(() => {
      const el = document.createElement('div');
      /* Not a near-miss. A colour nothing in either palette is close to, so a
       * pass here cannot be luck. */
      el.style.cssText = 'position:fixed;left:8px;top:8px;width:40px;height:40px;'
        + 'background:rgb(255,0,255);z-index:99999';
      el.id = 'token-bait';
      document.body.appendChild(el);
    });

    const after = await offTokenColours(page);
    expect(after.some(f => f.startsWith('#ff00ff')),
      'an off-token magenta was injected into the page and the detector did not report it. ' +
      'Every other assertion in this file is "found nothing", so a broken detector passes silently.\n'
      + after.join('\n'))
      .toBe(true);

    expect(after.length, 'injecting one colour changed the count by more than one')
      .toBe(before.length + 1);
  });

  /* THE TOKENS THEMSELVES MUST SURVIVE THE ROUND TRIP. `toHex` is the one piece
   * of arithmetic here, and if it is wrong every result is wrong in the same
   * direction — which looks like a clean sweep, not like a bug. */
  test('CONTROL: every design token is recognised through the rgb round trip', () => {
    for (const [name, hex] of Object.entries(DESIGN_TOKENS)) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      expect(toHex(`rgb(${r}, ${g}, ${b})`),
        `${name} does not survive the rgb round trip - the parser, not the app, is wrong`)
        .toBe(hex.toLowerCase());
    }
    expect(toHex('rgba(0, 0, 0, 0)'), 'fully transparent must not count as a colour').toBeNull();
  });

  /* CONVERTED ROUTES ONLY. Empty until the first redesign merges — see the
   * ledger's comment for why this is opt-in rather than a global sweep. */
  for (const route of CONVERTED_ROUTES) {
    test(`${route} uses only Monochrome Terminal colours`, async ({ page }) => {
      await gotoGuarded(page, route);
      await page.waitForTimeout(3000);

      const rendered = await page.evaluate(() => document.querySelectorAll('*').length);
      expect(rendered,
        `${route} rendered almost nothing, so finding no off-token colours says ` +
        `nothing about the page. Same floor as a11y.spec.ts.`)
        .toBeGreaterThan(50);

      expect(await offTokenColours(page),
        `Colours on ${route} that are not in the Monochrome Terminal palette. ` +
        `Each line is: hex, the CSS property, and the element. If a value is ` +
        `legitimate design, it belongs in qa/e2e/_design-tokens.ts with a note ` +
        `saying where the designer specified it - not silently allowed here.`)
        .toEqual([]);
    });
  }

  test('the ledger is not silently empty once screens have shipped', async () => {
    /* A REMINDER, NOT AN ASSERTION, and deliberately not a failure.
     *
     * An empty ledger is correct today and wrong the moment a redesigned screen
     * merges without being added. Nothing can detect that from inside — the
     * suite cannot know a screen was converted. So this prints rather than
     * fails, and the real defence is the instruction in the ledger comment:
     * add the route in the SAME PR that converts it. */
    if (CONVERTED_ROUTES.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[tokens] ledger is empty - no route is under conformance yet. '
        + 'Correct before the first redesign merges; a problem after.');
    }
    expect(true).toBe(true);
  });
});
