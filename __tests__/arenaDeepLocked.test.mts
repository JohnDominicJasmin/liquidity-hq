/* The locked Deep Research buttons are readable in every theme (#769).
 *
 * WHAT SHIPPED. `.arena-deep-locked` sets `color: #c8891e !important`, and the
 * comment above it records 6.42:1 - a real measurement, taken against the DARK
 * ground. The rule is unscoped, so the same value also lands on the light
 * themes' cream, where QA rendered it at 2.33 (current) and 2.59 (terminal) on
 * PRODUCTION. Arena's two primary calls to action in the signed-out state.
 *
 * That comment also closes off the defence before anyone reaches for it: the
 * button is not disabled, it navigates to /login, so WCAG 1.4.3's carve-out
 * for inactive components does not apply. "Deliberately dimmed" is unavailable
 * by the file's own argument.
 *
 * WHY THE GROUNDS ARE LITERALS HERE. `.arena-deep-locked` paints
 * `rgba(217,119,6,0.06)` over whatever card it sits on, and that card is an
 * `.arena-*` surface rather than a token this test can resolve on its own. QA
 * measured the composited result on staging: rgb(231,227,223) current light and
 * rgb(245,238,229) terminal light. Those are RENDERED grounds, not computed
 * ones, which makes them better evidence than anything this file could derive -
 * and worse if the card ever changes. Named as rendered so the next person
 * knows to re-measure rather than trust them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssColor, contrastRatio, type Rgb } from '../lib/readableOn.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');

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
const termLight = tokens('[data-design="terminal"][data-theme="light"]');

/** Rendered by QA on staging, not computed here. See the header. */
const LIGHT_GROUNDS: Array<[string, Rgb, Record<string, string>]> = [
  ['current light', [231, 227, 223], { ...root, ...light }],
  ['terminal light', [245, 238, 229], { ...root, ...light, ...termLight }],
];

test('the light override exists and outranks the unscoped !important', () => {
  /* Specificity plus !important, both required. The base rule is
     `.arena-deep-locked { color: … !important }` at (0,1,0); the override adds
     an attribute selector for (0,2,0) and carries !important of its own.
     Dropping either half silently loses - which is #663's whole subject. */
  assert.match(CSS, /\[data-theme="light"\]\s+\.arena-deep-locked\s*\{[^}]*color:\s*var\(--amber\)\s*!important/,
    'the light-scoped colour override is missing or no longer !important');
  assert.match(CSS, /\[data-theme="light"\]\s+\.arena-deep-locked:not\(:disabled\):hover\s*\{[^}]*color:\s*var\(--amber-2\)\s*!important/,
    'the light-scoped HOVER override is missing - #e8a838 measures 1.63 there');
});

test('the resolved foreground clears 4.5:1 on both rendered light grounds', () => {
  const failures: string[] = [];
  for (const [name, ground, map] of LIGHT_GROUNDS) {
    for (const [label, token] of [['rest', 'var(--amber)'], ['hover', 'var(--amber-2)']]) {
      const fg = parseCssColor(resolve(map, token) ?? '');
      assert.ok(fg, `${token} does not resolve in ${name}`);
      const c = contrastRatio(fg!.rgb, ground);
      if (c < 4.5) failures.push(`${name} ${label} (${token}) -> ${c.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, [], `below 4.5 on a rendered ground:\n  ${failures.join('\n  ')}`);
});

test('CONTROL: the values this replaced really do fail there', () => {
  /* Two controls, because the rule has two states and fixing only the rest
     state would have left hover at 1.63 - which is worse than what shipped. */
  for (const [name, ground] of LIGHT_GROUNDS.map(([n, g]) => [n, g] as [string, Rgb])) {
    const rest = contrastRatio([200, 137, 30], ground);   // #c8891e
    const hover = contrastRatio([232, 168, 56], ground);  // #e8a838
    assert.ok(rest < 4.5, `#c8891e now measures ${rest.toFixed(2)} on ${name}; the override may be unnecessary`);
    assert.ok(hover < 4.5, `#e8a838 now measures ${hover.toFixed(2)} on ${name}`);
  }
});

test('dark is untouched - the value the original comment measured is still there', () => {
  /* The fix must not "improve" the context that was already correct. #c8891e
     was measured at 6.42 against the dark ground and the issue is explicit that
     it has to stay. */
  assert.match(CSS, /\.arena-deep-locked\s*\{[^}]*color:\s*#c8891e\s*!important/,
    'the unscoped dark value changed; #769 asks for the light half only');
});
