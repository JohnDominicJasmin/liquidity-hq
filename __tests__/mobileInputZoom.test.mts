/* #326 - form controls under 16px make mobile browsers zoom the page.
 *
 * The zoom is not the bug by itself; the bug is that nothing resets it on
 * navigation, so focusing the autofocused 13px login field left the whole app
 * zoomed after sign-in. That presented as three separate reports - "desktop
 * view", "zoomed position in dashboard", and a missing Ask AI FAB (a
 * position:fixed element pushed outside the visual viewport).
 *
 * Eleven rules were under the threshold when this was found, so the fix is a
 * floor on the element types rather than eleven edits. These tests guard the
 * floor, because the next field added will be styled from the same --fs-*
 * scale and will be 13px like the rest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync('app/globals.css', 'utf8');

/** Every `--fs-*` token, in px. */
function scalePx(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [, name, rem] of CSS.matchAll(/(--fs-[a-z0-9]+):\s*([0-9.]+)rem/g)) {
    out[name] = parseFloat(rem) * 16;
  }
  return out;
}

/** The mobile block that carries the floor. */
function mobileFloorBlock(): string {
  const i = CSS.indexOf('MOBILE: form controls never below 16px');
  assert.ok(i > -1, 'the mobile font-size floor block is missing entirely');
  return CSS.slice(i);
}

test('the mobile floor sets form controls to at least 16px', () => {
  const block = mobileFloorBlock();
  assert.match(block, /@media\s*\(max-width:\s*639px\)/,
    'the floor must be scoped to mobile - the desktop type scale is deliberate');

  for (const el of ['input', 'textarea', 'select']) {
    assert.ok(new RegExp(`(^|[\\s,(])${el}\\b`, 'm').test(block),
      `${el} is not covered by the floor, so it still zooms on focus`);
  }

  const size = block.match(/font-size:\s*([0-9.]+)px/);
  assert.ok(size, 'the floor declares no font-size');
  assert.ok(parseFloat(size[1]) >= 16,
    `${size[1]}px is still under the 16px zoom threshold`);
});

test('checkboxes, radios and ranges are excluded - they have no text to zoom for', () => {
  const block = mobileFloorBlock();
  for (const t of ['checkbox', 'radio', 'range']) {
    assert.match(block, new RegExp(`:not\\(\\[type="${t}"\\]\\)`),
      `${t} inputs should keep their sizing - forcing 16px on them changes layout for nothing`);
  }
});

test('the viewport does NOT disable pinch-zoom to dodge this', () => {
  // The shorter fix for input zoom is maximum-scale=1 / user-scalable=no. It
  // works by removing pinch-zoom from every user, which breaks WCAG 1.4.4.
  // Asserted because it is the tempting one-liner someone reaches for the next
  // time this resurfaces.
  const layout = readFileSync('app/layout.tsx', 'utf8');
  const viewport = layout.slice(layout.indexOf('export const viewport'), layout.indexOf('export default'));
  assert.doesNotMatch(viewport, /maximumScale/, 'maximumScale blocks pinch-zoom - use the CSS floor instead');
  assert.doesNotMatch(viewport, /userScalable/, 'userScalable blocks pinch-zoom - use the CSS floor instead');
});

test('CONTROL: the --fs-* tokens these fields use really are under 16px', () => {
  // Without this the tests above could pass against a scale that never had a
  // problem, which would make the floor look load-bearing when it was not.
  const px = scalePx();
  assert.ok(px['--fs-label'] < 16, `--fs-label is ${px['--fs-label']}px`);
  assert.ok(px['--fs-caption'] < 16, `--fs-caption is ${px['--fs-caption']}px`);
  assert.ok(px['--fs-body'] < 16, `--fs-body is ${px['--fs-body']}px`);
});

test('CONTROL: fields are still authored from the small scale, so the floor is doing work', () => {
  // If every field were raised to 16px individually one day, the floor becomes
  // dead weight and this test says so rather than leaving it there forever.
  const authored = [...CSS.matchAll(/([^{}]*(?:input|textarea|select)[^{}]*)\{([^}]*)\}/gi)]
    .filter(m => /font-size:\s*var\(--fs-(label|caption|body|micro)\)/.test(m[2]))
    .length;
  assert.ok(authored > 0,
    'no field is authored below 16px any more - the mobile floor can be removed');
});
