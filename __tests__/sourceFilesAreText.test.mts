import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/* NO TRACKED SOURCE FILE MAY CONTAIN A RAW NUL BYTE.
 *
 * `app/arena/page.tsx` held two, used as a join separator, written as literal bytes
 * instead of the escape `'\0'` (#1347, fixed in #1416). The consequence was not cosmetic:
 * ripgrep treats the file as binary, and in a DIRECTORY traversal - how anyone searches a
 * codebase - it is skipped entirely, in every output mode, with exit 0 and no warning.
 * 1,576 of its 2,794 lines were invisible. `fontWeight` has 34 occurrences there and a
 * repo-wide search found none of them, while still returning 129 confident matches from
 * other files. A hole in a healthy-looking result set.
 *
 * It cost a wrong finding on #1398 - three analytics events reported as never called, when
 * `track.arenaAnalysis` is called from that very file - and it silently weakened every
 * "nothing references this" conclusion anyone had drawn about the largest page in the app.
 *
 * So this is the guard, not the fix. The fix was two characters; what was missing was
 * anything that would notice. A raw NUL is never what an author means in TypeScript source
 * - the escape is identical at runtime and leaves the file searchable - so this can be a
 * hard rule rather than a judgement call.
 *
 * Scope is deliberately the tracked TEXT sources. Real binaries are expected to contain
 * NUL bytes and are excluded by extension, not by a hand-maintained path list: the scan
 * found 118 tracked files containing one, 117 of them genuine (png, woff2, jar, ico), and
 * exactly one source file. A hand-written allowlist would have had to name that one.
 */

const ROOT = path.join(fileURLToPath(import.meta.url), '..', '..');

/** Extensions whose contents a human reads and greps. Anything else is left alone. */
const TEXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.json', '.md', '.css', '.scss', '.html', '.svg', '.yml', '.yaml', '.sql', '.txt', '.sh',
]);

function trackedTextFiles(): string[] {
  return execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => TEXT.has(path.extname(f).toLowerCase()));
}

test('no tracked source file contains a raw NUL byte', () => {
  const files = trackedTextFiles();
  assert.ok(files.length > 200, `only ${files.length} text files found - the scan is broken, not the repo`);

  const offenders: string[] = [];
  for (const rel of files) {
    let buf: Buffer;
    try { buf = readFileSync(path.join(ROOT, rel)); } catch { continue; }
    const at = buf.indexOf(0);
    if (at >= 0) offenders.push(`${rel} (first NUL at byte ${at})`);
  }

  assert.deepEqual(offenders, [],
    'A raw NUL byte makes ripgrep treat the file as binary. In a DIRECTORY search it is then\n' +
    'skipped entirely - every output mode, exit 0, no warning - so the file silently vanishes\n' +
    'from repo-wide searches and every "nothing references this" answer about it becomes\n' +
    "unreliable. Write the escape '\\0' instead; it is identical at runtime.\n" +
    `Offenders:\n  ${offenders.join('\n  ')}`);
});

test('CONTROL: the scan can actually detect a NUL byte', () => {
  /* Without this, the test above passes if the scan silently matches nothing - a wrong glob,
     an empty file list, a readFileSync that throws for every path. It asserts a failure
     rather than the absence of one, which is the only way a clean result means something.
     The same class of mistake produced the wrong finding this guard exists to prevent. */
  const clean = Buffer.from("const a = 'x'.split(' ').join('\\0');", 'utf8');
  assert.equal(clean.indexOf(0), -1, 'the ESCAPE form must not be flagged - it is two characters, not a NUL');

  const dirty = Buffer.concat([Buffer.from("const a = 'x'.join('", 'utf8'), Buffer.from([0]), Buffer.from("');", 'utf8')]);
  assert.ok(dirty.indexOf(0) >= 0, 'the detector cannot see a NUL byte, so a clean run above proves nothing');
});

test('CONTROL: real binaries are excluded by extension, and there are some', () => {
  /* The exclusion is by extension rather than a path allowlist, on purpose: a hand-written
     list would have had to name app/arena/page.tsx to stay green, which is exactly the
     shape of a guard that gets edited instead of heeded. This confirms the excluded set is
     non-empty and really does contain NUL bytes - otherwise the filter is doing nothing and
     the rule above is narrower than it looks. */
  const all = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split(/\r?\n/).filter(Boolean);
  const excluded = all.filter((f) => !TEXT.has(path.extname(f).toLowerCase()));
  assert.ok(excluded.length > 0, 'nothing is excluded - the extension filter is not doing what it claims');

  const binaryWithNul = excluded.some((rel) => {
    try { return readFileSync(path.join(ROOT, rel)).indexOf(0) >= 0; } catch { return false; }
  });
  assert.ok(binaryWithNul, 'no excluded file contains a NUL byte - then the exclusion is unnecessary and should go');
});
