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
 * The reverse collision - a CSS `!important` beating a component's inline
 * value, which is #633's shape - IS covered, by the second assertion at the
 * foot of this file. It was not, when the paragraph above was first written;
 * that gap is what #663 called "a live exposure with no detector".
 *
 * ── THE CONVENTION THIS ENFORCES ──────────────────────────────────────────
 *
 * Ruled on #663 by QA on 2026-09-04, after dev declined to pick it. Written
 * here rather than left in an issue comment, because the rule has to be
 * findable from the code it governs:
 *
 *   1. A TERMINAL-ONLY component puts all typography and constant colour in
 *      CSS. There is no second design to serve, so a constant has no reason
 *      to be inline. `DashboardTerminal` and the `.csb2-*` rules are the
 *      pattern; #660 already did this.
 *
 *   2. In a DUAL-DESIGN component, inline is for COMPUTED values only - a
 *      colour derived from data, a width from a percentage, a transform from
 *      a measurement. Anything constant belongs in CSS. The test to apply:
 *      could this value have been written in a stylesheet? Then it should be.
 *
 * A third rule - banning `!important` under `[data-design="terminal"]`
 * outright - was DECLINED on sequencing, not on merit. Converting 53
 * declarations to higher-specificity selectors is a large mechanical change
 * across shared chrome, and #748 is about to make terminal the default on
 * every route; the risk lands exactly where the blast radius widens. It is
 * the right end state and gets its own issue once terminal-default has been
 * live long enough for a regression to be attributable.
 *
 * Both adopted rules describe which side SHOULD own a declaration. This file
 * detects only that both sides claim one - which is what makes it valid under
 * either rule, and why it does not try to auto-decide the fix.
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

/** A terminal rule's LAST compound selector, as the set of classes an element
 *  must carry for that rule to apply, plus the typography properties it sets.
 *
 *  Compound selectors have to stay compound. `[data-design="terminal"]
 *  .tnav-item.on` applies only to an element with BOTH classes - flattening it
 *  to `.tnav-item` and `.on` separately credits `.on` with a font-weight it
 *  does not own, and then every `className={`ps-preset${x ? ' on' : ''}`}` in
 *  the codebase looks like a collision. That produced 8 false positives out of
 *  31 on the first honest run, and a check that cries wolf gets switched off.
 *
 *  Only the last sequence matters: ancestors restrict WHICH elements match, so
 *  ignoring them can over-report but never under-report, and over-reporting on
 *  an ancestor is rare enough to accept against parsing full descendant paths. */
interface Owned { need: string[]; props: Set<string>; important: Set<string> }

function terminalRules(props_: Array<[string, string]> = PROPS): Owned[] {
  const css = readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');
  const out: Owned[] = [];
  const rule = /\[data-design="terminal"\][^{}]*\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(css)) !== null) {
    const selector = css.slice(m.index, m.index + m[0].indexOf('{'));
    const body = m[1];
    const props = new Set<string>();
    const important = new Set<string>();
    for (const [cssProp] of props_) {
      const decl = new RegExp('(^|;|\\s)' + cssProp + '\\s*:([^;]*)').exec(body);
      if (!decl) continue;
      props.add(cssProp);
      /* WHICH SIDE WINS IS THE POINT (#663). Without !important the inline
         value outranks every selector and the CSS rule is dead - #629 and
         #660. With it the CSS wins and the component's inline value is dead
         instead - #633. Both are a declaration lying about what it does, but
         the fix is opposite, so the report has to say which. */
      if (decl[2].includes('!important')) important.add(cssProp);
    }
    if (props.size === 0) continue;
    /* Each comma-separated selector contributes its own last compound group. */
    for (const one of selector.split(',')) {
      const last = one.trim().split(/\s+|>/).filter(Boolean).pop() ?? '';
      const need = [...last.matchAll(/\.([A-Za-z0-9_-]+)/g)].map(c => c[1]);
      if (need.length) out.push({ need, props, important });
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

/** Extract a whole `style={{ … }}` object by BRACE DEPTH, not by regex.
 *
 *  QA's review of #681 planted five shapes; the regex version, which captured
 *  with `[^}]{0,600}`, missed two:
 *
 *      DETECTED  style={{ fontSize: 12 }}
 *      DETECTED  style={{ color: up ? 'a' : 'b', fontSize: 12 }}
 *      MISSED    style={{ transform: `translate(${x}px)`, fontSize: 12 }}
 *      MISSED    style={{ ...(up ? { a: 1 } : { b: 2 }), fontSize: 12 }}
 *
 *  `[^}]` stops at the FIRST `}` whatever the nesting, so a template literal or
 *  a nested object ends the capture before the property is reached. The ternary
 *  survived only because it contains no braces - so the shapes that slipped
 *  through were the ones that look most like the real code in this repo.
 *
 *  Depth counting handles both for free: `${` opens a brace its own `}` closes,
 *  so the walk stays inside the object.
 *
 *  Known limit, stated rather than left to be found: a brace inside a string
 *  literal is counted. That can only make a capture too LONG - a false positive
 *  someone will look at, never a silent miss. */
function styleObjectAt(src: string, styleIdx: number): string {
  const open = src.indexOf('{', styleIdx);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length && i < open + 4000; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
}

const STYLE_AT = /style=\{\{/g;

/** Collisions between a terminal-owned property and an inline style on the
 *  same element, in either attribute order. */
function collisions(source: string, rules: Owned[], props_: Array<[string, string]> = PROPS): string[] {
  const hits: string[] = [];
  const styles: Array<{ idx: number; obj: string }> = [];
  let m: RegExpExecArray | null;
  STYLE_AT.lastIndex = 0;
  while ((m = STYLE_AT.exec(source)) !== null) {
    styles.push({ idx: m.index, obj: styleObjectAt(source, m.index) });
  }

  for (const { need, props, important } of rules) {
    /* EVERY class in the compound must be present, not any. */
    const res = need.map(c => new RegExp('\\b' + c + '\\b'));
    for (const { idx, obj } of styles) {
      const before = source.slice(Math.max(0, idx - 600), idx);
      const after  = source.slice(idx + obj.length, idx + obj.length + 600);
      const attr = (before.match(/className=[^>]*$/) ?? [''])[0] + ' ' +
                   (after.match(/^[^>]*className=[^>]*/) ?? [''])[0];
      if (!res.every(r => r.test(attr))) continue;
      for (const [cssProp, jsxProp] of props_) {
        if (props.has(cssProp) && new RegExp('\\b' + jsxProp + '\\s*:').test(obj)) {
          /* The direction is decided by !important, and it decides the fix.
             Reported as two distinct sentences rather than one neutral
             "collision", because "delete the CSS rule" and "delete the inline
             value" are opposite instructions and the reader needs the right
             one without re-deriving the cascade. */
          hits.push(important.has(cssProp)
            ? '.' + need.join('.') + ' — the terminal rule\'s ' + cssProp +
              ' !important kills inline ' + jsxProp
            : '.' + need.join('.') + ' — inline ' + jsxProp +
              " kills the terminal rule's " + cssProp);
        }
      }
    }
  }
  return [...new Set(hits)];
}

const RULES = terminalRules();

test('the check is armed', () => {
  /* An empty rule list would make every file below pass while testing nothing
     - the failure this whole class of defect is made of. */
  assert.ok(RULES.length > 20, 'only ' + RULES.length + ' terminal typography rules parsed; the CSS walk probably broke');
});

test('it detects a planted collision, in both attribute orders', () => {
  /* Positive control, built from a real rule so it stays valid as classes
     change. Without it, a clean sweep proves only that the sweep ran - and
     twice already on this file it was running and matching nothing. */
  const r = RULES.find(x => x.props.has('font-size') && x.need.length === 1)!;
  const cls = r.need[0];
  const fwd = '<span className="' + cls + '" style={{ fontSize: 12 }}>x</span>';
  const rev = '<span style={{ fontSize: 12 }} className="' + cls + '">x</span>';
  assert.equal(collisions(fwd, RULES).length, 1, 'missed the forward order on .' + cls);
  assert.equal(collisions(rev, RULES).length, 1, 'missed the reversed order on .' + cls);
});

test('a nested object or template literal does not hide the property', () => {
  /* QA's #681 review: the old regex captured with [^}] and stopped at the
     first closing brace, so these two shapes - the ones that look most like
     real code here - slipped through silently. */
  const r = RULES.find(x => x.props.has('font-size') && x.need.length === 1)!;
  const cls = r.need[0];
  const tpl = '<span className="' + cls + '" style={{ transform: `translate(${x}px)`, fontSize: 12 }}>x</span>';
  const spread = '<span className="' + cls + '" style={{ ...(up ? { a: 1 } : { b: 2 }), fontSize: 12 }}>x</span>';
  assert.equal(collisions(tpl, RULES).length, 1, 'a template literal hid the property');
  assert.equal(collisions(spread, RULES).length, 1, 'a nested object hid the property');
});

test('a compound rule does not accuse an element carrying only one of its classes', () => {
  /* [data-design="terminal"] .tnav-item.on owns font-weight, but an element that
     is merely .on does not match it. Flattening compounds produced 8 false
     positives out of 31, and a check that cries wolf gets switched off. */
  const compound = RULES.find(x => x.need.length > 1);
  assert.ok(compound, 'no compound rule found; this guard is not testing anything');
  const only = '<button className="ps-preset ' + compound!.need[compound!.need.length - 1] + '" style={{ fontWeight: 700 }}>x</button>';
  assert.equal(collisions(only, RULES).length, 0, 'accused an element carrying only part of a compound selector');
});

test('no component sets a property inline that a terminal rule already owns', () => {
  const files = [...tsxFiles(path.join(ROOT, 'components')), ...tsxFiles(path.join(ROOT, 'app'))];
  assert.ok(files.length > 50, 'found only ' + files.length + ' tsx files; the walk probably broke');

  const found: string[] = [];
  for (const f of files) {
    for (const hit of collisions(readFileSync(f, 'utf8'), RULES)) {
      found.push(path.relative(ROOT, f).replace(/\\/g, '/') + ': ' + hit);
    }
  }
  assert.deepEqual(found, [],
    found.length + ' dead terminal rule(s). An inline style outranks every selector, so the ' +
    'CSS rule can never apply - see #629, #633, #660. Move the value to globals.css, or if ' +
    'the component genuinely needs it inline, delete the CSS rule so nothing claims to own it.');
});

/* ── THE OTHER SEVEN PROPERTIES, AND BOTH DIRECTIONS (#663) ────────────────
 *
 * The assertion above covers typography and holds at zero. It was never the
 * whole exposure: #663 counted 53 terminal rules using `!important` across
 * background, border, border-radius, color, display, margin and padding, and
 * called that "a live exposure with no detector".
 *
 * This is that detector. It reports the same collision in both directions,
 * because the fix is opposite depending on which side carries `!important`:
 *
 *     inline kills the CSS rule    the rule is dead      #629, #660
 *     CSS !important kills inline  the inline is dead    #633
 *
 * WHY A FROZEN LIST RATHER THAN ZERO. There are 25 today and they are not all
 * defects - `.edge-card-value`'s inline `color` is a data-driven value where
 * the CSS colour is a deliberate fallback, and several `.card` entries are
 * components legitimately styling a generic class. Asserting zero would mean
 * either 25 edits I cannot justify or an exemption list longer than the check.
 *
 * So the list is enumerated, not counted. A new collision fails; fixing one
 * fails until its line is removed; swapping one for another fails. That is a
 * ratchet rather than a suppression, and it is the shape #663 asked for -
 * "the instances are the symptom, the missing rule is the defect".
 *
 * TWO ENTRIES ARE #633's SHAPE AND WERE INVISIBLE UNTIL NOW: `.skel-bar` and
 * `.locked-card-term-wrap` both set an inline borderRadius that a terminal
 * `!important` overrides. Neither is harmful - terminal wants zero radius and
 * gets it - but both are inline values that do nothing, which is exactly the
 * class that cost three computed-value investigations. */
const WIDE_PROPS: Array<[css: string, jsx: string]> = [
  ['background',    'background'],
  ['border',        'border'],
  ['border-radius', 'borderRadius'],
  ['color',         'color'],
  ['display',       'display'],
  ['margin',        'margin'],
  ['padding',       'padding'],
];

const WIDE_BASELINE = [
  'app/correlation/page.tsx: .card — inline background kills the terminal rule\'s background',
  'app/correlation/page.tsx: .card — inline border kills the terminal rule\'s border',
  'app/dashboard/page.tsx: .edge-card-signal — inline color kills the terminal rule\'s color',
  'app/dashboard/page.tsx: .edge-card-value — inline color kills the terminal rule\'s color',
  'app/funding/page.tsx: .card — inline padding kills the terminal rule\'s padding',
  'app/liq/page.tsx: .card — inline padding kills the terminal rule\'s padding',
  'components/BriefingTerminal.tsx: .mb-cvd-chip — inline borderRadius kills the terminal rule\'s border-radius',
  'components/BriefingTerminal.tsx: .mb-event-tag — inline borderRadius kills the terminal rule\'s border-radius',
  'components/CoinMarketSnapshot.tsx: .edge-card-signal — inline color kills the terminal rule\'s color',
  'components/CoinMarketSnapshot.tsx: .edge-card-value — inline color kills the terminal rule\'s color',
  'components/CorrelationTerminal.tsx: .corr-cell — inline borderRadius kills the terminal rule\'s border-radius',
  'components/CorrelationTerminal.tsx: .corr-pair-bar — inline borderRadius kills the terminal rule\'s border-radius',
  'components/CorrelationTerminal.tsx: .corr-pair-bar-wrap — inline borderRadius kills the terminal rule\'s border-radius',
  'components/DashboardTerminal.tsx: .edge-card-signal — inline color kills the terminal rule\'s color',
  'components/DashboardTerminal.tsx: .edge-card-value — inline color kills the terminal rule\'s color',
  'components/FundingTerminal.tsx: .frh-signal — inline borderRadius kills the terminal rule\'s border-radius',
  'components/LandingTerminal.tsx: .card — inline background kills the terminal rule\'s background',
  'components/LandingTerminal.tsx: .card — inline padding kills the terminal rule\'s padding',
  'components/SetupScanner.tsx: .card — inline background kills the terminal rule\'s background',
  'components/Skeleton.tsx: .card — inline padding kills the terminal rule\'s padding',
  'components/Skeleton.tsx: .skel-bar — the terminal rule\'s border-radius !important kills inline borderRadius',
  'components/UpgradeGateModal.tsx: .card — inline background kills the terminal rule\'s background',
  'components/UpgradeGateModal.tsx: .card — inline border kills the terminal rule\'s border',
  'components/UpgradeGateModal.tsx: .card — inline padding kills the terminal rule\'s padding',
  'components/UpgradeGateModal.tsx: .locked-card-term-wrap — the terminal rule\'s border-radius !important kills inline borderRadius',
].sort();

const WIDE_RULES = terminalRules(WIDE_PROPS);

test('the wide check is armed', () => {
  assert.ok(WIDE_RULES.length > 20,
    'only ' + WIDE_RULES.length + ' terminal rules parsed for the wide property set; the CSS walk probably broke');
  assert.ok(WIDE_RULES.some(r => r.important.size > 0),
    'no terminal rule parsed as carrying !important - the direction half of this check is measuring nothing');
});

test('no NEW declaration collision, in either direction', () => {
  const files = [...tsxFiles(path.join(ROOT, 'components')), ...tsxFiles(path.join(ROOT, 'app'))];
  const found: string[] = [];
  for (const f of files) {
    for (const hit of collisions(readFileSync(f, 'utf8'), WIDE_RULES, WIDE_PROPS)) {
      found.push(path.relative(ROOT, f).split(path.sep).join('/') + ': ' + hit);
    }
  }
  found.sort();

  const added = found.filter(x => !WIDE_BASELINE.includes(x));
  const fixed = WIDE_BASELINE.filter(x => !found.includes(x));

  assert.deepEqual(added, [],
    added.length + ' NEW collision(s). One of the two declarations does nothing - ' +
    'the message says which. Move the value to the side that should own it, or ' +
    'delete the one that loses.');
  assert.deepEqual(fixed, [],
    fixed.length + ' baseline entr(y/ies) no longer collide - good. Delete them from ' +
    'WIDE_BASELINE so the ratchet keeps its new position.');
});
