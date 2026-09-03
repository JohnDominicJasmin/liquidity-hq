/* Every lib/ module must survive Node's type-stripping (#663, #665).
 *
 * THE DEFECT THIS EXISTS FOR is not a bug in any module - it is a module
 * written in a shape that cannot be tested at all, where every gate says fine:
 *
 *     class HttpStatusError extends Error {
 *       constructor(public readonly status: number, message: string) { … }
 *     }
 *
 * A constructor parameter property looks like an annotation and is not - it
 * EMITS code. Next builds with SWC, which compiles it happily, so lint, tsc,
 * the build and production all pass. `node --test` cannot load the file at
 * all:
 *
 *     ✖ __tests__\pool.test.mts   code: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX'
 *
 * Four gates green and the module permanently untestable. And with no test
 * written against it, there is no symptom whatsoever - which is why this is
 * checked rather than written down. lib/pool.ts hit it, and it surfaced only
 * because a review asked for tests on a branch that had none.
 *
 * WHY stripTypeScriptTypes RATHER THAN IMPORTING each module: importing runs
 * module-level code - clients constructed, env read, timers started - so a
 * suite that imported all of lib/ would be testing side effects it has no
 * business triggering, and could hang. This parses and strips, executing
 * nothing.
 *
 * It also tests the actual property (does this load under the test runner)
 * rather than a proxy for it (does the source contain a banned keyword), so it
 * cannot drift from what it is protecting. Parameter properties are the case
 * hit so far; enums, namespaces and decorators fail the same way and are
 * caught by the same check without needing to be enumerated here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Cast rather than a named import: `stripTypeScriptTypes` is experimental, and
   this repo's @types/node does not declare it, so the named import is a tsc
   error (TS2305) even though the function is present at runtime. */
const strip = (nodeModule as unknown as {
  stripTypeScriptTypes?: (source: string) => string;
}).stripTypeScriptTypes;

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith('.ts') && !name.endsWith('.d.ts') ? [full] : [];
  });
}

const files = tsFiles(LIB);

test('the check itself is armed', () => {
  /* Two ways this suite could pass while testing nothing, both worth failing
     loudly for. An empty file list makes every assertion below vacuous, and a
     missing strip API makes each one a no-op - the same "an empty result from a
     broken check is indistinguishable from a clean run" trap that this whole
     class of defect is about, which would be a poor thing for this file in
     particular to fall into.

     If Node ever drops or renames the experimental API, this fails and someone
     decides what to do. It does not quietly stop protecting anything. */
  assert.equal(typeof strip, 'function',
    'node:module.stripTypeScriptTypes is unavailable - this suite would pass without checking anything');
  assert.ok(files.length > 10, `found ${files.length} lib modules, expected the directory to be populated`);
});

for (const file of files) {
  const rel = path.relative(path.join(LIB, '..'), file).replace(/\\/g, '/');

  test(`${rel} strips without emit-generating syntax`, () => {
    if (typeof strip !== 'function') return;   // reported by 'the check itself is armed'
    const source = readFileSync(file, 'utf8');
    try {
      strip(source);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
        assert.fail(
          `${rel} uses TypeScript that emits runtime code (parameter property, enum, ` +
          `namespace or decorator). It compiles in production and cannot be loaded by ` +
          `node --test, so nothing under __tests__ can ever import it. Declare and ` +
          `assign instead - see the note at the top of lib/pool.ts.\n  ${(e as Error).message}`,
        );
      }
      /* Any other parse failure is a different problem and not this test's
         business to adjudicate - tsc already covers syntax validity. */
    }
  });
}
