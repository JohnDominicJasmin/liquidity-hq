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
 *
 * A THIRD THING, found later by Dev instrumenting the code path directly
 * because a hash alone couldn't tell them: THE CHART REDRAWS ON ITS OWN.
 * Live price ticks repaint it — measured at 3 of 5 samples changing over 2
 * IDLE seconds, no interaction at all. This is asymmetric, and both
 * directions matter for different reasons:
 *
 *   - `chartUnchanged` is UNAFFECTED BY TICK DRIFT — a live canvas that's
 *     genuinely redrawing can only ever push a hash away from `before`,
 *     never hold it bit-for-bit identical by accident.
 *   - `chartChanged` IS affected, and dangerously: a single `before` sample
 *     can be stale the instant it's taken, and a live tick between baseline
 *     and the post-edit read produces a hash difference `chartChanged`
 *     cannot distinguish from the edit actually reaching the chart. `after`
 *     needs the same quiet-settling discipline as `before` — a tick can land
 *     in the gap after the edit just as easily as before it. `chartChanged`
 *     handles this itself; callers only need to pass a `quietSnapshot`
 *     baseline in.
 *
 * A FOURTH THING, found chasing what looked like a real #1019 regression and
 * turned out to be the instrument, not the app: A HIDDEN TAB FREEZES THE
 * CANVAS. Chrome pauses `requestAnimationFrame`-gated rendering for hidden
 * tabs, so `canvas.toDataURL()` returns a stale, unchanging value for as
 * long as the tab stays backgrounded — not "no drift", but no rendering AT
 * ALL, indistinguishable from either `chartUnchanged`'s pass condition or
 * `quietSnapshot`'s settle condition. A frozen canvas satisfies both
 * unconditionally. This is why `snapshotCanvases` below asserts visibility
 * before reading rather than silently returning a hash that might be real or
 * might be nothing rendering: a frozen read must be an error, never a value,
 * or every assertion built on top of it inherits the freeze. Confirmed NOT
 * an issue for `npx playwright test` runs — a fresh Playwright page reports
 * `hidden: false, hasFocus: true` by default (checked directly); this bit a
 * manual browser-extension check that never foregrounds its tab, not this
 * suite. The guard stays anyway — cheap, and it means a future caller in a
 * different harness fails loudly instead of silently trusting a frozen read.
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
 *  This is the baseline; take it before the action under test.
 *
 *  Throws rather than reading if the page is hidden or unfocused — see the
 *  file header's fourth lesson. A hidden tab's canvas is frozen, and a
 *  frozen read is indistinguishable from a real one to every caller above
 *  this function; the only safe place to catch it is here. */
export async function snapshotCanvases(page: Page): Promise<CanvasSnapshot> {
  const { hash, len, hidden, hasFocus } = await page.evaluate(() => {
    const canvases = document.querySelectorAll('canvas');
    let combined = '';
    canvases.forEach((c) => {
      try { combined += c.toDataURL(); } catch { /* tainted or zero-size canvas - skip, don't fail the snapshot */ }
    });
    let hash = 0;
    for (let i = 0; i < combined.length; i++) hash = (hash * 31 + combined.charCodeAt(i)) | 0;
    return { hash, len: combined.length, hidden: document.hidden, hasFocus: document.hasFocus() };
  });
  if (hidden || !hasFocus) {
    throw new Error(
      `snapshotCanvases: page is hidden=${hidden} hasFocus=${hasFocus} — refusing to read. ` +
      `A hidden/unfocused tab freezes canvas rendering (Chrome pauses requestAnimationFrame), ` +
      `so this read would be stale or empty, not a real measurement. Foreground the page (or ` +
      `run it where it naturally is, e.g. a normal Playwright test) before snapshotting.`,
    );
  }
  return { hash, len };
}

/** A `snapshotCanvases` baseline confirmed quiet — two consecutive reads,
 *  `intervalMs` apart, that agree — before returning it. Live ticks mean a
 *  single sample can be mid-drift; this polls until it catches the chart
 *  holding still, or gives up loudly rather than handing `chartChanged` a
 *  baseline it can't trust.
 *
 *  Use this, not `snapshotCanvases` directly, for any baseline
 *  `chartChanged` will compare against — see the file header. `chartUnchanged`
 *  doesn't need it: drift can only work against a false pass there, never
 *  produce one. */
export async function quietSnapshot(
  page: Page,
  opts: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<CanvasSnapshot> {
  const intervalMs = opts.intervalMs ?? 400;
  const maxAttempts = opts.maxAttempts ?? 8;
  let prev = await snapshotCanvases(page);
  for (let i = 0; i < maxAttempts; i++) {
    await page.waitForTimeout(intervalMs);
    const next = await snapshotCanvases(page);
    if (next.hash === prev.hash && next.len === prev.len) return next;
    prev = next;
  }
  throw new Error(
    `chart canvases never held still across ${maxAttempts} samples (${intervalMs}ms apart) — ` +
    `too volatile right now for a trustworthy chartChanged baseline. Not a #1008 finding; retry, ` +
    `or widen intervalMs if this is chronic.`,
  );
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
 *  fix lands and parameter edits actually reach `createIndicator`.
 *
 *  `before` MUST come from `quietSnapshot`, not `snapshotCanvases` — see the
 *  file header. `after` is quiet-settled internally, for the same reason: a
 *  live tick can land in the gap after the edit exactly as easily as before
 *  it, and a single `after` sample can't tell a settling edit from a
 *  transient tick. Settling on TWO consecutive agreeing samples (not one)
 *  favours converging on the edit's real, persistent state over a tick's
 *  transient one — a genuine parameter change holds once applied; a tick is
 *  a blip that moves on. Not a proof, but the same balance of probability
 *  `quietSnapshot` already relies on for the baseline. If the chart never
 *  settles, this throws (via `quietSnapshot`) rather than guessing. */
export async function chartChanged(page: Page, before: CanvasSnapshot, message?: string): Promise<void> {
  const after = await quietSnapshot(page);
  if (after.hash === before.hash && after.len === before.len) {
    throw new Error(
      message ??
      `expected the chart's canvases to change, but they are bit-for-bit identical ` +
      `(hash=${after.hash} len=${after.len})`,
    );
  }
}
