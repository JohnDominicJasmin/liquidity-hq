/**
 * THE ACCEPTANCE CONDITION FOR AN EXPERIMENTAL NEXT FLAG, ASSERTED.
 *
 * PM/DevOps accepted `experimental: { globalNotFound: true }` in `next.config.ts` on one
 * stated ground: **if the key is ever renamed or removed by Next, the build fails LOUDLY
 * at build time rather than silently doing nothing.** That loudness is the whole basis of
 * the decision, so it is the thing worth guarding.
 *
 * WHERE THE LOUDNESS ACTUALLY COMES FROM, measured rather than assumed: Next's own config
 * validation only **warns** on an unrecognised `experimental` key. The non-zero exit comes
 * from the **TypeScript check**, because the config object is annotated `NextConfig` and an
 * unknown property is a type error. So the guarantee is not Next's - it is tsc's, and it
 * rests on four separate things staying true. Any one of them can be lost by a change that
 * looks like tidying, and all four are static reads.
 *
 * ── WHAT THIS TEST IS NOT ───────────────────────────────────────────────────────────────
 *
 * It does NOT assert the outcome. Asserting the outcome means planting a bogus experimental
 * key and running a full build - slow, and it belongs to whoever owns the build rather than
 * here. These are the conditions the outcome rests on.
 *
 * ⚠️ AND FOUR CONDITIONS IS A LIST, WHICH IS EVIDENCE THE CLASS WAS NOT NAMED. The class is
 * "an unknown key in `next.config.ts` fails the build". What follows is four ways to lose
 * that, not a proof there is no fifth. If you find a fifth, ADD IT HERE rather than
 * concluding this file already covered it - a list that is trusted as exhaustive is worse
 * than one that admits it is not. Dev Team contributed G4, which PM's own three did not
 * include and which is the most likely of the four to happen.
 *
 * Every condition below is true on `dev` at 0324d547, so this passes today and earns its
 * keep later. It is also correct independently of whether the route-group branch ever
 * merges: all four are good practice with or without that flag, which is why it asserts
 * the conditions and never the flag.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = 'next.config.ts';
const configSrc = () => readFileSync(path.join(ROOT, CONFIG), 'utf8');

test('G1. the Next config is TypeScript, and nothing shadows it in JavaScript', () => {
  /* THE POSITIVE CONTROL IS BUILT IN, so no mutation is needed: the same `existsSync` has to
     return TRUE for the line below and FALSE for the three after it. An `existsSync` that
     always answered false - a wrong ROOT, say - fails the first assertion, so the three
     absence checks cannot pass vacuously. Named because an absence check with no positive
     companion is the shape that passes on a broken path. */
  assert.ok(existsSync(path.join(ROOT, CONFIG)), `${CONFIG} is gone - this whole file needs re-deriving`);

  /* A `.js`/`.mjs`/`.cjs` config takes precedence and is invisible to the type system, so a
     rename is the simplest possible way to lose the guarantee while leaving this file here. */
  for (const ext of ['js', 'mjs', 'cjs']) {
    const rival = `next.config.${ext}`;
    assert.equal(
      existsSync(path.join(ROOT, rival)), false,
      `${rival} exists. A JavaScript config is not type-checked, so an unknown experimental key ` +
        `would warn and continue instead of failing the build - the condition the flag was accepted on.`,
    );
  }
});

/** Is either build gate muted in this source? Returns the keys found muted. */
function mutedGates(src: string): string[] {
  const found: string[] = [];
  /* Matched on source text rather than a parsed object because PRESENCE is the defect here,
     and a parse that returned undefined for a mis-nested key would read as absent. `true`
     specifically: an explicit `false` is fine and should not fire. */
  if (/ignoreBuildErrors\s*:\s*true/.test(src)) found.push('typescript.ignoreBuildErrors');
  if (/ignoreDuringBuilds\s*:\s*true/.test(src)) found.push('eslint.ignoreDuringBuilds');
  return found;
}

test('G2. the type and lint gates are not muted for the build', () => {
  /* DETECTOR FIRST, both directions and on synthetic input, so the real check below cannot
     pass because the pattern is broken. Done in memory deliberately: proving this by editing
     the real `next.config.ts` would mean mutating a shared checkout other sessions are
     building from, and a control is not worth that. */
  assert.deepEqual(
    mutedGates('typescript: { ignoreBuildErrors: true },'), ['typescript.ignoreBuildErrors'],
    'the detector misses a muted type gate',
  );
  assert.deepEqual(
    mutedGates('eslint: { ignoreDuringBuilds : true },'), ['eslint.ignoreDuringBuilds'],
    'the detector misses a muted lint gate, or is whitespace-sensitive',
  );
  assert.deepEqual(
    mutedGates('typescript: { ignoreBuildErrors: false },'), [],
    'the detector fires on an explicit false, which is not a mute',
  );

  assert.deepEqual(
    mutedGates(configSrc()), [],
    'a build gate is muted. ignoreBuildErrors is the mechanism that makes an unknown experimental ' +
      'key loud, so muting it removes the condition the flag was accepted on. ignoreDuringBuilds is ' +
      'not the type gate but is the same class of mute, and belongs here so both are found together.',
  );
});

test('G3. TypeScript actually includes next.config.ts in the project', () => {
  /* Resolved with the compiler's OWN config reader, not by parsing tsconfig.json by hand.
     tsconfig is JSONC and it carries a `paths` map containing `@/*` - a hand-rolled
     block-comment strip matches from that `/*` to the next `*\/` and corrupts the file into
     invalid JSON. That happened while writing this test. `ts.readConfigFile` is the parser
     that cannot get it wrong, and it is what the compiler itself uses. */
  const read = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(read.error, undefined, `tsconfig.json did not parse: ${JSON.stringify(read.error?.messageText)}`);

  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);

  /* CONTROL, and it is the assert-your-input rule rather than a formality: an empty or tiny
     resolution would make the check below pass or fail for reasons unrelated to the config
     file. A resolution that collapsed to nothing must not read as a verdict. */
  assert.ok(
    parsed.fileNames.length > 100,
    `CONTROL: tsconfig resolved only ${parsed.fileNames.length} files. The project resolution is ` +
      `broken or near-empty, so the next assertion cannot mean anything. Fix this first.`,
  );

  /* The DIRECT form of the condition. Asserting that `include` contains the `**\/*.ts` glob
     (escaped here: an unescaped one closes this comment, which is how this file first failed
     to parse) would be a proxy, and would miss an `exclude` entry, a narrowed `files` list,
     or a second tsconfig
     taking over. Asking the compiler which files are in the project cannot be routed around. */
  const named = (p: ts.ParsedCommandLine) =>
    p.fileNames.filter((f) => f.replace(/\\/g, '/').endsWith(`/${CONFIG}`));

  /* CONTROL, the other direction: the same resolution path must be able to report the config
     ABSENT. Re-parsed in memory with a narrowed `include` - no file on disk is touched - so a
     zero below would be a real exclusion rather than a filter that never matches anything.
     Without this, `length === 1` passing proves only that the filter found something once. */
  const narrowed = ts.parseJsonConfigFileContent(
    { ...read.config, include: ['lib/**/*.ts'], exclude: ['node_modules'] }, ts.sys, ROOT,
  );
  assert.ok(narrowed.fileNames.length > 0, 'CONTROL: the narrowed re-parse resolved nothing at all');
  assert.equal(
    named(narrowed).length, 0,
    'CONTROL: a tsconfig narrowed to lib/ still reports next.config.ts as in the project, so this ' +
      'check cannot detect the exclusion it exists to detect.',
  );

  const inProject = named(parsed);
  assert.equal(
    inProject.length, 1,
    `tsconfig resolves ${inProject.length} files named ${CONFIG} (expected exactly 1). If 0, the ` +
      `config is outside the type-checked project - narrowed \`include\`, a new \`exclude\`, or a ` +
      `\`files\` list - and an unknown experimental key stops being a build error.`,
  );
});

/** Does this source annotate its default-exported config object with a type? */
function annotatesConfig(src: string): boolean {
  const sf = ts.createSourceFile('next.config.ts', src, ts.ScriptTarget.Latest, true);
  let found = false;
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.type && ts.isIdentifier(n.name) && n.name.text === 'nextConfig') {
      if (/NextConfig/.test(n.type.getText(sf))) found = true;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

test('G4. the config object is still annotated - the one-token way to lose this', () => {
  /* THE DETECTOR FIRST, both directions, because a matcher that cannot return both answers
     proves nothing by returning one. */
  assert.equal(
    annotatesConfig("import type { NextConfig } from 'next';\nconst nextConfig: NextConfig = {};\nexport default nextConfig;"),
    true, 'the detector misses a known-annotated config',
  );
  assert.equal(
    annotatesConfig("const nextConfig = {};\nexport default nextConfig;"),
    false, 'the detector reports an annotation on a config that has none',
  );

  /* WHY THIS ONE IS THE LIKELY ONE. Dropping the annotation - `const nextConfig = {` -
     leaves the file TypeScript (G1 passes), leaves both gates unmuted (G2 passes), leaves
     tsconfig covering it (G3 passes), and still silently stops catching unknown experimental
     keys, because there is no longer a type to check the object against. One token, looks
     like tidying, and all three of the other conditions keep reporting green. */
  assert.ok(
    annotatesConfig(configSrc()),
    `${CONFIG} no longer annotates nextConfig with NextConfig. The object is now checked against ` +
      `nothing, so an unknown or renamed experimental key is accepted silently - G1, G2 and G3 all ` +
      `still pass while the guarantee is gone. Restore \`const nextConfig: NextConfig = {\`.`,
  );
});
