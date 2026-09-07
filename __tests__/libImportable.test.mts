/* `lib/` must stay importable by `npm test`, which is bare `node --test`.
 *
 * WHAT WAS ACTUALLY BROKEN, because "add file extensions" undersells it.
 * Node 24 strips TypeScript types natively, so a `.ts` file needs no loader -
 * but Node's ESM resolver does NOT do extension guessing. `import './coins'`
 * is a request for a file literally named `coins`, which does not exist, so the
 * import throws ERR_MODULE_NOT_FOUND before a single line runs. That made every
 * module in `lib/` with a relative import untestable, `marketStore.ts` among
 * them - and `computeSqueezeScore` lives there, so QA could not assert against
 * the scorer at all without duplicating app logic into test code (#952).
 *
 * WHY THE RATCHET COVERS TYPE IMPORTS TOO. `import type { X } from './y'` is
 * erased before Node resolves anything, so it does not break today. It breaks
 * the moment someone drops the `type` keyword, and nothing would have failed in
 * between. Two counts of this were in circulation - 42 specifiers across 18
 * files counting everything, 31 across 14 counting only value imports - and
 * both were right about different things. Covering all of them is what makes
 * the number stop mattering.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'lib');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Every relative specifier in a source file, whatever syntax introduced it:
 *  `import ... from`, `export ... from`, a bare `import './x'`, or a dynamic
 *  `import('./x')`. A sweep that only looked at the first of those is how the
 *  two disagreeing counts happened. */
function relativeSpecifiers(src: string): string[] {
  const out: string[] = [];
  for (const re of [
    /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+'(\.\.?\/[^']*)'/g,
    /(?:^|\n)\s*import\s+'(\.\.?\/[^']*)'/g,
    /import\(\s*'(\.\.?\/[^']*)'\s*\)/g,
  ]) {
    for (const m of src.matchAll(re)) out.push(m[1]);
  }
  return out;
}

const HAS_EXT = /\.(ts|tsx|js|mjs|cjs|json)$/;

test('no relative import in lib/ omits its file extension', () => {
  const offenders: string[] = [];
  for (const file of tsFiles(LIB)) {
    for (const spec of relativeSpecifiers(readFileSync(file, 'utf8'))) {
      if (!HAS_EXT.test(spec)) {
        offenders.push(`${path.relative(ROOT, file).split(path.sep).join('/')} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `${offenders.length} relative import(s) in lib/ have no extension:\n  ${offenders.join('\n  ')}\n` +
    "Node's ESM resolver does not guess extensions, so each of these throws " +
    'ERR_MODULE_NOT_FOUND under `npm test` and makes its module untestable. Add .ts.');
});

test('CONTROL: the scanner sees every syntax that can carry a specifier', () => {
  /* Without this the ratchet passes on a scanner that matches nothing, which is
     the shape of check that has cost this project a day. The false cases matter
     as much: a scanner that also flagged already-extensioned or bare-package
     imports would fail every honest file and get deleted. */
  const caught = relativeSpecifiers([
    "import { a } from './one';",
    "import type { B } from './two';",
    "export { c } from './three';",
    "export * from './four';",
    "import './five';",
    "const m = await import('./six');",
    "import {\n  d,\n  e,\n} from './seven';",
  ].join('\n'));
  assert.deepEqual(caught.sort(),
    ['./five', './four', './one', './seven', './six', './three', './two']);

  const ignored = relativeSpecifiers([
    "import { z } from 'react';",
    "import { y } from '@/lib/thing';",
  ].join('\n'));
  assert.deepEqual(ignored, [], 'the scanner is matching non-relative specifiers');

  assert.ok(HAS_EXT.test('./coins.ts'));
  assert.ok(!HAS_EXT.test('./coins'));
});

test('marketStore imports under bare node, and its scorer is callable', () => {
  /* THE POINT OF #952, asserted rather than described. This is the module QA
     was blocked on: computeSqueezeScore lives here, and before the sweep this
     import threw ERR_MODULE_NOT_FOUND. Calling it with an empty coin proves the
     module is genuinely loaded rather than merely resolvable. */
  return import('../lib/marketStore.ts').then(m => {
    assert.equal(typeof m.computeSqueezeScore, 'function');
    assert.equal(typeof m.computeCoinHealth, 'function');
    /* Asserted on the no-data branch only, and deliberately not on `color`:
       #941 is changing that value and this test must not fail because a
       different PR landed. Grade and labelKey are the stable pair. */
    const health = m.computeCoinHealth(undefined);
    assert.equal(health.grade, 'F');
    assert.equal(health.labelKey, 'COIN_HEALTH_NO_DATA');
  });
});
