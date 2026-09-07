#!/usr/bin/env node
/* Fails loudly when a declared dependency is not actually usable on disk, and
 * names the remedy - rather than letting the next command (next dev,
 * node --test, eslint) fail somewhere unrelated with a bare `Cannot find
 * module`.
 *
 * WHY THIS EXISTS. Three sessions share one `node_modules` on this machine,
 * and a package can go missing from it in at least THREE DIFFERENT WAYS that
 * look identical from the failure site but are not the same problem:
 *
 *   1. ABSENT, never declared - nothing at the root asks for it, so npm is
 *      free to prune or reshape it on any install. #919's account, fixed for
 *      `import-in-the-middle` by declaring it. #975 found the sibling
 *      `require-in-the-middle` still undeclared and still in this state.
 *   2. ABSENT, declared somewhere - the tree that ran the last `npm install`
 *      was checked out before the declaration existed, or on a branch without
 *      it. The declaration is real; this install predates or bypasses it.
 *   3. PRESENT BUT EMPTY - the package's directory exists with zero files,
 *      not even its own package.json. npm's install is remove-then-recreate;
 *      an install interrupted between those two steps leaves exactly this.
 *      Found live by QA during a staging push (#975) - `import-in-the-middle`
 *      existed and was hollow. #906 (closed) recorded this machine hitting
 *      6-10% free memory the same day, which is the kind of pressure that
 *      kills a process mid-write - a mechanism with a plausible match, NOT a
 *      confirmed cause. Nobody has watched an install die and left an empty
 *      directory while watching.
 *
 * DECLARING A PACKAGE (see require-in-the-middle below) FIXES MODES 1 AND 2
 * AND CANNOT TOUCH MODE 3. A directory that exists passes any check that only
 * asks "is this package declared", including one that reads package.json
 * correctly. Presence has to be checked on disk, every time, regardless of
 * what is declared - which is the whole reason this script exists alongside
 * the declarations rather than instead of them.
 *
 * THIS SCRIPT DOES NOT DECIDE WHICH MODE ANY GIVEN FAILURE IS. It checks
 * presence, not cause - see #975 for why "it recurred" alone could not even
 * distinguish modes 1 and 2 without the package name, and could not touch
 * mode 3 at all until someone ran the actual test instead of `ls`. What this
 * buys is cheaper regardless of mode: whoever hits the failure gets the
 * package name and the fix in one line instead of a stack trace and a
 * diagnosis.
 *
 * THE PRINTED BANNER NAMES NO CAUSE, on purpose and after getting this wrong
 * once. An earlier draft asserted "this is not a broken install; it is a
 * race" - which was true for modes 1 and 2 and directly contradicted by
 * mode 3, the first time QA hit one. Whoever reads the banner is, by
 * construction, not positioned to tell which mode they have: they are
 * mid-failure, not mid-investigation. So the banner says what is missing and
 * what to do, and points at this issue for the rest.
 *
 * RUN AS `postinstall`, deliberately, not `predev`/`pretest`/`prebuild`. This
 * checks the OUTCOME of an install, including one that raced with another or
 * was killed mid-write and still left npm reporting success - so it has to
 * run after install, not before whatever command triggered one. It cannot
 * catch corruption from an install nobody in this session ran; nothing
 * running only in this process can. */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/* Every DIRECT dependency, checked by directory presence rather than
 * `require.resolve` - resolve can succeed against a stale entry in node's
 * module cache or a hoisted copy elsewhere on disk, which is exactly the kind
 * of false pass this script exists to not produce. A directory either has a
 * package.json in node_modules or it does not. */
const declared = Object.keys(pkg.dependencies ?? {});

/* Named separately from the declared-dependency sweep because this list is for
 * packages NOTHING at the root asks for - the exact shape #919 and #975 both
 * describe as prunable, and the one `declared` structurally cannot see.
 *
 * `require-in-the-middle` is deliberately NOT here, even though it is the
 * package #975 was filed about: this PR declares it above, so it is already in
 * `declared` and already swept there. Watching it here too would read as a
 * second net when it is the same one twice - and would silently stop meaning
 * anything the next time a name in this list gets promoted, which is exactly
 * how the entry it replaces went stale in one draft of this file.
 *
 * `@opentelemetry/instrumentation` is require-in-the-middle's own parent
 * (`@sentry/nextjs -> @sentry/node -> @opentelemetry/instrumentation ->
 * require-in-the-middle`) and is undeclared at the root today - verified
 * against package-lock.json, not assumed from the tree shape. If IT goes
 * missing, everything under it does too, so it is a wider net over the same
 * failure than watching one of its children. */
const WATCHED_TRANSITIVE = ['@opentelemetry/instrumentation'];

function resolveDir(name) {
  // Scoped packages (@scope/name) nest one level deeper.
  return path.join(ROOT, 'node_modules', ...name.split('/'));
}

/* Checks the package's OWN package.json, not the directory. This was written
 * to avoid a `require.resolve` false pass - resolve can succeed against a
 * stale entry in node's module cache or a hoisted copy elsewhere on disk -
 * and it turned out to do something more valuable than that reason predicted:
 * it is the only form of this check that tells a present-but-EMPTY directory
 * (mode 3 above) from a genuinely restored one. `existsSync(dir)` alone would
 * have passed on exactly the hollow `import-in-the-middle` directory QA found
 * live, which is what happened to the manual `ls`-based verification of an
 * earlier instance of this same issue - `ls` shows an empty directory as
 * present. DO NOT SIMPLIFY THIS TO A DIRECTORY CHECK. */
function present(name) {
  return existsSync(path.join(resolveDir(name), 'package.json'));
}

const missingDeclared = declared.filter(name => !present(name));
const missingWatched = WATCHED_TRANSITIVE.filter(name => !present(name));

if (missingDeclared.length === 0 && missingWatched.length === 0) {
  process.exit(0);
}

console.error('');
console.error('==================================================================');
console.error('  DEPENDENCY CHECK FAILED - node_modules is missing something npm');
console.error('  just said it installed.');
console.error('==================================================================');
console.error('');
if (missingDeclared.length) {
  console.error('  Declared in package.json but not on disk:');
  for (const name of missingDeclared) console.error(`    - ${name}`);
  console.error('');
}
if (missingWatched.length) {
  console.error('  Transitive, historically prunable, currently missing (#975):');
  for (const name of missingWatched) console.error(`    - ${name}`);
  console.error('');
}
console.error('  This has happened before for more than one reason - a package');
console.error('  nothing declares, an install run before a declaration existed,');
console.error('  and once, an install killed mid-write leaving an empty directory.');
console.error('  See github.com/JohnDominicJasmin/liquidity-hq/issues/975 for the');
console.error('  full account. This script does not know which one this is.');
console.error('');
console.error('  Remedy: run `npm install` again, on its own, with no other');
console.error('  install running against this checkout at the same time.');
console.error('==================================================================');
console.error('');

/* Exit 0 rather than 1. This runs as `postinstall`, which is itself an npm
 * lifecycle script - failing it makes `npm install` itself report failure for
 * a problem whose remedy is "run npm install again", which reads as the tool
 * being broken rather than the underlying failure being caught. The loud
 * message is the point; blocking the command that already ran is not. */
process.exit(0);
