/* Every background token resolves in every context (#783).
 *
 * --bg0 was declared at :root and in both terminal blocks, and NOT in the
 * current design's light block. So `var(--bg0)` in a light, non-terminal
 * context fell through to :root's #030405 - near-black behind light text, no
 * error, nothing failing.
 *
 * Nothing rendered wrong, and that is the interesting part. The two places
 * that reach for it had already been worked around: the html background rule
 * was SPLIT into a literal for the current design and a token for terminal,
 * specifically to dodge this, and its comment says so in as many words. The
 * workaround was correct; the hole it dodged stayed open for the next caller.
 * A defect that has been routed around is still a defect, and it is harder to
 * see precisely because the route around it works.
 *
 * This test is the general version: not "is --bg0 declared in light" but "does
 * every background token resolve to a real colour in all four contexts", so
 * the next token added to three blocks out of four fails here rather than
 * being discovered by a probe measuring a near-black ground it never renders
 * on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssColor, relativeLuminance } from '../lib/readableOn.ts';

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
const termDark = tokens('[data-design="terminal"]:not([data-theme="light"])');
const termLight = tokens('[data-design="terminal"][data-theme="light"]');

const DARK_CONTEXTS: Array<[string, Record<string, string>]> = [
  ['current dark', { ...root }],
  ['terminal dark', { ...root, ...termDark }],
];
const LIGHT_CONTEXTS: Array<[string, Record<string, string>]> = [
  ['current light', { ...root, ...light }],
  ['terminal light', { ...root, ...light, ...termLight }],
];
const ALL = [...DARK_CONTEXTS, ...LIGHT_CONTEXTS];

const BG_TOKENS = ['--bg0', '--bg1', '--bg2', '--bg3', '--bg4'];

test('every background token resolves to a colour in all four contexts', () => {
  const missing: string[] = [];
  for (const [name, map] of ALL) {
    for (const tok of BG_TOKENS) {
      const raw = resolve(map, `var(${tok})`);
      if (!raw || !parseCssColor(raw)) missing.push(`${name}: ${tok} -> ${raw ?? 'unresolved'}`);
    }
  }
  assert.deepEqual(missing, [], `background token(s) that do not resolve:\n  ${missing.join('\n  ')}`);
});

test('no light context inherits a DARK background value', () => {
  /* The failure #783 actually was. A token declared only at :root resolves
     fine - it just resolves to the wrong theme's colour, which is why "does it
     resolve" alone would have passed while --bg0 was near-black in light.
     Luminance is the tell: every light-theme surface is light. */
  const wrong: string[] = [];
  for (const [name, map] of LIGHT_CONTEXTS) {
    for (const tok of BG_TOKENS) {
      const c = parseCssColor(resolve(map, `var(${tok})`) ?? '');
      if (!c) continue;
      const l = relativeLuminance(c.rgb);
      if (l < 0.5) wrong.push(`${name}: ${tok} luminance ${l.toFixed(3)} - a dark value in a light theme`);
    }
  }
  assert.deepEqual(wrong, [], `${wrong.length} light-theme background(s) inherited from a dark block:\n  ${wrong.join('\n  ')}`);
});

test('no dark context inherits a LIGHT background value', () => {
  /* The mirror image, so the check is not one-directional. Nothing fails this
     today; it exists so a token added to the light block alone is caught by the
     same file rather than by a different investigation. */
  const wrong: string[] = [];
  for (const [name, map] of DARK_CONTEXTS) {
    for (const tok of BG_TOKENS) {
      const c = parseCssColor(resolve(map, `var(${tok})`) ?? '');
      if (!c) continue;
      const l = relativeLuminance(c.rgb);
      if (l > 0.5) wrong.push(`${name}: ${tok} luminance ${l.toFixed(3)} - a light value in a dark theme`);
    }
  }
  assert.deepEqual(wrong, [], `${wrong.length} dark-theme background(s) inherited from a light block:\n  ${wrong.join('\n  ')}`);
});

test('CONTROL: the check can see a token that is missing from one block', () => {
  /* Feed it the pre-fix state - --bg0 absent from the light block - and require
     both the resolve check to pass and the luminance check to fail, which is
     exactly the shape that made this invisible: it resolved, to the wrong
     theme's colour. */
  /* The pre-fix cascade is root's --bg0 surviving because the light block
     declared none - NOT the token being absent altogether. Deleting it models
     a different bug: it makes the value unresolvable, which the first
     assertion would then catch, and the whole point is that the real one
     resolved cleanly. */
  const preFix = { ...root, ...light, '--bg0': root['--bg0'] };
  const raw = resolve(preFix, 'var(--bg0)');
  assert.ok(raw && parseCssColor(raw), 'the pre-fix state should still RESOLVE - that is why it was invisible');
  assert.ok(relativeLuminance(parseCssColor(raw!)!.rgb) < 0.5,
    'the pre-fix --bg0 no longer reads as a dark value in a light context; this control is stale');
});

test('the html light background takes the token rather than a literal', () => {
  /* The split rule existed only because the token could not be used here. It
     can now, and a literal that has to stay in step with a token is one more
     thing to keep in step. */
  assert.match(CSS, /html\[data-theme="light"\]\s*\{\s*background:\s*var\(--bg0\)/,
    'the html light background is not taking var(--bg0)');
  assert.doesNotMatch(CSS, /html\[data-theme="light"\]:not\(\[data-design="terminal"\]\)\s*\{\s*background:\s*#E8EAED/,
    'the old split rule is back - if it is needed again, --bg0 has probably been removed from the light block');
});
