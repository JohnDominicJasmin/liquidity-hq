import { test, expect } from '@playwright/test';
import { CONVERTED_ROUTES } from './_design-tokens';

/* Two controls with the same label on one screen — the check that would have
 * caught #461, and the one every other spec in this suite is structurally
 * incapable of making.
 *
 * `/arena?design=terminal` shipped with TWO interactive timeframe selectors,
 * the design's `.at-tfrow` and `KLineProChart`'s own `.klc-toolbar`, forty
 * pixels apart. Six specs passed over it:
 *
 *   arena-structure      counts .at-tfrow          -> 1, correct
 *   padlock assertion    glyphs inside .at-tfrow   -> 3, correct
 *   active chip          one accent bg in .at-tfrow -> 1, correct
 *   colour, sockets,     all scoped to .at-* or to the route as a whole
 *   entitlement
 *
 * **Every one of them is scoped to the component under test.** That is what
 * makes them precise, and it is exactly why none of them can see a duplicate
 * rendered by a different component. The owner found it by looking at a
 * screenshot I had sent as evidence the screen was in good shape.
 *
 * So this asserts a property of the SCREEN rather than of any component:
 * **no two interactive controls carry the same visible label.**
 *
 * It generalises. A redesign replaces a control and leaves the original
 * rendering — that is the same shape as the paywall leak (markup moved, guard
 * left behind) and the two chart instances (tree moved, subscription left
 * behind). This is the third instance of one pattern, so it gets a check
 * rather than a lesson.
 */

/* Labels that legitimately repeat, with the reason. Keep this list short and
 * argued — an exemption here hides exactly what the spec exists to find. */
const ALLOWED_REPEATS = new Set([
  /* Pagination and stepper affordances are repeated by design. */
  '', '›', '‹', '→', '←', '×', '▾', '▸', '+', '-',
]);

/* THE REFINEMENT, found by running this against real screens before trusting
 * it. First pass flagged three "duplicates" that are not the Arena bug:
 *
 *   "Sign In"        nav <lt-ghost href="/login">  AND  footer link, SAME href
 *   "Terms of Use"   footer nav column              AND  the legal sentence, SAME href
 *   "Privacy Policy" same shape
 *
 * Nav + footer repeating the same destination is ordinary site structure, not
 * a defect — every marketing site does it. The Arena bug was two <button>
 * elements with NO href to compare: `.at-tfrow`'s "1h" and
 * `.klc-toolbar`'s "1h" are two independently wired pieces of STATE that can
 * disagree, not two links to one place.
 *
 * So the rule: for an <a href>, the SAME href from two components is fine —
 * that is redundant navigation. A DIFFERENT href under the same label would be
 * the confusing case (two links promising the same thing, going different
 * places), so that still fails. For anything without an href — buttons, in
 * practice — there is nothing to compare, and same label from two components
 * is exactly the failure mode this file exists to catch. */

test.describe('no duplicate controls on a converted screen', () => {
  for (const route of CONVERTED_ROUTES) {
    test(`${route} has no two controls with the same label`, async ({ page }) => {
      test.setTimeout(150_000);
      await page.goto(`${route}?design=terminal`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => localStorage.setItem('lhq_analytics_consent_v1', 'denied'));
      await page.goto(`${route}?design=terminal`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(9000);

      const dupes = await page.evaluate(() => {
        /* label -> owner -> the set of hrefs seen for that (label, owner) pair.
         * `null` in the href set means "at least one instance has no href" —
         * a button, where there is nothing to compare and any repeat counts. */
        const byLabel = new Map<string, Map<string, Set<string | null>>>();
        const controls = Array.from(document.querySelectorAll('button, [role="button"], a[href]'));
        for (const el of controls) {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;            // not painted
          if (!(el as HTMLElement).offsetParent && getComputedStyle(el).position !== 'fixed') continue;
          const label = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim();
          if (!label || label.length > 24) continue;            // prose, not a control label
          let n: Element | null = el, owner = '';
          while (n && !owner) {
            const c = typeof n.className === 'string' ? n.className.split(' ')[0] : '';
            if (c) owner = c;
            n = n.parentElement;
          }
          const ownerKey = owner || el.tagName.toLowerCase();
          const href = el.tagName === 'A' ? (el as HTMLAnchorElement).getAttribute('href') : null;
          if (!byLabel.has(label)) byLabel.set(label, new Map());
          const owners = byLabel.get(label)!;
          if (!owners.has(ownerKey)) owners.set(ownerKey, new Set());
          owners.get(ownerKey)!.add(href);
        }

        const out: string[] = [];
        for (const [label, owners] of byLabel) {
          if (owners.size < 2) continue;                        // one component, not cross-component
          const allHrefs = new Set<string | null>();
          for (const hrefs of owners.values()) for (const h of hrefs) allHrefs.add(h);
          /* Every instance is an <a> and every href agrees -> redundant nav,
           * not a defect. Any null (a button) or any disagreement -> real. */
          const singleAgreedHref = allHrefs.size === 1 && ![...allHrefs].includes(null);
          if (singleAgreedHref) continue;
          out.push(`"${label}" in ${[...owners.keys()].join(' AND ')} (hrefs: ${[...allHrefs].map(h => h ?? 'none').join(', ')})`);
        }
        return out;
      });

      const real = dupes.filter(d => ![...ALLOWED_REPEATS].some(a => a && d.startsWith(`"${a}"`)));

      expect(real,
        `${route} renders the same control label from more than one component. ` +
        'A redesign that replaces a control and leaves the original rendering ' +
        'produces exactly this, and no component-scoped assertion can see it.',
      ).toEqual([]);
    });
  }
});
