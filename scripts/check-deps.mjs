#!/usr/bin/env node
/* Fails loudly when a declared dependency is not actually on disk, and names
 * the remedy - rather than letting the next command (next dev, node --test,
 * eslint) fail somewhere unrelated with a bare `Cannot find module`.
 *
 * WHY THIS EXISTS. Three sessions share one `node_modules` on this machine.
 * npm installs a package by removing its directory and re-creating it, so two
 * overlapping `npm install` runs can each report success while leaving the
 * shared tree missing something neither one actually failed to install - a
 * lost-update race, not a broken install. #919 hit this with
 * `import-in-the-middle` and promoted it to a direct dependency on the theory
 * that an undeclared transitive package is what gets pruned. #975 found the
 * same failure recur five times in one window and traced it to a NARROWER
 * cause: `require-in-the-middle` sits three levels deep under
 * @sentry/nextjs -> @sentry/node -> @opentelemetry/instrumentation and was
 * never promoted, so it stayed exactly as prunable as #919 described.
 *
 * THIS SCRIPT DOES NOT DECIDE WHICH THEORY IS RIGHT. It checks presence, not
 * cause - see #975 for why "it recurred" alone cannot distinguish the two
 * hypotheses without knowing which package name is missing. What it buys is
 * cheaper: whoever hits the failure gets the package name and the fix in one
 * line instead of a stack trace and a diagnosis.
 *
 * RUN AS `postinstall`, deliberately, not `predev`/`pretest`/`prebuild`. This
 * checks the OUTCOME of an install, including one that raced with another and
 * still exited 0 - so it has to run after install, not before whatever
 * command triggered one. It cannot catch corruption from an install nobody in
 * this session ran; nothing running only in this process can. */

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

/* Named separately from the declared-dependency sweep because these two are
 * the actual repeat offenders (#919, #975) and BOTH are worth checking even
 * though only one is currently a direct dependency - the whole point of #975
 * is that the undeclared one is the one still able to go missing silently. */
const WATCHED_TRANSITIVE = ['require-in-the-middle'];

function resolveDir(name) {
  // Scoped packages (@scope/name) nest one level deeper.
  return path.join(ROOT, 'node_modules', ...name.split('/'));
}

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
console.error('  This machine shares node_modules across concurrent sessions.');
console.error('  npm installs a package by removing its directory and re-');
console.error('  creating it - two overlapping installs can each exit 0 while');
console.error('  leaving the shared tree missing something neither one actually');
console.error('  failed on. This is not a broken install; it is a race.');
console.error('');
console.error('  Remedy: run `npm install` again, on its own, with no other');
console.error('  install running against this checkout at the same time.');
console.error('==================================================================');
console.error('');

/* Exit 0 rather than 1. This runs as `postinstall`, which is itself an npm
 * lifecycle script - failing it makes `npm install` itself report failure for
 * a problem the remedy is "run npm install again", which reads as the tool
 * being broken rather than the race being caught. The loud message is the
 * point; blocking the command that already ran is not. */
process.exit(0);
