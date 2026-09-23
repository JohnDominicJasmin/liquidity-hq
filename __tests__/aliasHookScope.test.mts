import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/* BOUNDS WHAT `qa/alias-hooks.mjs` FORGIVES.
 *
 * Dev Team named the risk when accepting the hook: it makes test-time resolution slightly
 * more forgiving than Next's own, so a module that resolves ONLY under the hook would pass
 * tests and fail the build. The build gate catches that, but late and confusingly.
 *
 * This turns "be conscious of it" into "the suite tells you". It compares what
 * `import.meta.resolve` answers WITH and WITHOUT the hook for every real package specifier
 * in `app/`, `lib/` and `components/`, and requires the set where the two disagree to be
 * exactly the known list. A sixth entry appearing is not a failure of anything - it is a
 * decision someone should make deliberately, which is what a red test buys.
 *
 * Measured, not assumed: today the hook changes the answer for five `next/*` subpaths and
 * nothing else, in every case by adding the `.js` that Next 16.2.6 omits because it ships
 * no `exports` map at all.
 *
 * WHY RESOLUTION AND NOT IMPORT. Importing every package would execute it - React DOM, GSAP,
 * charting libraries - for a question about resolution. But note the trap this test had to
 * work around: `import.meta.resolve` is NOT a proxy for importability. Without the hook it
 * returns `.../node_modules/next/server` quite happily and does not throw; the path simply
 * does not exist. So this checks the resolved file EXISTS rather than trusting the call to
 * throw, which is the difference between measuring and appearing to.
 */

const ROOT = path.join(fileURLToPath(import.meta.url), '..', '..');

/** Every `next/*` subpath the hook currently rescues. Add to this deliberately. */
const EXPECTED_RESCUES = ['next/headers', 'next/link', 'next/navigation', 'next/script', 'next/server'];

/* Comments are REMOVED, not skipped line by line.
 *
 * The first version skipped lines starting with `//`, `*` or `/*`, which misses the
 * CONTINUATION line of a block comment. This codebase comments in full prose, so those
 * lines are full of English of the form `separates "no clear setup" from "no data"` - and
 * `from "no data"` matches an import regex exactly.
 *
 * That is why the sweep originally read single quotes only, and the restriction turned out
 * to be load-bearing by accident: widening it to double quotes without this change would
 * have added four prose fragments to the package list on day one, each then "resolved" as
 * a module. Measured, not guessed - they are at egress-ip/route.ts:99,
 * market/klines/route.ts:385, KLineProChart.tsx:920 and marketStore.ts:363.
 *
 * With comments actually stripped, both quote styles and dynamic `import()` are safe to
 * match, which closes the gap Dev Team flagged on #1417 rather than parking it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')        // block comments, including continuations
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');    // line comments, without eating `https://`
}

/** Package specifiers in ONE source text. Separated from the file walk so the parser can be
 *  tested against a fixture - the repo happens to contain no double-quoted or
 *  dynamic-only package import today, so scanning the repo cannot prove those two
 *  patterns work, and an untested pattern is indistinguishable from a broken one. */
function specifiersIn(source: string): string[] {
  const src = stripComments(source);
  const out = new Set<string>();
  // Static `from '…'` / `from "…"`, and dynamic `import('…')` - the form a lazily loaded
  // package uses, which a `from` sweep alone never sees.
  for (const re of [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (const m of src.matchAll(re)) {
      const s = m[1];
      if (s.startsWith('.') || s.startsWith('@/')) continue;
      out.add(s);
    }
  }
  return [...out];
}

/** Package specifiers imported by app code - not `@/…`, not relative, not from a comment. */
function packageSpecifiers(): string[] {
  const out = new Set<string>();
  const files = execFileSync('git', ['-C', ROOT, 'ls-files', 'app', 'lib', 'components'], { encoding: 'utf8' })
    .split(/\r?\n/).filter((f) => /\.tsx?$/.test(f));
  for (const rel of files) {
    try { for (const s of specifiersIn(readFileSync(path.join(ROOT, rel), 'utf8'))) out.add(s); } catch { continue; }
  }
  return [...out].sort();
}

/** `import.meta.resolve` for each specifier, in a child process, optionally with the hook.
 *  A resolved path that does not exist is reported as MISSING rather than as a success. */
function resolveAll(specs: string[], withHook: boolean): Record<string, string> {
  const script = `
    import { existsSync } from 'node:fs';
    import { fileURLToPath } from 'node:url';
    const specs = ${JSON.stringify(specs)};
    const out = {};
    for (const s of specs) {
      try {
        const u = import.meta.resolve(s);
        out[s] = !u.startsWith('file:') ? u : (existsSync(fileURLToPath(u)) ? u : 'MISSING:' + u);
      } catch (e) { out[s] = 'THREW:' + (e && e.code); }
    }
    console.log(JSON.stringify(out));
  `;
  const args = withHook ? ['--import', './qa/alias-register.mjs'] : [];
  const stdout = execFileSync('node', [...args, '--input-type=module', '-e', script],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return JSON.parse(stdout.trim().split(/\r?\n/).pop()!);
}

test('the sweep parser: both quote styles, dynamic import, and no prose from comments', () => {
  /* Tested against a fixture rather than the repo, because the repo cannot currently prove
     it: nothing here is double-quoted or dynamically-imported-only, so those two patterns
     could be deleted and every repo-scanning test would stay green. An untested pattern is
     indistinguishable from a broken one, which is this whole file's subject. */
  const fixture = [
    `import a from 'single-quoted-pkg';`,
    `import b from "double-quoted-pkg";`,
    `const c = await import('dynamically-loaded-pkg');`,
    `import d from './relative-ignored';`,
    `import e from '@/lib/alias-ignored';`,
    `/* A block comment whose CONTINUATION line reads:`,
    `   separates "no clear setup" from "no data" for the accessible name. */`,
    `// and a line comment: distinguishes 'broken' from 'known'.`,
    `const url = 'https://example.invalid/not//a//comment';`,
  ].join('\n');

  const found = specifiersIn(fixture).sort();
  assert.deepEqual(found, ['double-quoted-pkg', 'dynamically-loaded-pkg', 'single-quoted-pkg'],
    'the parser missed a real import form, or picked up prose from a comment');
});

test('CONTROL: the sweep finds package names, not English prose', () => {
  /* The guard on the guard. A sweep that quietly scoops up comment text does not fail - it
     silently enlarges the specifier list, every extra entry fails to resolve under BOTH
     runs, so the with/without comparison still agrees and the real test stays green while
     measuring nonsense. Exactly the shape of failure this file exists to catch, one level
     up. `separates "no clear setup" from "no data"` would have contributed `no data`. */
  const specs = packageSpecifiers();
  const NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/[\w.-]+)*$/i;
  const prose = specs.filter((s) => !NAME.test(s));
  assert.deepEqual(prose, [], `the import sweep picked up text that is not a package name: ${prose.join(' | ')}`);
  assert.ok(specs.includes('next/server'), 'the sweep lost next/server - it is imported by every route handler');
  assert.ok(specs.includes('klinecharts'), 'the sweep lost klinecharts - it is the one package loaded dynamically');
});

test('the hook changes resolution for exactly the known next/* subpaths and nothing else', () => {
  const specs = packageSpecifiers();
  assert.ok(specs.length >= 10, `only found ${specs.length} package specifiers - the scan is broken, not the code`);

  const without = resolveAll(specs, false);
  const wth = resolveAll(specs, true);
  const changed = specs.filter((s) => without[s] !== wth[s]).sort();

  assert.deepEqual(changed, [...EXPECTED_RESCUES].sort(),
    'the hook now forgives a different set of specifiers than it is documented to.\n' +
    'That is not automatically wrong - but a module resolving ONLY under the hook passes tests\n' +
    'and fails the build, so the list is updated deliberately rather than discovered later.');
});

test('every other package resolves to a file that exists WITHOUT the hook', () => {
  const specs = packageSpecifiers().filter((s) => !EXPECTED_RESCUES.includes(s));
  const without = resolveAll(specs, false);
  const broken = specs.filter((s) => /^(MISSING|THREW):/.test(without[s]));
  assert.deepEqual(broken, [],
    `these resolve only under the hook but are not on the expected list: ${broken.join(', ')}`);
});

test('CONTROL: the five rescued subpaths really are broken without the hook', () => {
  /* Without this, the first test passes trivially if the fallback is ever deleted - the
     changed set would be empty, and empty only equals EXPECTED_RESCUES if that list is
     empty too. This pins the other half: these five genuinely do not resolve to a real
     file on their own, and the hook genuinely fixes them. */
  const without = resolveAll(EXPECTED_RESCUES, false);
  const wth = resolveAll(EXPECTED_RESCUES, true);
  for (const s of EXPECTED_RESCUES) {
    assert.match(without[s], /^MISSING:|^THREW:/,
      `${s} resolves fine on its own - it does not belong on the rescue list`);
    assert.ok(wth[s].startsWith('file:') && wth[s].endsWith('.js'),
      `the hook did not rescue ${s} (got ${wth[s]})`);
  }
});
