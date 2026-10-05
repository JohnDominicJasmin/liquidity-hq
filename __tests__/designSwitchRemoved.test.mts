/* #1111 / PR #1489 (merged c0140382): the `?design=current` switch is gone. It used to be resolved twice - an
 * inline pre-paint <script> in app/layout.tsx and DesignModeProvider - from `?design=` then the
 * `lhq-design-mode` localStorage value, and with the current-design markup already deleted from every page the
 * only thing it could still do was strip the terminal tokens off terminal markup, stickily. The PR deleted
 * lib/designMode.ts, components/DesignModeProvider.tsx and __tests__/designMode.test.mts, put a STATIC
 * `data-design="terminal"` on <html>, and collapsed the two palette pickers that took the mode
 * (KLineProChart's paletteFor, SpotlightTour's usePalette) to their terminal path.
 *
 * Dev asked QA to pin it (dev writes no tests, owner ruling 2026-09-07). Two halves:
 *   - ABSENCE (D3-D6): nothing in app/, components/ or lib/ reads a `design` search param, the storage key,
 *     the removed modules, or branches on a "current" design. A source scan, so D1/D2 are controls: the scan
 *     covers N>0 files in each directory, comment stripping removes the many comments that still MENTION the
 *     switch (or the scan would fail on prose) while keeping code, and the same param-read pattern finds real
 *     reads of other params - otherwise a broken glob or regex passes every absence test vacuously.
 *   - THE SINGLE PATH (D7-D9): what the PR left as the only rendering.
 *
 * Comments are stripped by the TypeScript printer, not a regex: a `//` regex eats the rest of any line holding
 * an `https://` string, which is exactly where a reintroduced read could hide. Only files whose raw text has the
 * pattern's word are printed (see hits()): ~60 files that mention "design" instead of all ~380.
 * Not covered: app/globals.css still carries current-design rules on purpose (its own comment says so) - CSS
 * cannot read a search param, and deleting dead CSS is a separate decision. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['app', 'components', 'lib'];
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(rel);
    return /\.(tsx?|mts|mjs|js|jsx)$/.test(e.name) ? [rel] : [];
  });
}

const printer = ts.createPrinter({ removeComments: true });
function code(rel: string): string {
  const kind = /\.(tsx|jsx)$/.test(rel) ? ts.ScriptKind.TSX : /\.(mjs|js)$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return printer.printFile(ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, false, kind));
}

const FILES = DIRS.flatMap(walk);
const RAW = new Map(FILES.map((f) => [f, read(f)]));
const printed = new Map<string, string>();
const CODE = { get: (f: string) => { if (!printed.has(f)) printed.set(f, code(f)); return printed.get(f); } };

/** Files whose comment-stripped code matches `re`. Printing all ~380 files costs ~10s under the test runner, so
 *  only files whose RAW text contains `word` are printed - safe because every pattern below matches only text
 *  that literally contains its word, and stripping comments removes text, it never adds any. */
const hits = (re: RegExp, word = 'design') => FILES.filter((f) => RAW.get(f)!.toLowerCase().includes(word.toLowerCase()) && re.test(CODE.get(f)!));

/** A read of search param NAME: `.get('NAME')` / `.has('NAME')` on URLSearchParams or useSearchParams(). */
const paramRead = (name: string) => new RegExp(`\\.(get|has|getAll)\\(\\s*['"\`]${name}['"\`]\\s*\\)`);

test('D1. CONTROL: the scan covers every directory, and stripping removes comments while keeping code - without this, every absence test below could pass on an empty or wrong file list', (t) => {
  t.diagnostic(`${FILES.length} files scanned: ${DIRS.map((d) => `${d} ${FILES.filter((f) => f.startsWith(`${d}/`)).length}`).join(', ')}`);
  for (const d of DIRS) assert.ok(FILES.some((f) => f.startsWith(`${d}/`)), `no source files found under ${d}/ - the walk is broken`);
  assert.ok(FILES.length >= 300, `only ${FILES.length} files scanned (measured ~380) - the walk lost files`);
  // dashboard/page.tsx's header comment still says "branch on useDesignMode()": prose the strip must remove.
  assert.match(read('app/dashboard/page.tsx'), /useDesignMode\(\)/, 'CONTROL premise: the known comment mention is gone - pick another');
  assert.doesNotMatch(CODE.get('app/dashboard/page.tsx')!, /useDesignMode/, 'comment stripping left a comment in');
  assert.match(CODE.get('app/layout.tsx')!, /data-design="terminal"/, 'comment stripping removed code');
});

test('D2. CONTROL: the param-read pattern finds real reads of OTHER params (locale, acc) in stripped code - so its finding nothing for `design` means something', () => {
  // Prefilter words are quoted ("'acc'") only to keep the printed set small - bare "acc" selects every file with "account".
  assert.ok(hits(paramRead('locale'), "'locale'").includes('app/api/labels/route.ts'), 'the pattern misses searchParams.get(\'locale\') in app/api/labels/route.ts');
  assert.ok(hits(paramRead('acc'), "'acc'").includes('components/PositionSizer.tsx'), 'the pattern misses searchParams.get(\'acc\') in components/PositionSizer.tsx');
  const designFiles = FILES.filter((f) => RAW.get(f)!.toLowerCase().includes('design'));
  assert.ok(designFiles.length > 0 && designFiles.includes('app/layout.tsx'), 'CONTROL: the raw-text prefilter for "design" selects no files, or not the layout - every absence test would be vacuous');
});

test('D3. nothing in app/, components/ or lib/ reads a `design` search param - ?design=current and ?design=terminal are inert', () => {
  assert.deepEqual(hits(paramRead('design')), [], 'a .get(\'design\') / .has(\'design\') read is back');
  assert.deepEqual(hits(/searchParams\??\.\s*design\b|searchParams\??\.?\[\s*['"`]design['"`]\s*\]/), [], 'a page reads searchParams.design');
  assert.deepEqual(hits(/\{[^{}]*\bdesign\b[^{}]*\}\s*=\s*(await\s+)?(props\.)?searchParams\b/), [], 'design is destructured from searchParams');
  assert.deepEqual(hits(/['"`][^'"`]*[?&]design=/), [], 'a string literal builds a ?design= URL');
});

test('D4. nothing reads or writes the `lhq-design-mode` storage key - a stale stored "current" is simply never read', () => {
  assert.deepEqual(hits(/lhq-design-mode/), []);
});

test('D5. the removed modules stay removed and nothing imports them', () => {
  for (const f of ['lib/designMode.ts', 'components/DesignModeProvider.tsx']) assert.equal(existsSync(path.join(ROOT, f)), false, `${f} is back`);
  assert.deepEqual(hits(/\b(useDesignMode|DesignModeProvider|resolveDesignMode)\b/), [], 'code references a removed symbol');
  assert.deepEqual(hits(/from\s+['"][^'"]*\/designMode['"]|import\(\s*['"][^'"]*\/designMode['"]/), [], 'code imports lib/designMode');
});

test('D6. no code branches on a "current" design, and nothing sets or removes data-design at runtime - the attribute is static', () => {
  assert.deepEqual(hits(/design\w*['"`)\]]?\s*[!=]==?\s*['"`]current['"`]|['"`]current['"`]\s*[!=]==?\s*\w*[Dd]esign/), [], 'a design === \'current\' branch is back');
  assert.deepEqual(hits(/(setAttribute|removeAttribute|toggleAttribute)\(\s*['"`]data-design['"`]/), [], 'code writes data-design at runtime');
  assert.deepEqual(hits(/dataset\.design\s*=(?!=)/), [], 'code writes dataset.design');
});

test('D7. app/layout.tsx renders <html data-design="terminal"> as a static attribute and AppShell with no design provider around it - terminal is the one path', () => {
  const layout = CODE.get('app/layout.tsx')!;
  const html = layout.match(/<html\b[^>]*>/g) ?? [];
  assert.equal(html.length, 1, `expected one <html> element, found ${html.length}`);
  assert.match(html[0], /\bdata-design="terminal"/, '<html> does not carry a literal data-design="terminal"');
  assert.doesNotMatch(html[0], /data-design=\{/, 'data-design is an expression again, not a static attribute');
  assert.match(layout, /<body\b[^>]*>[\s\S]*<AppShell>\{children\}<\/AppShell>[\s\S]*<\/body>/, 'AppShell no longer renders the children directly inside <body>');
  assert.doesNotMatch(layout, /dangerouslySetInnerHTML[\s\S]{0,400}design/, 'an inline script touching design is back in the layout');
});

test('D8. KLineProChart picks its palette from the theme alone: light -> LIGHT, dark -> TERMINAL_DARK; the current design\'s DARK palette is gone', () => {
  const chart = CODE.get('components/KLineProChart.tsx')!;
  const fn = chart.match(/function paletteFor\(([^)]*)\)[^{]*\{([^}]*)\}/);
  assert.ok(fn, 'paletteFor not found');
  assert.equal(fn[1].replace(/\s+/g, ''), 'dark:boolean', 'paletteFor takes a design argument again');
  assert.equal(fn[2].replace(/\s+/g, ' ').trim(), 'if (!dark) return LIGHT; return TERMINAL_DARK;');
  assert.doesNotMatch(chart, /\bconst DARK\b/, 'the current design\'s DARK chart palette is back');
  const calls = [...chart.matchAll(/paletteFor\(([^)]*)\)/g)].map((m) => m[1].trim()).filter((a) => a !== 'dark: boolean');
  assert.ok(calls.length >= 2, `CONTROL: expected the init and theme-sync call sites, found ${calls.length}`);
  assert.deepEqual([...new Set(calls)], ['dark'], `a call site passes something other than just the theme: ${calls.join(' | ')}`);
});

test('D9. SpotlightTour always uses the terminal palette and the terminal wrapper class - no theme/design pick, no DARK/LIGHT palettes', () => {
  const tour = CODE.get('components/SpotlightTour.tsx')!;
  const fn = tour.match(/function usePalette\(\)[^{]*\{([^}]*)\}/);
  assert.ok(fn, 'usePalette not found');
  assert.equal(fn[1].replace(/\s+/g, ' ').trim(), 'return TERMINAL;', 'usePalette chooses between palettes again');
  assert.match(tour, /className="tour-term-wrap"/, 'the tour wrapper class is conditional again');
  assert.doesNotMatch(tour, /\bconst (DARK|LIGHT)\b/, 'a non-terminal tour palette is back');
});
