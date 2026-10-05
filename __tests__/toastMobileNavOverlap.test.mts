/* The settings save message must never sit on the Ask AI button or the phone tab bar.
 *
 * HISTORY. #1455: the toast (`.st-save-toast`, bottom-right, `bottom: 24px`) covered the terminal tab bar's
 * "SCAN" label on phones; 0cf51a8e lifted it above the bar with a `max-width: 767px` override (an earlier
 * version keyed off the dead `.mobile-tab-bar` and missed 641-767px). #1292 hid the Ask AI button while the
 * toast showed (`body.settings-toast-open`). On 2026-10-01 the OWNER rejected the release over exactly this
 * corner: "Saved" still sat behind the Ask AI button and against the tab bar (#1498). The fix (c1f129b1) moves
 * the toast TOP-CENTRE, 8px under the top bar, at every width - it cannot meet the FAB or the tab bar by
 * construction - and removes both workarounds.
 *
 * So this file now pins the NEW geometry against the bars it is built from, and that nothing anchors the
 * toast to the bottom any more. CSS-only checks (no DOM test library here); the rendered proof is QA's
 * overlap pairs on #1498 (0 px² against the FAB, the tab bar and the top bar). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const css = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule block whose selector list mentions `.st-save-toast` exactly (not `.st-save-toast-retry` etc.). */
function toastRules(): string[] {
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter((m) => /\.st-save-toast(?![-\w])/.test(m[1]) && !/\.st-save-toast\.(saving|error|conflict)/.test(m[1]) && !/@keyframes/.test(m[1]))
    .map((m) => m[2]);
}

test('S1. the LIVE mobile bottom bar is [data-design="terminal"] .tnav-tabs, really 60px and really fixed to the bottom - the bar the toast must stay clear of', () => {
  const rule = css.match(/\[data-design="terminal"\]\s*\.tnav-tabs\s*\{[^}]*height:\s*60px[^}]*\}/);
  assert.ok(rule, '[data-design="terminal"] .tnav-tabs is not 60px tall in its mobile (flex) rule');
  assert.match(rule[0], /position:\s*fixed/);
  assert.match(rule[0], /bottom:\s*0\b/);
});

test('S1b. the dead .mobile-tab-bar offset and the old 640px override are gone - regression guard for the 7ef1ff34 mistake', () => {
  assert.doesNotMatch(css, /\.st-save-toast\s*\{\s*bottom:\s*calc\([^)]*56px/);
  assert.doesNotMatch(css, /max-width:\s*640px\)\s*\{\s*\.st-save-toast/);
});

test('S2. the base rule puts the toast TOP-CENTRE: fixed, left 50% with translateX(-50%), top = banner + 44px bar + 8px', () => {
  const base = toastRules().find((r) => /position:\s*fixed/.test(r));
  assert.ok(base, 'no base `.st-save-toast { position: fixed ... }` rule found');
  assert.match(base, /left:\s*50%/, 'the toast is not centred horizontally (left: 50%)');
  assert.match(base, /transform:\s*translateX\(-50%\)/, 'the centring translate is missing');
  assert.match(base, /top:\s*calc\(var\(--banner-h,\s*0px\)\s*\+\s*44px\s*\+\s*8px\)/, 'desktop top is no longer banner + 44px bar + 8px');
  assert.match(base, /max-width:\s*min\(92vw,\s*420px\)/, 'the width cap that keeps it inside a phone screen changed');
});

test('S3. PREMISE: the 44px and 38px in the toast\'s top are the real top bar heights (desktop .tnav, phone header), both fixed at the banner', () => {
  const desk = css.match(/\[data-design="terminal"\]\s*\.tnav\s*\{([^}]*)\}/);
  assert.ok(desk, 'CONTROL: the terminal top bar rule moved');
  assert.match(desk[1], /position:\s*fixed;\s*top:\s*var\(--banner-h\)/);
  assert.match(desk[1], /height:\s*44px/, 'the desktop top bar is no longer 44px - the toast would overlap it or float away from it');
  const phoneHeader = [...css.matchAll(/\{([^{}]*position:\s*fixed;\s*top:\s*var\(--banner-h\)[^{}]*height:\s*38px[^{}]*)\}/g)];
  assert.ok(phoneHeader.length >= 1, 'no fixed phone header 38px tall at top: var(--banner-h) found - the phone offset is built on it');
});

test('S4. at <=767px the toast sits under the 38px phone header plus the notch, and its buttons reach 44px', () => {
  const media = [...css.matchAll(/@media \(max-width:\s*767px\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).find((b) => /\.st-save-toast\s*\{/.test(b));
  assert.ok(media, 'no @media (max-width: 767px) block positions .st-save-toast');
  assert.match(media, /\.st-save-toast\s*\{\s*top:\s*calc\(env\(safe-area-inset-top,\s*0px\)\s*\+\s*var\(--banner-h,\s*0px\)\s*\+\s*38px\s*\+\s*8px\);?\s*\}/, 'the phone top is no longer notch + banner + 38px header + 8px');
  assert.match(media, /\.st-save-toast-retry\s*\{\s*min-height:\s*44px;?\s*\}/, '"Try again" is under 44px on phones');
  assert.match(media, /\.st-save-toast-close\s*\{\s*width:\s*44px;\s*height:\s*44px;?\s*\}/, 'the dismiss X is under 44px on phones');
});

test('S5. NOTHING anchors the toast to the bottom or the right any more - the corner the owner rejected', () => {
  const rules = toastRules();
  assert.ok(rules.length >= 2, `CONTROL: expected the base rule and the phone rule, found ${rules.length}`);
  for (const r of rules) {
    assert.doesNotMatch(r, /(^|;|\s)bottom:/, `a .st-save-toast rule sets bottom again: ${r.trim().slice(0, 80)}`);
    assert.doesNotMatch(r, /(^|;|\s)right:/, `a .st-save-toast rule sets right again: ${r.trim().slice(0, 80)}`);
  }
});

test('S6. layering: above the bars (z-index 1000) so it is not hidden under them, below the Ask AI panel (9994) and modals', () => {
  const base = toastRules().find((r) => /position:\s*fixed/.test(r));
  assert.ok(base, 'no base `.st-save-toast { position: fixed ... }` rule found');
  const z = Number((base.match(/z-index:\s*(\d+)/) || [])[1]);
  assert.ok(z > 1000 && z < 9994, `toast z-index ${z} is not between the bars (1000) and the Ask AI panel (9994)`);
  const panel = css.match(/\.gchat-panel\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(panel && Number(panel[1]) === 9994, 'CONTROL: the Ask AI panel z-index moved - re-derive');
});

test('S7. the workarounds for the old corner are gone, and the entrance keeps the centring and respects reduced motion', () => {
  assert.doesNotMatch(css, /settings-toast-open/, 'body.settings-toast-open (hide the FAB while the toast shows) is back in CSS');
  const kf = css.match(/@keyframes stToastIn\s*\{\s*from\s*\{([^}]*)\}\s*to\s*\{([^}]*)\}\s*\}/);
  assert.ok(kf, 'the toast entrance keyframes are gone or no longer a from/to pair');
  for (const [i, step] of [[1, 'from'], [2, 'to']] as const) {
    assert.match(kf[i], /transform:\s*translate\(-50%,/, `the entrance animation's ${step} step drops the -50% centring - the toast would jump sideways while it animates`);
  }
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.st-save-toast\s*\{\s*animation:\s*none;?\s*\}\s*\}/, 'no reduced-motion opt-out for the toast animation');
});
