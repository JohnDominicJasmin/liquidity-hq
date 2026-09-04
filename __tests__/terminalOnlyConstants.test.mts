/* Rule 1 of #663's convention, as a ratchet: a terminal-only component puts
 * constant typography in CSS, not inline.
 *
 * THE CONVENTION, ruled by QA on 2026-09-04 after dev declined to pick it:
 *
 *   1. A TERMINAL-ONLY component puts all typography and constant colour in
 *      CSS. There is no second design to serve, so a constant has no reason to
 *      be inline.
 *   2. In a DUAL-DESIGN component, inline is for COMPUTED values only.
 *
 * This file enforces rule 1. Rule 2 is not enforced here and the reason is
 * measured rather than assumed - see the note at the bottom.
 *
 * WHY COUNTS AND NOT AN ENUMERATED BASELINE. The #751 detector lists its 25
 * collisions individually, so fixing one requires deleting its line. That does
 * not scale here: there are 361 constant-inline typography declarations across
 * seven files, and QA's ruling on #663 was explicit that a PR fixing them
 * wholesale is "churn on shared chrome for no measured user-facing gain" and
 * that they should be worked "as the files are touched".
 *
 * So the ratchet is per-file counts. New code cannot add one; touching a file
 * to remove some lets the number fall. PER FILE rather than a total, so moving
 * debt from one component to another still fails - a single number would let
 * LandingTerminal's 169 absorb another file's additions silently.
 *
 * WHAT COUNTS AS A CONSTANT. A literal - a quoted string, a template literal,
 * or a number. `fontSize: 'var(--fs-caption)'` IS a constant by this
 * definition: the token adapts, but the decision to use that token is fixed at
 * write time and belongs in a stylesheet. `fontWeight: bold ? 700 : 400` is
 * not, and neither is `fontSize: size`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Terminal-only components, by the naming convention the codebase already
 *  uses: a `*Terminal.tsx` renders only under [data-design="terminal"]. */
function terminalOnlyFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    if (statSync(full).isDirectory()) return terminalOnlyFiles(full);
    return /Terminal\.tsx$/.test(name) ? [full] : [];
  });
}

/** Block comments blanked, newlines kept - the #785 lesson twice over: a
 *  scanner that reads comments counts its own explanations, and a strip that
 *  eats newlines breaks any line number computed afterwards. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

function objectAt(src: string, from: number): string {
  const open = src.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length && i < open + 4000; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
}

const TYPOGRAPHY = /(fontSize|fontWeight|fontFamily|letterSpacing|textTransform)\s*:\s*('[^']*'|`[^`]*`|[0-9.]+)/g;

function constantTypographyCount(file: string): number {
  const src = stripComments(readFileSync(file, 'utf8'));
  let n = 0;
  for (const m of src.matchAll(/style=\{\{/g)) {
    const obj = objectAt(src, m.index! + 6);
    for (const d of obj.matchAll(TYPOGRAPHY)) {
      /* A literal opens with a quote, a backtick or a digit. Anything else is
         an identifier or an expression - a computed value, which rule 2 allows
         and rule 1 does not forbid. */
      if (/^('|`|[0-9])/.test(d[2])) n++;
    }
  }
  return n;
}

/** Measured 2026-09-04. These only go DOWN. */
const BASELINE: Record<string, number> = {
  'components/BriefingTerminal.tsx': 43,
  'components/CorrelationTerminal.tsx': 9,
  'components/DashboardTerminal.tsx': 16,
  'components/FundingTerminal.tsx': 35,
  'components/LandingTerminal.tsx': 169,
  'components/LiqTerminal.tsx': 56,
  'components/MarketsTerminal.tsx': 33,
  'components/ScannerTerminal.tsx': 0,
};

test('the file set is the one the baseline was measured against', () => {
  /* A component renamed out of the *Terminal.tsx pattern would silently leave
     the sweep, and its count would vanish rather than fail. */
  const found = terminalOnlyFiles(path.join(ROOT, 'components'))
    .map(f => path.relative(ROOT, f).split(path.sep).join('/')).sort();
  assert.deepEqual(found, Object.keys(BASELINE).sort(),
    'the set of terminal-only components changed. A new one starts at 0 in ' +
    'BASELINE; a renamed one keeps its count under the new name.');
});

test('no terminal-only component gains a constant inline typography value', () => {
  const regressions: string[] = [];
  const improvements: string[] = [];
  for (const [rel, allowed] of Object.entries(BASELINE)) {
    const n = constantTypographyCount(path.join(ROOT, rel));
    if (n > allowed) regressions.push(`${rel}: ${allowed} -> ${n}`);
    if (n < allowed) improvements.push(`${rel}: ${allowed} -> ${n}`);
  }
  assert.deepEqual(regressions, [],
    `${regressions.length} file(s) added constant inline typography:\n  ${regressions.join('\n  ')}\n` +
    'Rule 1 of #663: a terminal-only component has no second design to serve, so ' +
    'a constant belongs in globals.css. Move it there rather than raising the number.');
  assert.deepEqual(improvements, [],
    `${improvements.length} file(s) improved - lower the BASELINE so the ratchet keeps its new position:\n  ${improvements.join('\n  ')}`);
});

test('CONTROL: the counter sees a constant and ignores a computed one', () => {
  /* Without this the ratchet passes on a counter that matches nothing, which
     is how a check becomes decoration. Both directions, because a counter that
     also counts computed values would fail every honest edit and get deleted.  */
  const constant = `<div style={{ fontSize: '12px', fontWeight: 700 }}>`;
  const computed = `<div style={{ fontSize: size, fontWeight: bold ? 700 : 400 }}>`;
  const count = (s: string) => {
    let n = 0;
    for (const m of s.matchAll(/style=\{\{/g)) {
      for (const d of objectAt(s, m.index! + 6).matchAll(TYPOGRAPHY)) {
        if (/^('|`|[0-9])/.test(d[2])) n++;
      }
    }
    return n;
  };
  assert.equal(count(constant), 2, 'the counter no longer sees constant typography');
  assert.equal(count(computed), 0, 'the counter is counting computed values, which rule 2 allows');
});

/* RULE 2 IS NOT ENFORCED HERE, AND THAT IS A MEASUREMENT NOT AN OMISSION.
 *
 * Rule 2 says a dual-design component may use inline only for computed values.
 * "Dual-design component" is every .tsx that is not a *Terminal.tsx, and a
 * constant inline value there is the codebase's normal idiom - the same sweep
 * over those files returns thousands, not hundreds.
 *
 * A ratchet at that size measures the codebase's age rather than its
 * discipline, and a number nobody can move is a number nobody reads. Rule 2
 * wants a lint rule that fires at the moment of writing, on the file being
 * edited, the way local/no-bare-hex-colour does - not a suite-wide count.
 * Recorded here so the next person does not conclude rule 2 was forgotten.
 */
