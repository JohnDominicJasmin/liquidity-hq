import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { ALLOWED, CONVERTED_ROUTES, TOKEN_VALUES, UNCONVERTED_CHROME } from './_design-tokens';
import { DESIGN_STORAGE_KEY } from '@/lib/designMode';

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
  return page.evaluate(({ allowed, props, chrome }) => {
    const hex = (v: string): string | null => {
      const m = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?/i);
      if (!m) return null;
      const a = m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
      if (a === 0) return null;
      const [r, g, b] = [m[1], m[2], m[3]].map(n => Math.round(parseFloat(n)));
      return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    };

    /** True if the element holds a non-whitespace text node of its own. */
    const hasOwnText = (el: Element) =>
      [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0);

    const found = new Map<string, string>();
    for (const el of document.querySelectorAll('*')) {
      if (!(el as HTMLElement).checkVisibility?.()) continue;
      /* Skip global components that have not been converted yet. `closest` so a
       * child of the chat panel is covered without listing every descendant. */
      if (chrome.some(sel => el.closest(sel))) continue;
      const cs = getComputedStyle(el);
      for (const p of props) {
        const raw = cs[p as keyof CSSStyleDeclaration] as string | undefined;
        if (!raw || typeof raw !== 'string') continue;
        /* A gradient is ONE property carrying MANY colours, so every hex inside
         * it is extracted rather than the property being skipped. */
        /* `color` ONLY COUNTS WHERE TEXT IS ACTUALLY RENDERED.
         *
         * `html` reported `#000000 color` on every run — and nothing in the app
         * sets it. That is the browser's initial value, and `body` overrides it
         * with `var(--txt)` for everything that renders. A colour on an element
         * with no text of its own is inert: it names a value that paints no
         * pixels.
         *
         * Checked rather than assumed — `app/globals.css` has no `color` rule on
         * `html` at all, and `body { color: var(--txt) }` at :237.
         *
         * Only `color` gets this treatment. A background or border on a wrapper
         * paints regardless of whether the wrapper holds text. */
        /* ── A COLOUR THAT PAINTS NO PIXELS IS NOT A FINDING ────────────────
         *
         * ONE root cause, and it took FOUR symptoms to see it: reading a
         * property on an element it does not apply to returns that property's
         * INITIAL value, not nothing. `getComputedStyle` always answers.
         *
         * `html` reported, in order, as each fix landed:
         *
         *     #000000  color            no text of its own; body sets --txt
         *     #000000  borderTopColor   border-width 0
         *     #000000  outlineColor     outline-style none
         *     #000000  fill             not an SVG element at all
         *
         * **The same element, four times, under four properties, and I fixed
         * three of them one at a time before naming the rule.** Special-casing
         * `html` would have left the fourth to appear on some other wrapper
         * weeks later.
         *
         * Checked, not assumed: `app/globals.css` sets no `color` on `html`, and
         * `body { color: var(--txt) }` at :237. */
        if (p === 'color' && !hasOwnText(el)) continue;

        /* fill/stroke are SVG properties. On an HTML element they are the
         * initial `rgb(0,0,0)` and paint nothing. */
        if ((p === 'fill' || p === 'stroke') && el.namespaceURI !== 'http://www.w3.org/2000/svg') continue;

        /* AND A BORDER COLOUR WITH NO BORDER WIDTH PAINTS NOTHING EITHER.
         *
         * Same family, found the same way: killing the `color` case surfaced
         * `#000000 borderTopColor` on `html` — the UA initial, on an element
         * whose border-width is 0. **Two symptoms, one rule: a colour that
         * paints no pixels is not a finding.**
         *
         * Worth stating because I fixed the first symptom and the second
         * appeared immediately. Had I only special-cased `html`, the third
         * would have arrived on some other wrapper weeks from now. */
        if (p.startsWith('border') && p.endsWith('Color')) {
          const side = p.slice(6, -5);            // borderTopColor -> Top
          const w = cs[`border${side}Width` as keyof CSSStyleDeclaration] as string | undefined;
          if (!w || parseFloat(w) === 0) continue;
        }
        /* `outline-width` computes to the keyword `medium` when the style is
         * `none`, so parseFloat gives NaN and a width check never fires. The
         * STYLE is the reliable signal. Found by fixing the width version and
         * watching the same element reappear under a third property. */
        if (p === 'outlineColor' && (cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth || '0') === 0)) continue;

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
  }, { allowed: [...ALLOWED], props: [...COLOUR_PROPS], chrome: [...UNCONVERTED_CHROME] });
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
    for (const [name, hex] of Object.entries(TOKEN_VALUES)) {
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
      /* THE REDESIGN IS BEHIND A RUNTIME FLAG, so it has to be turned ON before
       * anything here means what it says (#417).
       *
       * Without this, `gotoGuarded` renders the CURRENT design and this test
       * asserts it against the TERMINAL palette. The output would be ~27
       * off-token colours on a route the ledger calls converted — a report that
       * names dev's CSS while measuring a page they did not build. I would have
       * posted it with a straight face.
       *
       * Storage rather than `?design=terminal`: seeding runs before first paint
       * and does not have to survive gotoGuarded's redirect handling. Same
       * mechanism contrast.spec.ts uses for theme, and the key is imported from
       * `lib/designMode.ts` rather than typed again — one list, one source. */
      await page.addInitScript((k) => {
        try { localStorage.setItem(k, 'terminal'); } catch { /* private mode */ }
      }, DESIGN_STORAGE_KEY);

      /* PIN CONSENT, because the banner is a THIRD uncontrolled input and it
       * made two runs of this spec disagree.
       *
       * A first-visit page renders the cookie banner; a later one does not. The
       * banner's buttons carry current-design colours, so the finding set
       * changed between runs with no code change — and a conformance gate whose
       * output moves on its own gets re-run rather than read.
       *
       * `denied` matches layout.spec.ts and a11y.spec.ts, so all three sweeps
       * measure the same page. The banner has its own coverage in
       * layout.spec.ts's first-visit test; it does not need measuring here too. */
      await page.addInitScript(() => {
        try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
      });

      /* BOTH MECHANISMS, because only one of them currently works.
       *
       * Measured on #417: the stored value is overwritten to `current` during
       * hydration, so a seed alone reverts. The query param survives because it
       * travels in the URL and is read from `window.location.search`.
       *
       * Belt and braces on purpose — when the stickiness bug is fixed the seed
       * becomes the primary path again, and this keeps working either way
       * without a follow-up edit that someone has to remember. */
      await gotoGuarded(page, `${route}?design=terminal`);
      await page.waitForTimeout(3000);

      /* AND IT MUST HAVE TAKEN. A storage write that silently fails leaves
       * the old design rendering, and if it happened to use no off-token colour
       * this test would report a CLEAN PASS on a screen nobody converted —
       * certifying the redesign by measuring its absence.
       *
       * `designAttribute('current')` returns null on purpose, so "attribute
       * missing" is exactly what the un-flagged state looks like. That makes
       * this assertion the difference between the two, not a formality. */
      const mode = await page.evaluate(() => document.documentElement.dataset.design ?? null);
      expect(mode,
        `${route} did not render in terminal mode, so this run measured the CURRENT ` +
        `design against the new palette. Every colour below would be a false finding. ` +
        `Check DESIGN_STORAGE_KEY against lib/designMode.ts.`)
        .toBe('terminal');

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
