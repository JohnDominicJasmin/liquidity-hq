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
 * its actual rendered footprint, not just what its own CSS declares.
 *
 * CLIP-AWARE, 2026-09-08 - the union-with-descendants approach's own first
 * false positive. `.at-tfrow` (`overflow: hidden`) clips its overflowing
 * timeframe-button row before it ever paints outside the row's own box, so
 * a plain union reported `.at-tfrow overlaps .at-verdict/.at-mchart` on
 * mobile 390 with nothing actually visible - `getBoundingClientRect()`
 * reports an element's full geometry regardless of ancestor clipping, only
 * paint respects it. Each descendant's rect is now intersected against
 * every ancestor between it and the page root that clips
 * (`overflow`/`overflow-x`/`overflow-y` of hidden/clip/scroll/auto) before
 * it enters the union - clipped-away geometry contributes nothing, same as
 * what a user actually sees. The canvas bug still reproduces: nothing
 * between `.klc-canvas` and `.at-chart` clips, so the overflow is real and
 * still visible, and still fails this check. */
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
    const CLIP = /hidden|clip|scroll|auto/;
    const clips = (el: Element) => {
      const cs = getComputedStyle(el);
      return CLIP.test(cs.overflow) || CLIP.test(cs.overflowX) || CLIP.test(cs.overflowY);
    };
    /** The element's rect as actually visible, after intersecting against
     *  every clipping ancestor up to the document root. Null if fully
     *  clipped away - such an element paints nothing, anywhere. */
    const visibleRect = (el: Element) => {
      const own = el.getBoundingClientRect();
      let rect = { left: own.left, top: own.top, right: own.right, bottom: own.bottom };
      let node = el.parentElement;
      while (node) {
        if (clips(node)) {
          const cr = node.getBoundingClientRect();
          rect = {
            left: Math.max(rect.left, cr.left),
            top: Math.max(rect.top, cr.top),
            right: Math.min(rect.right, cr.right),
            bottom: Math.min(rect.bottom, cr.bottom),
          };
          if (rect.right <= rect.left || rect.bottom <= rect.top) return null;
        }
        node = node.parentElement;
      }
      return rect;
    };
    const unionRect = (el: Element) => {
      const all = [el, ...el.querySelectorAll('*')];
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const node of all) {
        const r = visibleRect(node);
        if (!r) continue;
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
      }
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    const children = [...container.children]
      .map((el, i) => ({ el, label: describe(el, i), rect: unionRect(el) }))
      // A zero-size child (nothing rendered, or everything in it clipped
      // away - e.g. a gated panel returning null) cannot overlap anything
      // and isn't a candidate.
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

/**
 * #1053, 2026-09-08: the owner reverted the terminal Arena rebuild this gate
 * was built for (production's classic Arena was correct; the rebuild carried
 * this file's own regression plus two others). `.at-root`/`.at-main`/
 * `.at-rail` no longer exist anywhere in the DOM - `document.querySelector`
 * returns null, `findOverlappingChildren`'s early return hands back `[]`,
 * and `expect([]).toEqual([])` passes. That is a green run that checked
 * NOTHING, not a green run that found the page clean - the exact "false
 * clean" shape this project has paid for before (`settle()`/`gotoSignedIn()`
 * exist for the same reason on the signed-in suite). Skip honestly instead:
 * a named, dated skip reason is worth more than a checkmark that lies about
 * what it measured. Re-enable by removing this guard if the terminal Arena
 * is ever rebuilt - the detection logic itself needs no change, it was never
 * the part that broke. */
async function terminalArenaAbsent(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => document.querySelectorAll('.at-root').length === 0);
}
const TERMINAL_ARENA_REVERTED =
  '#1053: the terminal Arena rebuild was reverted 2026-09-08 (owner-directed) - ' +
  '.at-root/.at-main/.at-rail no longer exist. Skipping rather than reporting a ' +
  'false pass against selectors that no longer match anything.';

test.describe('Arena terminal — no two main-column siblings visually overlap', () => {
  for (const width of WIDTHS_DESKTOP) {
    test(`at ${width}px`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      await settle(page, '/arena?design=terminal');
      test.skip(await terminalArenaAbsent(page), TERMINAL_ARENA_REVERTED);
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
  test.skip(await terminalArenaAbsent(page), TERMINAL_ARENA_REVERTED);
  await page.waitForTimeout(2000);

  const overlaps = await findOverlappingChildren(page, '[data-layout="mobile"]');
  expect(overlaps, overlaps.join(', ')).toEqual([]);
  await ctx.close();
});
