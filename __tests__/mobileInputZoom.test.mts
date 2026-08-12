/* Guarding the mobile 16px input floor - which already existed, untested.
 *
 * ── WHY THIS FILE EXISTS, AND WHY IT IS NOT A FIX ───────────────────────────
 *
 * Android and iOS zoom the page when a text field under 16px takes focus, and
 * an SPA does not reset that zoom on client-side navigation - so focusing the
 * login field left the whole app stuck zoomed. app/globals.css already handles
 * this and has since before #326:
 *
 *     @media (max-width: 640px), (hover: none) and (pointer: coarse) {
 *       input, select, textarea { font-size: 16px !important; }
 *     }
 *
 * Both QA and I independently "found" this bug during #326 by reading the
 * authored `--fs-label: 0.8125rem` (13px) and stopping there. Neither of us
 * checked the computed value, and neither of us looked for an existing
 * override. QA measured the deployed build afterwards: the login email field
 * computes to 16px. The bug was fixed; we had rediscovered the reasoning.
 *
 * So this adds no rule. It pins the one that was already doing the work, which
 * had no test - which is the only reason two people could spend an afternoon
 * concluding it was absent.
 *
 * ── THE PART THAT REGRESSED BEFORE ──────────────────────────────────────────
 *
 * The comment above the rule records that it used to be `@media (max-width:
 * 640px)` alone, and that this silently stopped applying exactly where the
 * zoom still happens: a phone in landscape exceeds 640 CSS px, and so does
 * every tablet. Both are touch devices and both auto-zoom. That is what the
 * pointer-capability half of the query is for, and it is what the second test
 * below refuses to let anyone simplify away.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const RAW = readFileSync('app/globals.css', 'utf8');

/* COMMENTS STRIPPED FIRST, and this is not tidiness.
 *
 * The comment above the floor rule quotes the OLD query verbatim - including
 * `@media (max-width: 640px)` and the words `hover: none` / `pointer: coarse`
 * while explaining why width alone was wrong. A scanner that reads the raw file
 * matches that prose: my first version located the comment, not the rule, and
 * then passed happily when I deleted the pointer key from the real CSS to
 * check that it would fail.
 *
 * A control that cannot go red is not a control, and this one only went red
 * once the comments were gone. */
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The media block carrying the floor, with its query.
 *
 * Brace-scanned rather than regex-matched: the block contains a NESTED rule
 * (`input, select, textarea { ... }`), so a `[^{}]*` body pattern cannot span
 * it. The first version of this file used one and reported three failures
 * against CSS that was perfectly correct - the instrument was broken, not the
 * subject, which is the failure this whole issue has been made of.
 */
function floorRule(): { query: string; body: string } {
  for (const m of CSS.matchAll(/@media([^{]*)\{/g)) {
    const open = m.index! + m[0].length;
    let depth = 1, i = open;
    while (i < CSS.length && depth > 0) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}') depth--;
      i++;
    }
    const body = CSS.slice(open, i - 1);
    if (/\binput\b/.test(body) && /font-size:\s*[0-9.]+px/.test(body)) {
      return { query: m[1].trim(), body: body.trim() };
    }
  }
  assert.fail('no media rule setting a px font-size on input was found at all');
}

test('touch devices get form controls at 16px or larger', () => {
  const { body } = floorRule();
  for (const el of ['input', 'select', 'textarea']) {
    assert.match(body, new RegExp(`(^|[\\s,])${el}\\b`),
      `${el} is not covered, so it auto-zooms on focus`);
  }
  const size = body.match(/font-size:\s*([0-9.]+)px/);
  assert.ok(size, 'the rule declares no px font-size');
  assert.ok(parseFloat(size[1]) >= 16,
    `${size[1]}px is under the 16px threshold that triggers the zoom`);
});

test('the floor wins - it is !important, because the authored sizes are lower', () => {
  // Every field declares --fs-label/--fs-body deliberately, and many of those
  // rules are more specific than a bare `input` selector. Without !important
  // the floor loses to the very rules it exists to override.
  assert.match(floorRule().body, /!important/,
    'without !important the per-component font-size wins and the zoom returns');
});

test('the floor is keyed on POINTER CAPABILITY, not width alone', () => {
  // This regressed once already - see the comment above the rule. A phone in
  // landscape and every tablet are wider than 640px, are touch devices, and
  // auto-zoom. Width alone silently excludes exactly those cases.
  const { query } = floorRule();
  assert.match(query, /pointer:\s*coarse/,
    'width-only was the previous version, and it stopped applying in landscape and on tablets');
  assert.match(query, /hover:\s*none/, 'the capability check is hover:none + pointer:coarse');
});

test('pinch-zoom is NOT disabled to dodge this', () => {
  // The shorter fix is maximum-scale=1 / user-scalable=no. It works by taking
  // pinch-zoom from every user, which breaks WCAG 1.4.4. Asserted because it is
  // the one-liner someone reaches for the next time this resurfaces.
  const layout = readFileSync('app/layout.tsx', 'utf8');
  const viewport = layout.slice(
    layout.indexOf('export const viewport'), layout.indexOf('export default'));
  assert.doesNotMatch(viewport, /maximumScale/, 'maximumScale blocks pinch-zoom');
  assert.doesNotMatch(viewport, /userScalable/, 'userScalable blocks pinch-zoom');
});

test('CONTROL: fields really are authored below 16px, so the floor is load-bearing', () => {
  // Without this, every test above could pass against a codebase that no longer
  // needs the rule - and the rule would look essential while protecting nothing.
  // If this ever fails, the floor can genuinely be deleted.
  const authoredSmall = [...CSS.matchAll(/([^{}]*(?:input|textarea|select)[^{}]*)\{([^}]*)\}/gi)]
    .filter(m => /font-size:\s*var\(--fs-(label|caption|body|micro)\)/.test(m[2]));
  assert.ok(authoredSmall.length > 0,
    'no field is authored below 16px any more - the floor is now dead weight');
});

test('CONTROL: the tokens those fields use are in fact under 16px', () => {
  const px = Object.fromEntries(
    [...CSS.matchAll(/(--fs-[a-z0-9]+):\s*([0-9.]+)rem/g)].map(([, k, v]) => [k, parseFloat(v) * 16]));
  assert.ok(px['--fs-label'] < 16, `--fs-label is ${px['--fs-label']}px`);
  assert.ok(px['--fs-body'] < 16, `--fs-body is ${px['--fs-body']}px`);
});
