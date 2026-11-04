/* #1413's locator-surface triage, the half of it that is MECHANICALLY REPRODUCIBLE.
 *
 * WHAT THIS DOES NOT DO, AND WHY. The issue carries a table of "extraction points" per file -
 * cryptoCheckout 25, aiSpendCap 11, and so on. Six candidate definitions were calibrated against
 * those published numbers and none reproduced them (closest total error 38; cryptoCheckout came out
 * 39 against a published 25). That is consistent with what the issue says about itself: *"the reason
 * this triage is cell-by-cell rather than mechanical"*. So the ORDERING of that table cannot be
 * re-derived by a script, and a script that produced a different ordering under the same column name
 * would be worse than no script.
 *
 * WHAT IT DOES DO. The triage's other column IS reproducible, and it is the one the issue's guidance
 * branches on:
 *
 *   EVALUATES  - the cell executes product code: imports the module, or builds a function from
 *                extracted source. The issue: *"the strongest cells in the suite... fix the LOCATOR,
 *                never the assertion. A fix that loosens the assertion alongside the anchor trades a
 *                working test for a passing one."*
 *   TEXT-ONLY  - the cell only reads source and asserts on the text. The issue: candidates for
 *                conversion to a value or behaviour assertion - but NOT all of them, because for
 *                some the location IS the property under test (rsiWilderOracle S2 asserts the Wilder
 *                formula exists in exactly ONE place; a grep-driven sweep would destroy that).
 *
 * So this lists which bucket each source-reading file is in. It does not say what to do with any of
 * them - that call is per cell, and the issue is explicit that mechanising it is the hazard.
 *
 * usage: node qa/tools/source-pin-triage.mjs [--control]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, '__tests__');

export const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

/** Does the file read product source as TEXT? That is what makes it a source pin at all. */
export const readsSource = (code) =>
  /readFileSync\s*\(/.test(code) && /\b(?:app|lib|components)\//.test(code);

/** Does it EXECUTE product code - import the module, or build a function from extracted source? */
export const evaluates = (code) =>
  /\bawait\s+import\s*\(/.test(code) || /\bnew\s+Function\s*\(/.test(code) || /\beval\s*\(/.test(code);

/** Does it STATICALLY import product code? Not part of the issue's column - calibrated against its
 *  eight published rows, `evaluates` is dynamic import / new Function / eval and nothing else, and
 *  this detector agrees with all eight. But a text-only cell that ALREADY has the module in hand is
 *  the cheapest conversion to a value assertion, so it is worth separating out. */
export const staticallyImports = (code) =>
  /^import\s[^;]*from\s*['"]\.\.\/(?:app|lib|components)\//m.test(code);

const CONTROL = [
  ["const s = readFileSync('lib/x.ts','utf8'); assert.match(s, /foo/);", { reads: true, evals: false }, 'text-only source pin'],
  ["const s = readFileSync('lib/x.ts','utf8'); const m = await import('../lib/x.ts');", { reads: true, evals: true }, 'reads AND executes'],
  ["const m = await import('../lib/x.ts'); assert.equal(m.f(1), 2);", { reads: false, evals: true }, 'behaviour only - not a source pin'],
  ['assert.equal(1 + 1, 2);', { reads: false, evals: false }, 'neither'],
];

if (process.argv.includes('--control')) {
  let bad = 0;
  for (const [line, want, why] of CONTROL) {
    const c = stripComments(line);
    const got = { reads: readsSource(c), evals: evaluates(c) };
    const ok = got.reads === want.reads && got.evals === want.evals;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  reads=${got.reads} evals=${got.evals}  ${why}`);
  }
  console.log(bad === 0 ? '\ncontrol passed' : `\n${bad} control case(s) FAILED`);
  process.exit(bad === 0 ? 0 : 1);
}

const evalsList = [];
const textOnly = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.mts'))) {
  const code = stripComments(readFileSync(path.join(DIR, f), 'utf8'));
  if (!readsSource(code)) continue;
  (evaluates(code) ? evalsList : textOnly).push(f);
}

console.log(`SOURCE-PIN FILES: ${evalsList.length + textOnly.length}\n`);
console.log(`EVALUATES (${evalsList.length}) - strongest cells. Fix the LOCATOR, never the assertion:`);
for (const f of evalsList) console.log(`  ${f}`);
console.log(`\nTEXT-ONLY (${textOnly.length}) - candidates for a value/behaviour assertion, cell by cell.`);
console.log('Not all can be converted: where the LOCATION is the property (rsiWilderOracle S2), converting destroys the test.');

const cheap = textOnly.filter((f) => staticallyImports(stripComments(readFileSync(path.join(DIR, f), 'utf8'))));
const pure = textOnly.filter((f) => !cheap.includes(f));

console.log(`\n  ALREADY IMPORTS THE MODULE (${cheap.length}) - the cheapest conversions. The value is already`);
console.log('  reachable, so a text pin can become a value assertion without new plumbing:');
for (const f of cheap) console.log(`    ${f}`);
console.log(`\n  NO MODULE IN HAND (${pure.length}) - converting these needs the import added first:`);
for (const f of pure) console.log(`    ${f}`);
console.log('\nThe extraction-point RANKING on #1413 is not reproducible by script - see this file\'s header.');
