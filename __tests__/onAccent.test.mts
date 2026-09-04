/* Nothing paints hardcoded white on the accent, and --on-accent clears where
 * it is used (#775).
 *
 * THE SHAPE. An accent chosen to be visible against a dark ground is by
 * construction a light colour. So "primary buttons are white on the accent" is
 * a convention that fails precisely when the accent is doing its job - and it
 * did: terminal dark's --accent-solid is #d9a626, where white measures 2.23:1.
 * Ten rules carried that pairing, and six of the eight routes in #775's count
 * were the same line showing up on different screens.
 *
 * A count grouped by where a failure appears hides that. This file is grouped
 * by what produces it: one token, one assertion, and a control that the token
 * is load-bearing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssColor, contrastRatio } from '../lib/readableOn.ts';

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
const CONTEXTS: Array<[string, Record<string, string>]> = [
  ['current dark', { ...root }],
  ['current light', { ...root, ...light }],
  ['terminal dark', { ...root, ...termDark }],
  ['terminal light', { ...root, ...light, ...termLight }],
];

/** A white COLOUR VALUE anywhere in a style object. No `color:` prefix: in
 *  JSX the declaration is comma-separated and the colour can sit either side
 *  of the background it pairs with.
 *
 *  The first version of this line went through a heredoc and a python -c and
 *  arrived with a literal BACKSPACE where each \\b was meant. It matched
 *  nothing, the JSX sweep reported clean, and only the control below caught
 *  it - a test that could never fail, which is the exact defect this suite
 *  keeps finding elsewhere. */
const WHITE_VALUE = /(#fff\b|#ffffff\b|'white'|"white")/i;
const WHITE = /color:\s*(#fff\b|#ffffff\b|white\b|rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*1\s*\))/i;

/** Declaration blocks that paint a background of var(--accent-solid). */
function accentSolidRules(): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/background(-color)?:\s*var\(--accent-solid\)/.test(m[2])) {
      out.push({ selector: m[1].trim().split('\n').pop()!.trim(), body: m[2] });
    }
  }
  return out;
}

test('the rule set is not empty - this check has something to check', () => {
  /* A selector that matches nothing returns a clean result. Ten rules were
     converted; if this ever drops to zero the sweep below is measuring air. */
  const rules = accentSolidRules();
  assert.ok(rules.length >= 8,
    `only ${rules.length} rules paint on --accent-solid; the regex has probably stopped matching`);
});

test('no rule hardcodes white on --accent-solid', () => {
  const offenders = accentSolidRules()
    .filter(r => WHITE.test(r.body))
    .map(r => r.selector);
  assert.deepEqual(offenders, [],
    `${offenders.length} rule(s) paint hardcoded white on --accent-solid: ${offenders.join(', ')}. ` +
    'Use var(--on-accent) - white measures 2.23:1 on terminal dark\'s #d9a626.');
});

test('--on-accent clears 4.5:1 on --accent-solid in all four contexts', () => {
  const failures: string[] = [];
  for (const [name, map] of CONTEXTS) {
    const bg = parseCssColor(resolve(map, 'var(--accent-solid)') ?? '');
    const fg = parseCssColor(resolve(map, 'var(--on-accent)') ?? '');
    assert.ok(bg && fg, `--accent-solid or --on-accent does not resolve in ${name}`);
    const c = contrastRatio(fg!.rgb, bg!.rgb);
    if (c < 4.5) failures.push(`${name}: ${c.toFixed(2)}`);
  }
  assert.deepEqual(failures, [], `--on-accent fails on --accent-solid: ${failures.join(', ')}`);
});

test('CONTROL: white really does fail there, so the token is doing the work', () => {
  /* Without this, the assertion above passes in every context where
     --on-accent IS white and proves nothing. Terminal dark is the context
     where the two differ, and it is the one that failed. */
  const map = { ...root, ...termDark };
  const bg = parseCssColor(resolve(map, 'var(--accent-solid)') ?? '')!;
  const white = contrastRatio([255, 255, 255], bg.rgb);
  assert.ok(white < 4.5,
    `white now measures ${white.toFixed(2)} on terminal dark's accent-solid; ` +
    'if the accent moved, --on-accent may no longer be load-bearing and this should be revisited.');
});

test('var(--accent) is NOT covered by this token, and nothing relies on it being', () => {
  /* White on the CURRENT design's --accent (#1a7aff) is 3.98 - so --on-accent,
     which is white there, does not rescue a rule that paints on --accent
     itself. Nothing does today. This is the check that notices if one starts,
     rather than a comment claiming it cannot happen. */
  const map = { ...root };
  const accent = parseCssColor(resolve(map, 'var(--accent)') ?? '')!;
  const on = parseCssColor(resolve(map, 'var(--on-accent)') ?? '')!;
  assert.ok(contrastRatio(on.rgb, accent.rgb) < 4.5,
    'current dark --on-accent now clears --accent; the caveat in globals.css can be relaxed');

  const onAccentRules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => /background(-color)?:\s*var\(--accent\)/.test(m[2]) && /color:\s*var\(--on-accent\)/.test(m[2]))
    .map(m => m[1].trim().split('\n').pop()!.trim())
    /* Scoped to rules that can reach the CURRENT design. A terminal-scoped rule
       painting --on-accent on --accent is correct - there the token is #08090a
       on gold, 8.95 - and flagging it would be the symmetry mistake this
       project keeps making. `.sshell-cta` is exactly that case. */
    .filter(sel => !sel.includes('[data-design="terminal"]'));
  assert.deepEqual(onAccentRules, [],
    `unscoped rule(s) paint var(--on-accent) on var(--accent): ${onAccentRules.join(', ')}. ` +
    'That pairing is 3.98 in the current design - measure it and give it its own token.');
});

/* ── AND THE SAME PAIRING IN JSX, WHICH THE STYLESHEET CHECK CANNOT SEE ────
 *
 * The assertion above reads globals.css and is TRUE. It stayed true while two
 * inline `style={{ background: 'var(--accent-solid)', color: '#fff' }}` props
 * on /upgrade kept failing at 2.23:1 - QA caught them on the post-deploy
 * sweep, after the fix, after the approval, with the suite green.
 *
 * That is a coverage boundary rather than a broken test, and it is the
 * sharpest instance of the day's pattern: THE TEST PASSING IS WHAT MADE THE
 * GAP INVISIBLE. Eleven rules were converted, the assertion covered exactly
 * those eleven, and nobody looked at the twelfth because the check that would
 * have looked was already green.
 *
 * So the boundary moves to where the pattern can occur, not to where it
 * happened to be found. */
const SRC_DIRS = ['app', 'components'];

/** Every .tsx under app/ and components/. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    return statSync(full).isDirectory()
      ? tsxFiles(full)
      : name.endsWith('.tsx') ? [full] : [];
  });
}

/* THE ONE EXEMPTION, BY NAME. app/global-error.tsx renders when the root
   layout has already failed, so no stylesheet is guaranteed. There
   var(--accent-solid) may resolve to nothing and the button falls back to
   transparent on that file's own #0d0d0d body - where white is the readable
   answer and var(--on-accent) would resolve to nothing at all. The fallback
   behaviour is the point, which is why eslint.config.mjs allow-lists the same
   file. Listed rather than filtered by a rule, so removing the exemption is a
   deliberate edit. */
const JSX_EXEMPT = new Set(['app/global-error.tsx']);

test('no JSX inline style pairs white with --accent-solid', () => {
  const offenders: string[] = [];
  for (const dir of SRC_DIRS) {
    for (const file of tsxFiles(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (JSX_EXEMPT.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      /* Brace-depth capture, not a regex over the whole file: a style object
         can contain a ternary, a template literal or a nested object, and
         `[^}]*` stops at the first one. Same lesson as #681. */
      for (const m of src.matchAll(/style=\{\{/g)) {
        const open = src.indexOf('{', m.index! + 6);
        let depth = 0, end = open;
        for (let i = open; i < src.length && i < open + 4000; i++) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        const obj = src.slice(open, end + 1);
        if (/var\(--accent-solid\)/.test(obj) && WHITE_VALUE.test(obj)) {
          offenders.push(`${rel} (offset ${m.index})`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [],
    `${offenders.length} inline style(s) pair white with --accent-solid: ${offenders.join(', ')}. ` +
    "Use 'var(--on-accent)' - white is 2.23:1 on terminal dark's #d9a626. " +
    'If this is genuinely a no-stylesheet context, add the file to JSX_EXEMPT with the reason.');
});

test('CONTROL: the JSX scan can actually see the shape it looks for', () => {
  /* The stylesheet assertion was true and useless for two lines of JSX. This
     control exists so the JSX one cannot become the same thing: it feeds the
     scanner the exact source that shipped the defect and requires a hit. */
  const shipped = `<div style={{ position: 'absolute', top: -11, fontSize: 'var(--fs-micro)', fontWeight: 700, color: '#fff', background: 'var(--accent-solid)', padding: '3px 12px' }}>`;
  assert.ok(/var\(--accent-solid\)/.test(shipped) && WHITE_VALUE.test(shipped),
    'the scan predicate no longer matches the /upgrade "Recommended" badge as it was written');

  /* And that a nested brace does not truncate the object before the colour. */
  const nested = `<div style={{ transform: \`translate(\${x}px)\`, background: 'var(--accent-solid)', color: '#fff' }}>`;
  assert.ok(WHITE_VALUE.test(nested), 'a template literal in the object breaks the predicate');
});
