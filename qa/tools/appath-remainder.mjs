/* #1413's route-group MOVE hazard: what is still read by a hardcoded app/ path?
 *
 * WHY THIS IS A TOOL AND NOT A TABLE. #1413 carried two ranked tables of worst offenders, and by
 * the time they were read they were stale - the files they named as worst had been converted by
 * other PRs, and one of the top rows had already landed in #1907. A count in a comment thread
 * cannot be re-derived; this can.
 *
 * THE SCOPE IS NARROWER THAN IT LOOKS, and getting it wrong is easy. Four earlier versions of this
 * measurement each answered a different question:
 *
 *   1. counting `from '../lib/foo.ts'` import specifiers. A file move breaks those LOUDLY, at
 *      resolution, as an error nobody can mistake for a pass. Not this hazard.
 *   2. treating `appRel(...)` as unwrapped. There are TWO helpers in __tests__/_appPath.mts.
 *   3. counting backtick PROSE inside comments - `app/(main)/` written in an explanation is not a
 *      read. Quoted strings outside comments only.
 *   4. counting `app/api/...`. __tests__/_appPath.mts says explicitly: "Every Form C target is an
 *      API route, and all 84 API handlers stayed at app/api/... with zero under a group on the
 *      #1740 branch." API routes do not move, so those paths need nothing.
 *
 * AND THREE FILES AT THE APP ROOT DO NOT MOVE EITHER - verified by asking the resolver rather than
 * reasoning about Next's rules: appPath('app/globals.css'), appPath('app/global-error.tsx') and
 * appPath('app/global-not-found.tsx') each resolve to themselves, while appPath('app/not-found.tsx')
 * resolves to app/(main)/not-found.tsx. So a bare read of those three is CORRECT, not debt.
 *
 * usage: node qa/tools/appath-remainder.mjs            (list the remainder)
 *        node qa/tools/appath-remainder.mjs --control  (prove the filter still discriminates)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DIR = path.join(ROOT, '__tests__');

/** Quoted only - backticks are where the comment prose lives. */
const Q = String.raw`['"](?:\.\.\/)?app\/[A-Za-z0-9_\-./[\]()]+['"]`;

/** Blank out comments while preserving line structure, so a path in prose is not a finding. */
export const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

/** Paths that do not move, so a bare read of them is correct. */
const UNMOVED = /^['"](?:\.\.\/)?app\/(?:api\b|globals\.css|global-error\.tsx|global-not-found\.tsx)/;

export function bareIn(src) {
  const code = stripComments(src);
  const all = [...new Set(code.match(new RegExp(Q, 'g')) ?? [])];
  const wrapped = new Set([...code.matchAll(new RegExp(String.raw`app(?:Path|Rel|PathOrNull)\s*\(\s*(${Q})`, 'g'))].map((m) => m[1]));
  const imported = new Set([...code.matchAll(new RegExp(String.raw`(?:\bfrom\s*|\bimport\s*\(\s*)(${Q})`, 'g'))].map((m) => m[1]));
  return all.filter((p) => !wrapped.has(p) && !imported.has(p) && !UNMOVED.test(p));
}

/* A FOUR-WAY CONTROL. A filter this layered is one edit away from flagging nothing, and "no
   findings" and "the filter stopped working" are the same output. */
const CONTROL = [
  ["const a = readFileSync('app/planted/page.tsx', 'utf8');", true, 'an in-scope bare read'],
  ["const b = readFileSync('app/api/thing/route.ts', 'utf8');", false, 'an API route - does not move'],
  ["const c = readFileSync(appRel('app/wrapped/page.tsx'), 'utf8');", false, 'already wrapped'],
  ["import d from '../app/imported/page.tsx';", false, 'an import specifier - breaks loudly'],
  ["/* prose naming 'app/commented/page.tsx' */", false, 'prose in a comment'],
  ["const e = readFileSync('app/globals.css', 'utf8');", false, 'app root - does not move'],
];

if (process.argv.includes('--control')) {
  let bad = 0;
  for (const [line, shouldFlag, why] of CONTROL) {
    const got = bareIn(line).length > 0;
    const ok = got === shouldFlag;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${shouldFlag ? 'flags' : 'skips'} ${why}`);
  }
  console.log(bad === 0 ? '\ncontrol passed: the filter still discriminates' : `\n${bad} control case(s) FAILED - the filter is not measuring what it claims`);
  process.exit(bad === 0 ? 0 : 1);
}

const rows = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.mts'))) {
  const bare = bareIn(readFileSync(path.join(DIR, f), 'utf8'));
  if (bare.length) rows.push({ f, bare });
}
rows.sort((a, b) => b.bare.length - a.bare.length);

for (const r of rows) {
  console.log(`${String(r.bare.length).padStart(3)}  ${r.f}`);
  for (const p of r.bare) console.log(`       ${p}`);
}
console.log(`\n${rows.length} file(s), ${rows.reduce((a, r) => a + r.bare.length, 0)} path(s) still read by a hardcoded movable app/ path.`);
console.log('Run with --control first if that number is zero: an empty list and a broken filter look identical.');
