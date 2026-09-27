/* #1455: on mobile, the settings save/conflict toast (`.st-save-toast`, `bottom: 24px` in the base rule) sat
 * directly over the terminal design's bottom nav bar (`[data-design="terminal"] .tnav-tabs`, 60px,
 * `position: fixed; bottom: 0`, shown at <=767px) and covered the "SCAN" label - found while capturing
 * #1292's owner-look screenshots. Fix is CSS-only: a `max-width: 767px` media query, scoped to
 * `[data-design="terminal"]`, lifts the toast's `bottom` offset above the bar plus the iOS home-indicator
 * safe area - the same formula the terminal design's own `.app-content` padding-bottom already uses.
 *
 * 0cf51a8e, not 7ef1ff34 (amended). An earlier version of this fix keyed off `.mobile-tab-bar` (56px,
 * <=640px) - that class renders nowhere in the app any more (NavDrawer.tsx's own comment: the old
 * current-design nav block was deleted), so the fix missed the 641-767px band where the real bar renders.
 * Caught QA-side by measuring a live 36px overlap at 700px width, not by reading the CSS - S1/S7 below pin
 * the live selector down for exactly that reason, not just the desired one.
 *
 * CSS-only, so this is a structure + computed-value check, not a rendered assertion - no DOM test library in
 * this repo (same limit every component file tonight hit). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const css = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('S1. the LIVE mobile bottom bar is [data-design="terminal"] .tnav-tabs, really 60px and really fixed to the bottom - the premise the offset is built from', () => {
  const rule = css.match(/\[data-design="terminal"\]\s*\.tnav-tabs\s*\{[^}]*height:\s*60px[^}]*\}/);
  assert.ok(rule, '[data-design="terminal"] .tnav-tabs is not 60px tall in its mobile (flex) rule - the fix\'s 60px offset would no longer match the real bar height');
  assert.match(rule[0], /position:\s*fixed/);
  assert.match(rule[0], /bottom:\s*0\b/);
});

test('S1b. the dead .mobile-tab-bar class is not what the fix is keyed to any more - regression guard for the 7ef1ff34 mistake', () => {
  assert.doesNotMatch(css, /\.st-save-toast\s*\{\s*bottom:\s*calc\([^)]*56px/, 'the toast\'s calc() still references the dead .mobile-tab-bar\'s 56px - the wrong-selector bug is back');
  assert.doesNotMatch(css, /max-width:\s*640px\)\s*\{\s*\.st-save-toast/, 'a bare (non-terminal-scoped) 640px override on .st-save-toast still exists - the old, wrong rule was not removed');
});

test('S2. the toast\'s bottom offset is overridden inside a max-width:767px media query, scoped to [data-design="terminal"] - the base (desktop) rule and non-terminal designs are untouched', () => {
  const media = css.match(/@media \(max-width:\s*767px\)\s*\{([^}]*\[data-design="terminal"\]\s*\.st-save-toast[^}]*\})[^}]*\}/);
  assert.ok(media, 'no @media (max-width: 767px) block touching [data-design="terminal"] .st-save-toast was found');
});

test('S3. the mobile override matches the tab bar height plus the safe-area inset plus a real gap - not a guessed number', () => {
  const media = css.match(/@media \(max-width:\s*767px\)\s*\{\s*\[data-design="terminal"\]\s*\.st-save-toast\s*\{\s*bottom:\s*calc\(([^;]*)\);/);
  assert.ok(media, 'the override is not a calc() expression - re-check the rule\'s exact shape');
  const expr = media[1].replace(/\)\s*$/, '').replace(/\s+/g, ' ').trim();
  assert.match(expr, /60px/, 'the tab bar height (60px) is not part of the calc()');
  assert.match(expr, /env\(safe-area-inset-bottom,\s*0px\)/, 'the iOS safe-area inset is not part of the calc()');
  const gap = expr.match(/\+\s*(\d+)px\s*$/);
  assert.ok(gap && Number(gap[1]) > 0, 'no positive gap above the bar+safe-area sum - the toast would sit flush against the bar');
});

test('S4. the mobile formula is the SAME one the terminal design\'s own .app-content already uses to clear the tab bar - one number, not two independently-guessed ones that could drift', () => {
  const appContentRule = css.match(/\[data-design="terminal"\]\s*\.app-content\s*\{\s*padding-bottom:\s*calc\(([^;]*)\);/);
  const toastRule = css.match(/\[data-design="terminal"\]\s*\.st-save-toast\s*\{\s*bottom:\s*calc\(([^;]*)\);/);
  assert.ok(appContentRule, 'the terminal design\'s own .app-content safe-area calc() was not found - re-derive the comparison');
  assert.ok(toastRule, '[data-design="terminal"] .st-save-toast\'s mobile calc() was not found');
  const norm = (s: string) => s.replace(/\)\s*$/, '').replace(/\s+/g, '').replace(/1rem/, '16px');
  assert.equal(norm(appContentRule[1]).includes('60px+env(safe-area-inset-bottom,0px)'), true, 'the terminal .app-content rule no longer reserves 60px + the safe area - the comparison premise changed');
  assert.equal(norm(toastRule[1]).includes('60px+env(safe-area-inset-bottom,0px)'), true, 'the toast\'s calc() no longer includes 60px + the safe area');
});

test('S5. the base (non-media, non-terminal) .st-save-toast rule keeps its original bottom:24px - the fix only adds a terminal-scoped mobile override, it does not touch desktop or other designs', () => {
  const base = css.match(/(?<!\[data-design="terminal"\]\s*)\.st-save-toast\s*\{[^}]*\}/);
  assert.ok(base, 'the base .st-save-toast rule was not found');
  assert.match(base[0], /bottom:\s*24px/, 'the base rule\'s bottom offset changed - desktop/non-terminal should be untouched by this mobile-only fix');
});

test('S6. CONTROL: the computed mobile offset is strictly greater than the base 24px and than the bar height alone - proves the override actually lifts the toast, not just re-states 24px under a media query', () => {
  const toastRule = css.match(/\[data-design="terminal"\]\s*\.st-save-toast\s*\{\s*bottom:\s*calc\(([^;]*)\);/);
  assert.ok(toastRule);
  // env(safe-area-inset-bottom, 0px) evaluates to its fallback (0) on a device with no inset - the worst case
  // for "is this actually bigger", and still must clear the bar with room to spare.
  const withoutSafeArea = toastRule[1].replace(/env\(safe-area-inset-bottom,\s*0px\)/, '0px');
  const nums = [...withoutSafeArea.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
  const total = nums.reduce((a, b) => a + b, 0);
  assert.ok(total > 24, `the mobile offset (${total}px, safe-area-free floor) is not bigger than the base 24px`);
  assert.ok(total > 60, `the mobile offset (${total}px, safe-area-free floor) does not clear the 60px bar on its own`);
});

test('S7. CONTROL: the 641-767px band the earlier (56px/640px) version of this fix missed is now covered - 767 is inside the override\'s breakpoint, 640 is not the boundary any more', () => {
  const media = css.match(/@media \(max-width:\s*(\d+)px\)\s*\{\s*\[data-design="terminal"\]\s*\.st-save-toast/);
  assert.ok(media, 're-derive: the terminal toast override\'s breakpoint was not found');
  const breakpoint = Number(media[1]);
  assert.equal(breakpoint, 767, `the override's breakpoint is ${breakpoint}px, not 767px - the 641-767px band this fix exists for would be uncovered again`);
});
