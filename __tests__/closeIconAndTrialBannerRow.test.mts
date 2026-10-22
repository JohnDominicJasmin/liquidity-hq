/* #1673 items 2 and 3 (owner-approved from the screenshots, 2026-10-22): one shared close (x), and the trial banner stays one row on a phone.
 *
 * THE ORACLE is the owner's two sentences, not the code: "the close button see the X icon the size should be the same", and "the pro trial
 * 14 days left and keep pro button put it into horizontal layout". Plus PM's follow-up that the separator must not dangle once the
 * countdown wraps below the label.
 *
 * STRUCTURE ONLY, the same limit as every component test in this repo: there is no DOM test library here, `wrapped` is closure-local React
 * state, and the layout itself is the owner's to judge - he has seen it and approved it. So what is pinned is what a later edit could undo
 * without anyone noticing: the shared icon, the three style rules that make the row one row, and the measured condition behind the dot.
 * What it cannot prove: the rendered pixels, that the pill is really 44 px tall on a device, or that the hint box did not grow. Those were
 * screenshots at 320 / 360 / 390 / 1280 on #1678. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const banner = stripComments(read('components/TrialBanner.tsx'));
const hint = stripComments(read('components/PageHint.tsx'));
const icon = stripComments(read('components/CloseIcon.tsx'));

/** Fails when an anchor is missing OR appears more than once: a test that silently matched a different line would report success. */
function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

/* ── item 3: one shared x ─────────────────────────────────────────────────── */

test('X1. both dismiss buttons render the SHARED icon, and neither file keeps a literal glyph', () => {
  for (const [name, src] of [['TrialBanner', banner], ['PageHint', hint]] as const) {
    assert.match(src, /import CloseIcon from '@\/components\/CloseIcon'/, `${name} does not import the shared icon`);
    assert.match(src, /<CloseIcon \/>/, `${name} does not render the shared icon`);
    /* The two glyphs the owner compared: U+2715 on the banner, U+00D7 on the hint. They rendered at visibly different sizes because they
       come from different fonts per OS, which is the whole reason for an SVG. */
    assert.equal(src.includes('✕'), false, `${name} still contains the ✕ glyph (U+2715)`);
    assert.equal(src.includes('×'), false, `${name} still contains the × glyph (U+00D7)`);
  }
});

test('X2. the icon is decorative and the BUTTON keeps the accessible name', () => {
  assert.match(icon, /aria-hidden="true"/, 'CloseIcon is not hidden from assistive tech, so each button would be named twice');
  assert.match(icon, /focusable="false"/, 'CloseIcon is focusable: an SVG in the tab order on every page carrying a hint');
  assert.match(icon, /stroke="currentColor"/, 'the icon does not take the colour of the button it sits in');
  /* #959: a `title` on this button clobbered name-from-content and every blocked chip announced the same string. The names come from
     label keys, so this asserts the aria-label is still there rather than what it says. */
  assert.match(banner, /aria-label=\{t\('TRIAL_BANNER_DISMISS'\)\}/, 'the banner x lost its accessible name');
  assert.match(hint, /aria-label=\{t\('PAGE_HINT_DISMISS_LABEL'\)\}/, 'the hint x lost its accessible name');
});

test('X3. the hint x reaches 44x44 WITHOUT making the box taller: every negative margin stays inside the box padding', () => {
  /* The box is `padding: '10px 12px'` and the button `margin: '-10px -10px -10px -6px'`. The invariant, computed from the source rather
     than written twice: each negative margin is no larger than the padding it reaches into, so the hit area grows into the box's own
     padding and the gap - never over the text, and never past the border, which would make the box grow. */
  /* Scoped to the hint BOX, from its own marker to the end of the file. The first version of this test searched the whole source and
     matched the collapsed chip's `padding: '4px 10px'` twenty lines earlier - so it measured one element's padding against another's
     margin and failed for a reason that had nothing to do with the hint box. It would equally have PASSED had those numbers happened to
     line up, which is the worse half. The marker alone is not enough either: `data-page-hint` marks the root in BOTH states, so the
     anchor is the expanded box's opening tag, and anchorOnce refused the ambiguous version rather than silently taking the first. */
  const boxAt = anchorOnce(hint, '<div data-page-hint={pageKey} style={{', 'the hint box');
  const box = hint.slice(boxAt);
  const pad = /padding: '(\d+)px (\d+)px'/.exec(box);
  assert.ok(pad, 'the hint box padding moved - re-read PageHint');
  const [padY, padX] = [Number(pad[1]), Number(pad[2])];
  const marg = /margin: '(-?\d+)px (-?\d+)px (-?\d+)px (-?\d+)px'/.exec(box);
  assert.ok(marg, 'the dismiss button margin moved - re-read PageHint');
  const [mTop, mRight, mBottom, mLeft] = marg.slice(1, 5).map(Number);
  assert.ok(-mTop <= padY, `top margin ${mTop} reaches ${-mTop - padY}px past the box's ${padY}px padding: the box will grow`);
  assert.ok(-mBottom <= padY, `bottom margin ${mBottom} reaches past the box's ${padY}px padding: the box will grow`);
  assert.ok(-mRight <= padX, `end margin ${mRight} reaches past the box's ${padX}px padding`);
  const gap = Number(/gap: (\d+),/.exec(box)?.[1] ?? NaN);
  assert.ok(Number.isFinite(gap), 'the hint row gap moved - re-read PageHint');
  assert.ok(-mLeft <= gap, `start margin ${mLeft} reaches ${-mLeft - gap}px past the ${gap}px gap and over the text`);
  const target = /width: 44,\s*height: 44,/.exec(box);
  assert.ok(target, 'the hint x is no longer a 44x44 target (WCAG 2.2 SC 2.5.8 asks 24; the owner chose the banner x as the standard)');
});

/* ── item 2: one row on a phone ───────────────────────────────────────────── */

test('R1. the row cannot wrap, the text block is the only thing that shrinks, and the pill is never squeezed', () => {
  anchorOnce(banner, "flexWrap: 'nowrap'", 'the row');
  assert.equal(banner.includes("flexWrap: 'wrap'"), false, 'the banner row can wrap again: at 390 px the countdown and the pill stacked');
  anchorOnce(banner, "flex: '0 1 auto', minWidth: 0", 'the text block');
  const pill = /padding: '0 15px', minHeight: 44, borderRadius: 999, flex: 'none'/.exec(banner);
  assert.ok(pill, "the pill lost `flex: 'none'` or its 44 px floor: it is the one control whose entire job is being tapped");
  assert.match(banner, /whiteSpace: 'nowrap'/, 'the pill label can break mid-word');
});

test('R2. the dangling separator is hidden by a MEASUREMENT, and only once the countdown has wrapped', () => {
  anchorOnce(banner, "visibility: wrapped ? 'hidden' : undefined", 'the separator');
  /* `visibility`, not `display`: the dot keeps its width, so hiding it cannot let the line fit again and flip back on the next render. */
  assert.equal(/display: wrapped \?/.test(banner), false, 'the separator is hidden with display, which can let the line reflow and flip back');
  /* Measured rather than a breakpoint, because where the line wraps depends on the language and the width. */
  anchorOnce(banner, 'setWrapped(b.offsetTop > a.offsetTop + 2)', 'the wrap check');
  assert.match(banner, /new ResizeObserver\(check\)/, 'the wrap state is not re-checked when the row resizes');
});

test('R3. the wrap watcher is not rebuilt on every render', () => {
  /* useNow re-renders this component every minute, and an effect with no dependency array would build and tear down a ResizeObserver each
     time. QA raised it on #1678; Dev fixed it with [daysLeft, isTrial, dismissedDay], which is better than the [label] QA suggested -
     the observer stays attached across renders, so a language switch still re-checks through the resize. */
  const at = anchorOnce(banner, 'useLayoutEffect(() => {', 'the wrap watcher');
  const body = banner.slice(at, at + 900);
  const deps = /\}, \[([^\]]*)\]\);/.exec(body);
  assert.ok(deps, 'the wrap watcher has NO dependency array: it rebuilds its ResizeObserver on every render, and this banner re-renders every minute');
  assert.ok(deps[1].trim().length > 0, 'the wrap watcher runs once with an empty dependency array: it would never re-check when the countdown text changes');
});

test('R4. the last-3-days banner still has no x to share, so item 3 cannot have added one', () => {
  /* The amber state is deliberately not dismissible. If a shared icon had been dropped in unconditionally, the trial's final warning would
     have become dismissible - a product change nobody asked for. */
  const at = anchorOnce(banner, '{!urgent && (', 'the dismiss button guard');
  assert.ok(banner.indexOf('<CloseIcon />') > at, 'the banner x is rendered outside the !urgent guard: the last-3-days warning is dismissible now');
  anchorOnce(banner, "...(urgent ? {} : { paddingInlineEnd: 56 })", 'the room reserved for the x');
});
