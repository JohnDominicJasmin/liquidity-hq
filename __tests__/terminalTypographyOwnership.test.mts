/* No inline style may set a property that a terminal CSS rule also sets (#663).
 *
 * An inline declaration outranks every selector, so when both exist the CSS
 * rule is DEAD - not losing a specificity contest, unreachable. Three defects
 * shipped that way (#629, #633, #660), and none was visible in source: the rule
 * looked right in globals.css and the inline style looked right in the
 * component. All three were found only by reading computed values.
 *
 * #663 argues that a convention cannot fix this, because a convention has to be
 * recalled at the moment of writing by someone who has not read the file that
 * got it right. This is the check version. It currently finds ZERO, so it is a
 * ratchet rather than a cleanup - it exists to keep the fourth from shipping.
 *
 * SCOPE, deliberately narrow: typography properties only, and only classes that
 * a [data-design="terminal"] rule actually styles. Colour and layout are
 * legitimately set inline all over this codebase - from data, from state - and
 * flagging those would bury the real case, which is the mistake #666's first
 * version made in the other direction by flagging `button, input`.
 *
 * The reverse collision - a CSS `!important` beating a component's inline value,
 * which is #633's shape - is NOT covered here. 53 terminal rules use
 * `!important` across background, border, border-radius, color, display, margin
 * and padding. That is a live exposure with no detector, and it is recorded on
 * #663 rather than silently implied to be handled.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Properties where an inline value silently kills a stylesheet rule and the
 *  result is a wrong-looking page nobody can explain from source. */
const PROPS: Array<[css: string, jsx: string]> = [
  ['font-size',      'fontSize'],
  ['font-family',    'fontFamily'],
  ['font-weight',    'fontWeight'],
  ['letter-spacing', 'letterSpacing'],
  ['text-transform', 'textTransform'],
];

/** class -> set of css properties a terminal rule sets on it. */
function terminalRules(): Map<string, Set<string>> {
  const css = readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');
  const out = new Map<string, Set<string>>();
  const rule = /\[data-design="terminal"\][^{}]*\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(css)) !== null) {
    const selector = css.slice(m.index, m.index + m[0].indexOf('{'));
    const body = m[1];
    const classes = [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map(c => c[1]);
    for (const [cssProp] of PROPS) {
      if (!new RegExp(`(^|;|\\s)${cssProp}\\s*:`).test(body)) continue;
      for (const cls of classes) {
        if (!out.has(cls)) out.set(cls, new Set());
        out.get(cls)!.add(cssProp);
      }
    }
  }
  return out;
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith('.tsx') ? [full] : [];
  });
}

/** Find `<tag className="… cls …" … style={{ … prop: … }}>` in either order. */
function collisions(source: string, rules: Map<string, Set<string>>): string[] {
  const hits: string[] = [];
  for (const [cls, props] of rules) {
    const patterns = [
      new RegExp(`className=\\{?["\`][^"\`]*\\b${cls}\\b[^"\`]*["\`][^>]{0,600}?style=\\{\\{([^}]{0,600})`, 'gs'),
      new RegExp(`style=\\{\\{([^}]{0,600}?)\\}\\}[^>]{0,600}?className=\\{?["\`][^"\`]*\\b${cls}\\b`, 'gs'),
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        for (const [cssProp, jsxProp] of PROPS) {
          if (!props.has(cssProp)) continue;
          if (new RegExp(`\\b${jsxProp}\\s*:`).test(m[1])) {
            hits.push(`.${cls} — inline ${jsxProp} kills the terminal rule's ${cssProp}`);
          }
        }
      }
    }
  }
  return [...new Set(hits)];
}

const RULES = terminalRules();

test('the check is armed', () => {
  /* A rule map that came back empty would make every file below pass while
     testing nothing - the failure this whole class of defect is made of. */
  assert.ok(RULES.size > 20, `only ${RULES.size} terminal classes set typography; the CSS parse probably broke`);
});

test('it detects a planted collision', () => {
  /* Positive control. A clean sweep proves only that it ran unless the sweep
     is known to be able to fail. Built from a real class in the map, so this
     stays valid if class names change. */
  const [cls, props] = [...RULES.entries()].find(([, p]) => p.has('font-size'))!;
  assert.ok(props.has('font-size'));
  const planted = `<span className="${cls}" style={{ fontSize: 'var(--fs-caption)' }}>x</span>`;
  assert.equal(collisions(planted, RULES).length, 1, `failed to detect a planted inline font-size on .${cls}`);
  const reversed = `<span style={{ fontSize: '12px' }} className="${cls}">x</span>`;
  assert.equal(collisions(reversed, RULES).length, 1, 'failed to detect the reversed attribute order');
});

test('no component sets a property inline that a terminal rule already owns', () => {
  const files = [...tsxFiles(path.join(ROOT, 'components')), ...tsxFiles(path.join(ROOT, 'app'))];
  assert.ok(files.length > 50, `found only ${files.length} tsx files; the walk probably broke`);

  const found: string[] = [];
  for (const f of files) {
    for (const hit of collisions(readFileSync(f, 'utf8'), RULES)) {
      found.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}: ${hit}`);
    }
  }
  assert.deepEqual(found, [],
    `${found.length} dead terminal rule(s). An inline style outranks every selector, so the CSS ` +
    `rule can never apply - see #629, #633, #660. Move the value to globals.css, or if the ` +
    `component genuinely needs it inline, delete the CSS rule so nothing claims to own it.`);
});
