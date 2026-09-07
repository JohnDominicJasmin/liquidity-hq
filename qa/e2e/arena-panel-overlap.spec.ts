import { test, expect } from '@playwright/test';
import { settle } from './_shared';

/**
 * Owner instruction, 2026-09-08, verbatim: "we need to close this and dont
 * let any overlapping UI goes in." A standing rule, not a one-bug fix - see
 * qa/TEST_GAPS.md §2 for the regression that prompted it: `.klc-canvas`'s
 * flat 800px height overflowed `.at-chart`'s 430px box and painted over
 * every panel below it, on the Arena terminal's main column, at every
 * desktop width Dev checked (768 through 1440). Two checks had already
 * passed on that exact page - #853's own node-count/instance-count/text
 * criteria, and `layout.spec.ts`'s obscured-control detector - because
 * neither reads a bounding rect for anything that isn't an interactive
 * control. This is the check that does.
 *
 * WHAT THIS ASSERTS, and no more: within a named container, no two DIRECT
 * CHILDREN have intersecting bounding rects. Normal document flow already
 * guarantees this for siblings that aren't absolutely positioned or
 * overflowing their own box - so a failure here means exactly the shape of
 * bug this exists for: something rendered past the edge of the box that was
 * supposed to contain it.
 *
 * WIDTH SET: Dev's own sweep found the regression at 768, 850, 900, 1000,
 * 1058, 1100, 1150, 1200, 1300 and 1440 - reused verbatim rather than picked
 * fresh, since it is already evidence that this exact bug shape reproduces
 * at every one of them. 390 is checked separately against the mobile tree's
 * own children, matching criterion 24's mobile/desktop split.
 *
 * TWO HONEST LIMITS, so a green run here is not read as more than it is:
 *
 * 1. Bounding boxes catch OVERLAP, not WRONGNESS. Text clipped inside its
 *    own box, a z-index fight where the boxes never intersect but the wrong
 *    element still paints on top, colour-on-colour illegibility - none of
 *    that moves a getBoundingClientRect() call. qa/TEST_GAPS.md §2 is still
 *    open for a reason; this narrows it, it does not close it.
 * 2. This only guards the container it is pointed at. `.at-main` and
 *    `.at-rail` are covered because this is where the regression shipped -
 *    a different container overlapping is not caught until it is added
 *    here too.
 *
 * SCOPE, deliberately narrow per CONTRIBUTING.md §3d's own warning: a slow
 * check applied everywhere gets disabled within a month, and a disabled
 * gate reads as coverage while providing none. This covers Arena - the
 * densest screen in the product, and the one that just broke - not a
 * sitewide sweep. Generalise only if this stays cheap in practice.
 */

const WIDTHS_DESKTOP = [768, 850, 900, 1000, 1058, 1100, 1150, 1200, 1300, 1440];

interface Rect { x: number; y: number; width: number; height: number }

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Reads the DIRECT children of `selector` and returns any pairwise-overlapping
 * pair, described by a stable label (class name, or tag+index as a fallback)
 * rather than an opaque handle - the failure message needs to name what
 * overlapped, not just that something did.
 *
 * A child's OWN `getBoundingClientRect()` is not enough - it reports that
 * element's own box exactly as CSS sized it, even when a descendant renders
 * outside that box (this is precisely how the regression this file exists
 * for was invisible to a naive same-level check: `.at-chart`'s own rect was
 * a correct 430px tall, while its `.klc-canvas` child rendered 800px tall
 * and spilled into three siblings' worth of space below it). So each
 * child's rect here is the UNION of its own box and every descendant's box -
 * its actual rendered footprint, not just what its own CSS declares. */
async function findOverlappingChildren(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<string[]> {
  return page.evaluate((sel) => {
    const container = document.querySelector(sel);
    if (!container) return [];
    const describe = (el: Element, i: number) =>
      (el.className && typeof el.className === 'string' && el.className.trim())
        ? `.${el.className.trim().split(/\s+/)[0]}`
        : `${el.tagName.toLowerCase()}[${i}]`;
    const unionRect = (el: Element) => {
      const all = [el, ...el.querySelectorAll('*')];
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const node of all) {
        const r = node.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
      }
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    const children = [...container.children]
      .map((el, i) => ({ el, label: describe(el, i), rect: unionRect(el) }))
      // A zero-size child (nothing rendered - e.g. a gated panel returning
      // null) cannot overlap anything and isn't a candidate.
      .filter(c => c.rect.width > 0 && c.rect.height > 0 && Number.isFinite(c.rect.left));
    const bad: string[] = [];
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        const a = children[i].rect, b = children[j].rect;
        const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        if (overlap) bad.push(`${children[i].label} overlaps ${children[j].label}`);
      }
    }
    return bad;
  }, selector);
}

test.describe('Arena terminal — no two main-column siblings visually overlap', () => {
  for (const width of WIDTHS_DESKTOP) {
    test(`at ${width}px`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      await settle(page, '/arena?design=terminal');
      // klinecharts renders asynchronously after mount - give it room to
      // reach its natural (possibly overflowing) size before measuring.
      await page.waitForTimeout(2000);

      const mainOverlaps = await findOverlappingChildren(page, '.at-main');
      const railOverlaps = await findOverlappingChildren(page, '.at-rail');

      expect(mainOverlaps, `main column: ${mainOverlaps.join(', ')}`).toEqual([]);
      expect(railOverlaps, `rail: ${railOverlaps.join(', ')}`).toEqual([]);
      await ctx.close();
    });
  }
});

test('Arena terminal mobile 390 — no two top-level children visually overlap', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await settle(page, '/arena?design=terminal');
  await page.waitForTimeout(2000);

  const overlaps = await findOverlappingChildren(page, '[data-layout="mobile"]');
  expect(overlaps, overlaps.join(', ')).toEqual([]);
  await ctx.close();
});
