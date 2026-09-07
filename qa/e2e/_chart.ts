import type { Page } from '@playwright/test';

/**
 * Assert whether the chart's own canvases changed, without a human looking.
 *
 * Built for #1008 (Pro subscribers edit indicator parameters and the edits
 * reach nothing) — the finding there was made by hand: hash every canvas's
 * `toDataURL()` before and after an edit, on the theory that a screenshot
 * comparison leaves room to argue and a hash does not. Length 20 vs. 5 on
 * Bollinger and period 14 vs. 2 on RSI are not subtle changes; either should
 * visibly redraw. Bit-for-bit identical pixels either way is what proved the
 * edit reached nothing.
 *
 * TWO THINGS TO GET RIGHT, both from findings earlier the same day this was
 * built:
 *
 * 1. KILL TRANSITIONS FIRST. `chartChanged`/`chartUnchanged` read
 *    `getBoundingClientRect`-adjacent state (canvas pixels), and a canvas
 *    mid-transition — a panel still animating open, a chart still zooming —
 *    is a real but temporary state, not the settled one. #1011's header spec
 *    raced `.gchat-panel`'s own open animation this same day and failed all
 *    8 cases against a build that was actually correct. Call
 *    `killTransitions(page)` before taking the baseline snapshot, not after.
 *
 * 2. BASELINE BEFORE COMPARING, ALWAYS. A hash with nothing to compare
 *    against asserts nothing — the same lesson the failure-watch monitor's
 *    own flood taught: unbaselined state read as new. `snapshotCanvases`
 *    must run before whatever might change the chart, not after.
 */

/** Kill all CSS transitions/animations on the page. Call before
 *  `snapshotCanvases` — a canvas read mid-animation is a real state, just
 *  not the one the assertion means to measure. */
export async function killTransitions(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  });
}

export interface CanvasSnapshot {
  hash: number;
  len: number;
}

/** Hash every `<canvas>` on the page right now — all of them, concatenated,
 *  so a change to any single canvas (not just the one you expect) is caught.
 *  This is the baseline; take it before the action under test. */
export async function snapshotCanvases(page: Page): Promise<CanvasSnapshot> {
  return page.evaluate(() => {
    const canvases = document.querySelectorAll('canvas');
    let combined = '';
    canvases.forEach((c) => {
      try { combined += c.toDataURL(); } catch { /* tainted or zero-size canvas - skip, don't fail the snapshot */ }
    });
    let hash = 0;
    for (let i = 0; i < combined.length; i++) hash = (hash * 31 + combined.charCodeAt(i)) | 0;
    return { hash, len: combined.length };
  });
}

/** The negative case — assert an action changed NOTHING on the chart.
 *  #1008 was found with exactly this shape: an edit that gives positive
 *  feedback (the input field updates) while changing zero pixels. */
export async function chartUnchanged(page: Page, before: CanvasSnapshot, message?: string): Promise<void> {
  const after = await snapshotCanvases(page);
  if (after.hash !== before.hash || after.len !== before.len) {
    throw new Error(
      message ??
      `expected the chart's canvases to be unchanged, but they differ ` +
      `(before: hash=${before.hash} len=${before.len}, after: hash=${after.hash} len=${after.len})`,
    );
  }
}

/** The positive case — assert an action changed the chart. For once #1008's
 *  fix lands and parameter edits actually reach `createIndicator`. */
export async function chartChanged(page: Page, before: CanvasSnapshot, message?: string): Promise<void> {
  const after = await snapshotCanvases(page);
  if (after.hash === before.hash && after.len === before.len) {
    throw new Error(
      message ??
      `expected the chart's canvases to change, but they are bit-for-bit identical ` +
      `(hash=${after.hash} len=${after.len})`,
    );
  }
}
