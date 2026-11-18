import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* PR #2578 - components/BeamsBackground.tsx draws into a quarter-resolution bitmap that CSS scales up.
 * SOURCE PINS ONLY. They fix the relation that keeps the on-screen blur the same (blur = 35 * scale / dpr, ctx.scale = bitmap scale), the CSS size
 * staying the parent's size (no sideways overflow), and that reduced motion and cleanup are untouched.
 * WHAT IT DOES NOT PROVE: what the picture looks like. That was measured separately in a real browser (static frame, old vs new drawing code,
 * DPR 1/2/3: max difference 2/255) and still needs the page itself at 390/768/1280, light/dark, 3x. */
const src = readFileSync(new URL('../components/BeamsBackground.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const setupAt = src.indexOf('const setup = () => {');
const setup = src.slice(setupAt, src.indexOf('};', setupAt));

test('bitmap is BITMAP_SCALE of the CSS size and the 2D context is scaled by the same factor', () => {
  assert.match(src, /const BITMAP_SCALE = 0\.25;/);
  assert.match(setup, /canvas\.width = Math\.max\(1, Math\.round\(w \* BITMAP_SCALE\)\);/);
  assert.match(setup, /canvas\.height = Math\.max\(1, Math\.round\(h \* BITMAP_SCALE\)\);/);
  assert.match(setup, /ctx\.scale\(BITMAP_SCALE, BITMAP_SCALE\);/);
  assert.ok(!/ctx\.scale\(dpr, dpr\)/.test(src), 'the device-pixel-ratio scale is back');
});
test('the canvas blur keeps its old on-screen size: 35 * BITMAP_SCALE / dpr, recomputed in setup(), used by every frame', () => {
  assert.match(setup, /blurPx = \(35 \* BITMAP_SCALE\) \/ dpr;/);
  assert.match(src, /ctx\.filter = `blur\(\$\{blurPx\}px\)`;/);
  assert.ok(!/ctx\.filter = 'blur\(35px\)'/.test(src), 'the fixed 35 px blur is back');
  assert.match(setup, /const dpr = window\.devicePixelRatio \|\| 1;/);
});
test('CSS size is still the parent size in CSS px (no overflow), and the element keeps its CSS blur', () => {
  assert.match(setup, /canvas\.style\.width = `\$\{w\}px`;/);
  assert.match(setup, /canvas\.style\.height = `\$\{h\}px`;/);
  assert.match(src, /filter: 'blur\(15px\)'/);
});
test('reduced motion and cleanup are unchanged', () => {
  assert.match(src, /if \(!reduceMotion\) rafRef\.current = requestAnimationFrame\(animate\);/);
  assert.match(src, /const onResize = \(\) => \{ setup\(\); if \(reduceMotion\) animate\(\); \};/);
  assert.match(src, /window\.removeEventListener\('resize', onResize\);\s*cancelAnimationFrame\(rafRef\.current\);/);
  assert.match(src, /animate=\{reduceMotion \? \{ opacity: 0\.125 \}/);
});
