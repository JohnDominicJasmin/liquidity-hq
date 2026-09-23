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

/** Package specifiers imported by app code - not `@/…`, not relative, not from a comment. */
function packageSpecifiers(): string[] {
  const out = new Set<string>();
  const files = execFileSync('git', ['-C', ROOT, 'ls-files', 'app', 'lib', 'components'], { encoding: 'utf8' })
    .split(/\r?\n/).filter((f) => /\.tsx?$/.test(f));
  for (const rel of files) {
    let src: string;
    try { src = readFileSync(path.join(ROOT, rel), 'utf8'); } catch { continue; }
    for (const line of src.split(/\r?\n/)) {
      // Skip comments - `// … a separate state from 'denied'.` is not an import.
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
      for (const m of line.matchAll(/\bfrom\s+'([^']+)'/g)) {
        const s = m[1];
        if (s.startsWith('.') || s.startsWith('@/')) continue;
        out.add(s);
      }
    }
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
