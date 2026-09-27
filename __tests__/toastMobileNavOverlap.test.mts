/* #1455: on mobile, the settings save/conflict toast (`.st-save-toast`, `bottom: 24px` in the base rule) sat
 * directly over the bottom tab bar (`.mobile-tab-bar`, 56px, `position: fixed; bottom: 0`) and covered the
 * "SCAN" label - found while capturing #1292's owner-look screenshots. Fix is CSS-only: a `max-width: 640px`
 * media query lifts the toast's `bottom` offset above the bar plus the iOS home-indicator safe area, the same
 * formula `.app-content`'s own padding-bottom already uses for the same reason.
 *
 * CSS-only, so this is a structure + computed-value check, not a rendered assertion - no DOM test library in
 * this repo (same limit every component file tonight hit). The reconstruction probe
 * (button-size-probe-v2.mjs-style, against a live deployed host) is the natural follow-up once this ships;
 * not written here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const css = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('S1. the mobile tab bar is really 56px and really fixed to the bottom - the premise the offset is built from', () => {
  const rule = css.match(/\.mobile-tab-bar\s*\{[^}]*height:\s*56px[^}]*\}/);
  assert.ok(rule, '.mobile-tab-bar is not 56px tall in its mobile (flex) rule - the fix\'s 56px offset would no longer match the real bar height');
  assert.match(rule[0], /position:\s*fixed/);
  assert.match(rule[0], /bottom:\s*0\b/);
});

test('S2. the toast\'s bottom offset is overridden inside a max-width:640px media query - the base (desktop) rule is untouched', () => {
  const media = css.match(/@media \(max-width:\s*640px\)\s*\{([^}]*\.st-save-toast[^}]*\})[^}]*\}/);
  assert.ok(media, 'no @media (max-width: 640px) block touching .st-save-toast was found');
});

test('S3. the mobile override matches the tab bar height plus the safe-area inset plus a real gap - not a guessed number', () => {
  const media = css.match(/@media \(max-width:\s*640px\)\s*\{\s*\.st-save-toast\s*\{\s*bottom:\s*calc\(([^;]*)\);/);
  assert.ok(media, 'the override is not a calc() expression - re-check the rule\'s exact shape');
  const expr = media[1].replace(/\)\s*$/, '').replace(/\s+/g, ' ').trim();
  assert.match(expr, /56px/, 'the tab bar height (56px) is not part of the calc()');
  assert.match(expr, /env\(safe-area-inset-bottom,\s*0px\)/, 'the iOS safe-area inset is not part of the calc()');
  const gap = expr.match(/\+\s*(\d+)px\s*$/);
  assert.ok(gap && Number(gap[1]) > 0, 'no positive gap above the bar+safe-area sum - the toast would sit flush against the bar');
});

test('S4. the mobile formula is the SAME one .app-content already uses to clear the tab bar - one number, not two independently-guessed ones that could drift', () => {
  const appContentRule = css.match(/\.app-content\s*\{\s*padding-bottom:\s*calc\(([^;]*)\);/);
  const toastRule = css.match(/\.st-save-toast\s*\{\s*bottom:\s*calc\(([^;]*)\);/);
  assert.ok(appContentRule, '.app-content\'s own safe-area calc() was not found - re-derive the comparison');
  assert.ok(toastRule, '.st-save-toast\'s mobile calc() was not found');
  const norm = (s: string) => s.replace(/\)\s*$/, '').replace(/\s+/g, '').replace(/1rem/, '16px');
  assert.equal(norm(appContentRule[1]).includes('56px+env(safe-area-inset-bottom,0px)'), true, '.app-content no longer reserves 56px + the safe area - the comparison premise changed');
  assert.equal(norm(toastRule[1]).includes('56px+env(safe-area-inset-bottom,0px)'), true, 'the toast\'s calc() no longer includes 56px + the safe area');
});

test('S5. the base (non-media) .st-save-toast rule keeps its original bottom:24px - the fix only adds a mobile override, it does not touch desktop', () => {
  const base = css.match(/\.st-save-toast\s*\{[^}]*\}/);
  assert.ok(base, 'the base .st-save-toast rule was not found');
  assert.match(base[0], /bottom:\s*24px/, 'the base rule\'s bottom offset changed - desktop should be untouched by this mobile-only fix');
});

test('S6. CONTROL: the computed mobile offset is strictly greater than the base 24px and than the bar height alone - proves the override actually lifts the toast, not just re-states 24px under a media query', () => {
  const toastRule = css.match(/\.st-save-toast\s*\{\s*bottom:\s*calc\(([^;]*)\);/);
  assert.ok(toastRule);
  // env(safe-area-inset-bottom, 0px) evaluates to its fallback (0) on a device with no inset - the worst case
  // for "is this actually bigger", and still must clear the bar with room to spare.
  const withoutSafeArea = toastRule[1].replace(/env\(safe-area-inset-bottom,\s*0px\)/, '0px');
  const nums = [...withoutSafeArea.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
  const total = nums.reduce((a, b) => a + b, 0);
  assert.ok(total > 24, `the mobile offset (${total}px, safe-area-free floor) is not bigger than the base 24px`);
  assert.ok(total > 56, `the mobile offset (${total}px, safe-area-free floor) does not clear the 56px bar on its own`);
});
