/* The accumulation score ramp's three bands are all readable, in all four
 * contexts (#787).
 *
 * WHAT HAPPENED. `scoreCol` read:
 *
 *     s >= 75 ? 'var(--green)' : s >= 60 ? '#a3e635' : 'var(--amber)'
 *
 * Two tokens and a literal, in one ternary, reading as one ramp. The tokens
 * followed the theme and the literal did not: 1.15:1 on this card in terminal
 * light, the worst text contrast measured on this project, against 12.98 in
 * the dark it was chosen for. No error, no failing test, and invisible to a
 * token sweep because a token sweep looks at tokens.
 *
 * It also only fails for scores 60-74. A board showing 80s and 50s renders
 * correctly, so whether the defect is on screen depends on live market data.
 * That is precisely the case a test can hold and a rendered check cannot.
 *
 * THE GROUND. AccumulationTracker's card is
 * `linear-gradient(180deg, var(--bg2) 0%, var(--bg1) 100%)`, so a row can sit
 * anywhere between the two stops. Both are checked and the worse one has to
 * pass; QA measured against --bg0 (the page behind the card) and got 1.40
 * where the card's own stops give 1.15, which is the same defect read against
 * a neighbouring surface.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssColor, contrastRatio } from '../lib/readableOn.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');
const SRC = readFileSync(path.join(ROOT, 'components', 'AccumulationTracker.tsx'), 'utf8');

function tokens(selector: string): Record<string, string> {
  const lines = CSS.split('\n');
  const idx = lines.findIndex(l => l.trim() === selector + ' {');
  assert.ok(idx >= 0, `token block not found: ${selector}`);
  const from = lines.slice(0, idx).join('\n').length;
  let i = CSS.indexOf('{', from), depth = 0, end = i;
  for (; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = CSS.slice(CSS.indexOf('{', from) + 1, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;\n]+)/g)) {
    out[m[1]] = m[2].split('/*')[0].trim().replace(/;$/, '');
  }
  return out;
}
function resolve(map: Record<string, string>, value: string, depth = 0): string | null {
  if (depth > 10) return null;
  const m = /^var\((--[a-z0-9-]+)(?:\s*,\s*([^)]+))?\)$/.exec(value.trim());
  if (!m) return value.trim();
  const next = map[m[1]] ?? m[2];
  return next === undefined ? null : resolve(map, next, depth + 1);
}

const root = tokens(':root');
const light = tokens('[data-theme="light"]');
const termDark = tokens('[data-design="terminal"]:not([data-theme="light"])');
const termLight = tokens('[data-design="terminal"][data-theme="light"]');
const CONTEXTS: Array<[string, Record<string, string>]> = [
  ['current dark', { ...root }],
  ['current light', { ...root, ...light }],
  ['terminal dark', { ...root, ...termDark }],
  ['terminal light', { ...root, ...light, ...termLight }],
];

/* The card's gradient stops. NOT --bg0: that is the page behind the card, and
   it is also undefined in [data-theme="light"] (#783), so including it reports
   a near-black ground the widget never renders on. */
const GROUNDS = ['--bg1', '--bg2'];
const BANDS = ['var(--green)', 'var(--score-mid)', 'var(--amber)'];

test('every score band clears 4.5:1 on both gradient stops, all four contexts', () => {
  const failures: string[] = [];
  for (const [name, map] of CONTEXTS) {
    for (const band of BANDS) {
      const fg = parseCssColor(resolve(map, band) ?? '');
      assert.ok(fg, `${band} does not resolve in ${name}`);
      for (const g of GROUNDS) {
        const bg = parseCssColor(resolve(map, `var(${g})`) ?? '');
        assert.ok(bg, `${g} does not resolve in ${name}`);
        const c = contrastRatio(fg!.rgb, bg!.rgb);
        if (c < 4.5) failures.push(`${name} ${band} on ${g} -> ${c.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(failures, [],
    `${failures.length} band/ground pair(s) below 4.5:\n  ${failures.join('\n  ')}`);
});

/** Hue angle in degrees. */
function hue([r, g, b]: [number, number, number]): number {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  if (d === 0) return 0;
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return (h * 60 + 360) % 360;
}

test('the three bands stay visually distinct in every context', () => {
  /* MEASURED BY HUE, NOT BY CONTRAST, and the first version of this test got
     that wrong in the way this whole session has been about.
     I wrote it with contrastRatio and it failed on every context - including
     `green vs amber -> 1.04` in the CURRENT design, which has shipped for
     months and is obviously two different colours. Contrast ratio measures
     LUMINANCE. These bands are deliberately similar in brightness and
     different in hue, so a contrast floor answers a question nobody asked and
     answers it wrongly. A check that fails on the untouched baseline is
     measuring the wrong property, not finding a defect.
     Hue separation is what "distinct band" means here. 25 degrees is a floor
     chosen so the three read apart in a screenshot, not a standards figure. */
  const failures: string[] = [];
  for (const [name, map] of CONTEXTS) {
    const rgb = BANDS.map(b => parseCssColor(resolve(map, b) ?? '')!.rgb as [number, number, number]);
    const pairs: Array<[string, number, number]> = [
      ['green vs mid', 0, 1], ['mid vs amber', 1, 2], ['green vs amber', 0, 2],
    ];
    for (const [label, a, b] of pairs) {
      const raw = Math.abs(hue(rgb[a]) - hue(rgb[b]));
      const sep = Math.min(raw, 360 - raw);
      if (sep < 25) failures.push(`${name} ${label} -> ${sep.toFixed(0)} degrees apart`);
    }
  }
  assert.deepEqual(failures, [],
    `bands too close in hue to tell apart:\n  ${failures.join('\n  ')}\n` +
    'The ramp carries information by colour; three bands that read alike stop ' +
    'carrying it. #774 nearly shipped the opposite mistake - fixing contrast by ' +
    'flattening an encoding.');
});

test('CONTROL: the literal this replaced really did fail', () => {
  /* Without this the sweep passes and proves only that it ran. #a3e635 is the
     value that shipped; it must still fail both light contexts, or --score-mid
     is not load-bearing and this file should be revisited rather than kept. */
  const failed: string[] = [];
  for (const [name, map] of CONTEXTS) {
    for (const g of GROUNDS) {
      const bg = parseCssColor(resolve(map, `var(${g})`) ?? '')!;
      if (contrastRatio([163, 230, 53], bg.rgb) < 4.5) failed.push(`${name}/${g}`);
    }
  }
  assert.ok(failed.length >= 4,
    `expected #a3e635 to fail both grounds in both light contexts; it failed ${failed.length} (${failed.join(', ')})`);
});

test('the component takes the token, and no literal is left in the ramp', () => {
  const ramp = /const scoreCol[\s\S]{0,240}?;/.exec(SRC);
  assert.ok(ramp, 'scoreCol not found in AccumulationTracker.tsx - renamed?');
  assert.match(ramp![0], /var\(--score-mid\)/, 'the middle band no longer takes --score-mid');
  assert.doesNotMatch(ramp![0], /#[0-9a-fA-F]{3,8}\b/,
    'a hex literal is back in the score ramp. Two tokens and a literal in one ' +
    'ternary is exactly how #787 happened - the literal does not follow the theme ' +
    'and nothing fails.');
});
