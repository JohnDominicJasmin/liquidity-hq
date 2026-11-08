/* #1111 Pattern A: the `design` switch is GONE, and this is the source-level guard for that.
 *
 * THE RULING, verbatim from `components/RootDocument.tsx:80-85`, which is the governing statement:
 *
 *     "data-design is a static attribute on <html> (#1111). It used to be resolved from ?design= and
 *      localStorage by an inline script and by DesignModeProvider; with the current-design markup
 *      deleted from every page, the only thing that switch could still do was strip the terminal
 *      tokens off terminal markup. So it is gone, `?design=` no longer does anything, and a stale
 *      `lhq-design-mode` value in someone's storage is simply never read."
 *
 * Accepted per #1139's owner-relayed ruling on #1111.
 *
 * WHY A SOURCE TEST AND NOT ONLY A BROWSER ONE. The runtime half lives in
 * `qa/e2e/terminal-default.spec.ts` and asserts the param is inert. But a browser can only show that
 * the param does nothing TODAY, on the pages it visits. If someone reintroduces a reader, the runtime
 * cells catch it only where they happen to look, and `?design=` has a reader on every route at once
 * or none. The absence of a reader is a property of the repository, so it is cheaper and stricter to
 * assert it there.
 *
 * It is also the half that survives the environment. The three runtime cells this replaces were red
 * in every CI run for weeks because they asserted an escape hatch that had been deliberately deleted
 * - my stale expectation, not a product defect. A guard derived from the ruling cannot rot that way:
 * if the ruling is reversed, THIS file fails and says so, which is the correct place for the argument
 * to happen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = ['app', 'components', 'lib'].flatMap(d => walk(join(repoRoot, d)));
/* Comments are stripped because every surviving mention of `?design=` in this repo is a comment
   explaining the removal - including the ruling quoted above. A plain grep reports those as readers
   and would make D2/D3 fail on the very text that documents why they pass. */
const sources = files.map(f => ({ rel: relative(repoRoot, f).replace(/\\/g, '/'), code: stripTsComments(readFileSync(f, 'utf8')) }));

test('D1. CONTROL: the scan sees a real tree, and RootDocument still hardcodes data-design="terminal"', () => {
  /* Without this, "no file reads the param" is also what a broken scan returns - and D2/D3 would pass
     loudest exactly when they were measuring nothing. */
  assert.ok(sources.length > 200, `only ${sources.length} source files found - the scan is broken, so D2/D3 below prove nothing`);
  const root = sources.find(s => s.rel === 'components/RootDocument.tsx');
  assert.ok(root, 'components/RootDocument.tsx not found - re-derive this guard');
  assert.match(
    root!.code, /<html[^>]*\sdata-design="terminal"/,
    'RootDocument no longer hardcodes data-design="terminal" on <html>. If the switch is coming back, this guard is the right place to argue about it.',
  );
});

test('D2. no non-comment line reads a `design` query param', () => {
  const offenders = sources
    .filter(s => /(searchParams|params|query|URLSearchParams)[^\n]{0,40}\.get\(\s*['"`]design['"`]\s*\)/.test(s.code)
              || /\bdesign=current\b/.test(s.code))
    .map(s => s.rel);
  assert.deepEqual(offenders, [], `these files read a design param, which #1111 removed: ${offenders.join(', ')}`);
});

test('D3. nothing reads or writes the stale `lhq-design-mode` storage key', () => {
  /* The ruling promises a stale value "is simply never read". Someone who used the hatch before #1111
     still has 'current' in their storage, so a reintroduced read regresses exactly those users and
     nobody else - which is why it would not show up in casual testing. */
  const offenders = sources.filter(s => /lhq-design-mode/.test(s.code)).map(s => s.rel);
  assert.deepEqual(offenders, [], `these files touch lhq-design-mode: ${offenders.join(', ')}`);
});

test('D4. the deleted modules stay deleted', () => {
  for (const p of ['lib/designMode.ts', 'components/DesignModeProvider.tsx']) {
    assert.equal(existsSync(join(repoRoot, p)), false, `${p} is back - #1111 step 8 removed it`);
  }
});

test('D5. data-design is never set dynamically - it is a static attribute, not state', () => {
  const offenders = sources.filter(s => /setAttribute\(\s*['"`]data-design['"`]/.test(s.code)).map(s => s.rel);
  assert.deepEqual(offenders, [], `these files set data-design at runtime: ${offenders.join(', ')}`);
});
