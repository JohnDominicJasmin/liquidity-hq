/* --txt-stamp clears every ground the market-structure age stamp can land on
 * (#771).
 *
 * WHY A TEST AND NOT A MEASUREMENT. `.ms-last-event` takes an inline
 * `background: evBg(le)` - a 10% tint of the LATEST EVENT's own colour, gold
 * for a CHoCH, red for bearish, green for bullish. The ground therefore depends
 * on what the market last did, and a browser can only ever show the one state
 * that is live. Three separate rendered measurements of this element were taken
 * on 2026-09-04; each saw a different tint, and two of them were wrong for
 * unrelated parsing reasons. A test can composite all twelve grounds at once,
 * which is the only instrument that covers the case.
 *
 * WHY 5.0 AND NOT 4.5. The binding ground measured 4.49 with the previous
 * token. A hundredth of margin on a ground that changes with the market is not
 * a fix, it is the same defect with better luck.
 *
 * WHAT #641 GOT WRONG, since this replaces it. Its rule was scoped
 * [data-design="terminal"], and its comment quoted "4.78 / 5.07 / 4.87 dark" -
 * those are TERMINAL dark. The current design's dark figures are 4.65 / 4.56 /
 * 4.41, it never received the rule at all, and its bull-green ground failed
 * outright. Measured against one context, applied to another; the same shape as
 * #750 and #769 on the same day.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssColor, compositeOver, contrastRatio, type Rgb } from '../lib/readableOn.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');

const TARGET = 5.0;

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

/* All four, because the rule is unscoped now and the current design is the one
   that was never covered. */
const CONTEXTS: Array<[string, Record<string, string>]> = [
  ['current dark', { ...root }],
  ['current light', { ...root, ...light }],
  ['terminal dark', { ...root, ...termDark }],
  ['terminal light', { ...root, ...light, ...termLight }],
];

/* MarketStructure.tsx's evBg(): --accent for a CHoCH, --red bearish,
   --green-2 bullish, all at 10%. --bg1 is .ms-card's declared background;
   --bg2 is included because the component is not pinned to one surface and a
   token this narrow should survive being moved one level. */
const TINTS = ['var(--accent)', 'var(--red)', 'var(--green-2)'];
const SURFACES = ['--bg1', '--bg2'];

function groundsFor(map: Record<string, string>): Array<{ label: string; rgb: Rgb }> {
  const out: Array<{ label: string; rgb: Rgb }> = [];
  for (const tint of TINTS) {
    const t = parseCssColor(resolve(map, tint) ?? '');
    assert.ok(t, `tint ${tint} does not resolve to a colour`);
    for (const surface of SURFACES) {
      const bg = parseCssColor(resolve(map, `var(${surface})`) ?? '');
      assert.ok(bg, `${surface} does not resolve to a colour`);
      out.push({
        label: `${tint.replace('var(--', '').replace(')', '')} 10% over ${surface}`,
        rgb: compositeOver(t!.rgb, bg!.rgb, 0.10),
      });
    }
  }
  return out;
}

test('the ground set is the size it claims to be', () => {
  /* Twelve grounds is the whole argument for the token. If this ever counts
     fewer, the sweep below is passing on a subset and the margin it reports is
     not the margin that ships. */
  let total = 0;
  for (const [, map] of CONTEXTS) total += groundsFor(map).length;
  assert.equal(total, 24, `expected 6 grounds x 4 contexts = 24, built ${total}`);
});

test('--txt-stamp clears 5.0 on every event tint, surface and context', () => {
  const failures: string[] = [];
  for (const [name, map] of CONTEXTS) {
    const stamp = parseCssColor(resolve(map, 'var(--txt-stamp)') ?? '');
    assert.ok(stamp, `--txt-stamp does not resolve in ${name}`);
    for (const g of groundsFor(map)) {
      const c = contrastRatio(stamp!.rgb, g.rgb);
      if (c < TARGET) failures.push(`${name}: ${g.label} -> ${c.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, [],
    `${failures.length} ground(s) below ${TARGET}:\n  ${failures.join('\n  ')}`);
});

test('CONTROL: the tokens this replaced really do fail these grounds', () => {
  /* Without this, the sweep above proves only that it ran. Both previous
     answers are checked, because the issue had two halves: terminal was on
     --txt2 and the current design was left on --txt3. */
  const failed: string[] = [];
  for (const [name, map] of CONTEXTS) {
    for (const tok of ['var(--txt2)', 'var(--txt3)']) {
      const c0 = parseCssColor(resolve(map, tok) ?? '');
      if (!c0) continue;
      for (const g of groundsFor(map)) {
        if (contrastRatio(c0!.rgb, g.rgb) < TARGET) { failed.push(`${name} ${tok}`); break; }
      }
    }
  }
  assert.ok(failed.length >= 4,
    `expected the old tokens to fail in every context; only ${failed.length} did (${failed.join(', ')}). ` +
    'If they now pass, --txt-stamp is no longer load-bearing and this should be revisited rather than kept as cargo.');
});

test('the stylesheet actually uses the token, and only where it was measured', () => {
  /* A token nothing references is a decoration, and a token applied wider than
     it was measured is a claim nobody checked. Both are failure modes this
     project has shipped. */
  assert.match(CSS, /\.ms-ev-ago\s*\{[^}]*color:\s*var\(--txt-stamp\)/,
    '.ms-ev-ago does not take --txt-stamp');
  const uses = [...CSS.matchAll(/var\(--txt-stamp\)/g)].length;
  assert.equal(uses, 1,
    `--txt-stamp is referenced ${uses} times. It was measured against ONE element's ` +
    'grounds; every additional use needs its own grounds added to this file first.');
  assert.doesNotMatch(CSS, /\[data-design="terminal"\][^{]*\.ms-ev-ago/,
    'the terminal-scoped .ms-ev-ago override is back - the base rule already ' +
    'covers both designs, and scoping it is what left the current design failing');
});
