/* #1889: THE ALARM ON §14's NEW PREMISE. Landing does not read the label table - assert it stays that way.
 *
 * WHY THIS FILE EXISTS, and it is a rule change rather than a defect. `docs/HANDOVER.md` §14 made
 * "landing renders identically" a hard gate on four files, two of which were `lib/labelKeys.ts` and
 * `lib/labelDefaults.en.json`. On 2026-10-31 a rendered comparison measured that **landing cannot read
 * either**: `app/page.tsx` passes a dictionary prop, `useLabels` count was 0 across every component in
 * its subtree, and blanking one of #1852's own changed label values produced noise-floor pixels only and
 * zero occurrences in the rendered text. So the gate could not fail for those two files - it was a
 * formality that cost a render - and #1889 replaced them with `lib/i18n/dictionaries.ts`, which is what
 * actually changes landing copy.
 *
 * **A RULE THAT RESTS ON A MEASUREMENT NEEDS AN ALARM ON THE MEASUREMENT.** PM/DevOps asked for this and
 * was right to: "0 useLabels in landing's subtree" is true today and nothing stops someone adding one.
 * Without this cell we would have swapped a stale rule for a newer stale rule, which is the failure
 * `docs/OWNER-BLOCKERS.md` exists to catch - an instruction with no expiry.
 *
 * WHAT GOES WRONG IF THIS CELL IS DELETED RATHER THAN FIXED: a landing component starts reading the label
 * table, the two label files stop being gated because #1889 removed them from the trigger list, and a
 * label change reaches `/` with nothing rendering it first. That is the exact shape of the defect §14 was
 * written for (`AppShell.tsx` rendering `PriceTickerStrip` on `/`), arriving through a rule we relaxed.
 *
 * THE SUBTREE IS WALKED, NOT LISTED. A hardcoded list of components is a source-text pin: it goes stale
 * the moment one is added, and - worse - a NEW component calling `useLabels` is exactly what this cell
 * exists to catch, so a fixed list would be blind to the only thing it is for. The walk follows static
 * and dynamic imports from `app/page.tsx` and fails loudly if it finds implausibly few files.
 *
 * NO NETWORK, NO BROWSER, NO BUILD: this reads source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, appPath } from './_appPath.mts';


/* COMMENTS ARE STRIPPED BEFORE ANY SCAN, and the reason is close to funny.
 *
 * L2's failure message tells the next reader to make a component take its copy as a prop and, by
 * implication, to say so. **A landing component carrying the comment "deliberately does not call
 * useLabels()" would have turned L2 RED** - the loudest failure in the suite, instructing someone
 * to undo the thing they had just done correctly.
 *
 * Not hypothetical: Dev found `components/LabelsProvider.tsx`'s only `useLabels(` is inside a
 * comment, which is why L1's consumer control counted 77 against 76 stripped. Harmless in a control
 * that wants a floor; not harmless in L2, which names files.
 *
 * Grep-inside-comments has now produced four false findings in one day across both sessions -
 * including Dev's deadness check on HOURS_WIN_LONDON_TIME, whose two "still referenced" hits were
 * both inside the comment explaining its deletion. */
/* TRAILING `//` COMMENTS ARE STRIPPED TOO, and the gap mattered more than the fix it was part of.
 *
 * This was `/^\s*\/\/.*$/gm` - anchored at the start of a line - so it removed a comment on its own
 * line and left this one:
 *
 *     const copy = props.copy; // deliberately not useLabels()
 *
 * **That is the form L2's own failure message invites.** The message tells the reader to take the
 * copy as a prop, and someone doing that annotates the line they changed, not the line above it. So
 * the false positive the strip was added to remove survived in its most likely shape. Dev measured
 * all four forms and found three of four stripped.
 *
 * REQUIRING WHITESPACE BEFORE THE `//` is what keeps a URL intact, and my first attempt got this
 * wrong in a way L0 caught before it shipped. I tried `[^:/]`, which protects `://` and `///` but
 * NOT the second slash pair in `"https://example.invalid/a//b"` - the character before it is `a`,
 * so the strip ate the rest of the line. A comment conventionally has whitespace in front of it and
 * a URL's inner `//` does not, which is the distinction that holds.
 *
 * THE BOUND, since it is a real one: `foo();//note` with no space is NOT stripped. Acceptable - the
 * forms this exists for are a comment on its own line and a comment after code, both spaced. L0
 * asserts the URL survives, so the day someone simplifies this to `\/\/.*$` the cell fails and this
 * paragraph is what needs rewriting. */
const stripTsComments = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (rel: string) => stripTsComments(readFileSync(path.join(ROOT, rel), 'utf8'));

/** `useLabels` is DEFINED here, so its own file is not a consumer of it. The one exemption, named. */
const LABELS_MODULE = 'lib/labels.ts';

/* Both forms, because a dynamic import is how a heavy component usually arrives and missing it would
   under-count the walk silently - the worst outcome available in a control. */
const SPECIFIERS = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

/* `import type ... from` and `import { type X }` are erased at compile time, so they are not render
   edges. Dropped by line, which is crude but safe in the only direction that matters: a missed TYPE
   edge cannot hide a component that renders, while FOLLOWING one produces exactly the false positive
   this cell hit on its first run - see RENDER_EDGES_ONLY below. */
const isTypeOnlyLine = (line: string) => /^\s*import\s+type\b/.test(line) || /^\s*import\s*\{\s*type\s/.test(line);

/** Repo-relative path for an import specifier, or null for anything outside the repo's own source. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('./') || spec.startsWith('../')) base = path.posix.join(path.posix.dirname(fromFile), spec);
  else return null; // react, next, node:*, a package - not ours
  for (const cand of [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (/\.(tsx|ts)$/.test(cand) && existsSync(path.join(ROOT, cand))) return cand;
  }
  return null;
}

/* ── RENDER EDGES ONLY, AND THE FIRST RUN IS WHY ─────────────────────────────────────────────────
 *
 * This walk followed EVERY import at first, and L2 went red naming `components/KLineProChart.tsx`.
 * The chain was real and the conclusion was not:
 *
 *   app/page.tsx -> LandingContent.tsx -> LandingTerminal.tsx -> lib/planFeatures.ts
 *     -> lib/limits.ts -> components/KLineProChart.tsx
 *
 * and the last hop is `lib/limits.ts:49`:
 *
 *   const _tfsMatchChart: ExactTf<ArenaTf, import('../components/KLineProChart.tsx').ChartTf> = true;
 *
 * **A type reference in a type position.** It is erased at compile time, nothing renders, and the
 * chart is not on landing. **Import-reachability is not render-reachability**, and I had written a
 * cell that conflated them - which would have reported the premise behind #1889 as broken on the
 * strength of a type assertion.
 *
 * SO: only `.tsx` files are traversed, because only a file that renders can call a React hook, and
 * only a `.tsx` can contain JSX. Type-only statements are skipped as well.
 *
 * THE BOUND, STATED RATHER THAN DISCOVERED LATER: a component reached ONLY through a `.ts`
 * re-export - a barrel file - would be invisible to this walk. Nothing in this repo imports
 * components that way (they all come in as `@/components/X`), and L4 asserts it stays that way, so
 * the gap is closed loudly instead of being left to a comment. */
function reachableFrom(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const line of read(file).split('\n')) {
      if (isTypeOnlyLine(line)) continue;
      for (const m of line.matchAll(SPECIFIERS)) {
        const next = resolveSpecifier(file, m[1] ?? '');
        /* `.tsx` only: a renderer is a renderer, and a `.ts` module cannot hold JSX or a hook call. */
        if (next && next.endsWith('.tsx') && !seen.has(next)) queue.push(next);
      }
    }
  }
  return [...seen].sort();
}

/** Every repo source file reachable by ANY import, type edges included - for L4's barrel check. */
function allReachableFrom(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of read(file).matchAll(SPECIFIERS)) {
      const next = resolveSpecifier(file, m[1] ?? '');
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen].sort();
}

/* BOTH LANDING ROUTES, not just the one. `app/(main)/page.tsx` serves `/` and
 * `app/(intl)/[locale]/page.tsx` serves `/ko` and `/zh` - and the two files DIFFER (measured: their
 * metadata and dictionary handling are not the same). They both render `LandingContent`, so the
 * component subtree is identical TODAY and starting from one of them happened to cover the other.
 *
 * **That is an accident, not coverage**, and Dev caught it. Walking both makes it coverage: the
 * moment the intl route renders something of its own, this cell sees it. */
/* BOTH THROUGH THE RESOLVER, and the second one was not. `app/(intl)/[locale]/page.tsx` was
   hardcoded with its route group spelled out - correct today and silently wrong the next time a
   group moves, which is the whole failure #1413 tracks. `appPath('app/[locale]/page.tsx')`
   resolves to the same file today (verified) and keeps resolving to it afterwards. */
const LANDING_ROUTES = [appPath('app/page.tsx'), appPath('app/[locale]/page.tsx')]
  .filter((p) => existsSync(path.join(ROOT, p)));
const LANDING = LANDING_ROUTES.join(' + ');
const SUBTREE = [...new Set(LANDING_ROUTES.flatMap((r) => reachableFrom(r)))].sort();
const ALL_REACHABLE = [...new Set(LANDING_ROUTES.flatMap((r) => allReachableFrom(r)))].sort();

test('L0. CONTROLS: the comment strip removes prose and keeps code - in all four comment forms', () => {
  /* WHY THIS CELL EXISTS, and Dev is the reason it does. `stripTsComments` discards input before
     any scan in this file, so if it is ever tightened or loosened, **all four cells below change
     meaning with nothing failing.** That is the shape L4 exists to prevent one level up: a
     narrowing that deserves a cell rather than a comment.
     It went in on #1909 with its controls living only in a scratchpad harness - which is to say,
     nowhere. Committed here. */
  const probe = [
    '  // own-line: useLabels() in prose',
    '  const a = 1; // trailing: useLabels() in prose',
    '  /* block: useLabels() in prose */',
    '  /* multi-line block:',
    '     useLabels() in prose */',
    '  const { t } = useLabels();',
    '  const u = "https://example.invalid/a//b";',
  ].join('\n');
  const out = stripTsComments(probe);

  /* All four comment forms must lose their prose. The trailing form is the one that survived until
     now, and it is the one L2's failure message invites someone to write. */
  assert.equal(
    (out.match(/useLabels\(\)/g) || []).length, 1,
    `the strip left ${(out.match(/useLabels\(\)/g) || []).length} occurrences of useLabels() instead of 1 - ` +
    `only the real call should survive. Output was:\n${out}`,
  );
  assert.match(out, /const \{ t \} = useLabels\(\);/, 'the strip removed a REAL call - every cell in this file would then be blind');
  assert.match(out, /const a = 1;/, 'the strip ate the code before a trailing comment, not just the comment');

  /* THE COST OF WIDENING, asserted rather than trusted: `//` inside a string must survive. This is
     the assertion that fails the day someone simplifies the pattern to `\/\/.*$`, which is exactly
     when the paragraph above the strip needs rewriting. */
  assert.match(out, /https:\/\/example\.invalid\/a\/\/b/, 'the strip ate a URL - widen it again and this file starts reading truncated source');

  /* ── THE KNOWN HOLE, ASSERTED SO IT CANNOT BITE SILENTLY ──────────────────────────────────────
   *
   * `(^|\s)//` strips from ANY whitespace, which includes a `//` inside a string literal:
   *
   *     const u = "a // b"; const { t } = useLabels();
   *
   * The real call is eaten. Dev found this and it is a worse failure than the one the strip fixed:
   * **L2 goes BLIND rather than red.** A cell that names offending files reports a file it cannot
   * see as a clean one, which is the one direction a control must never fail in.
   *
   * A string-aware tokenizer is not worth it for a comment strip, and a comment would not stop it.
   * So the hole is pinned twice: the first assertion records that it EXISTS, so the day someone
   * writes the tokenizer this cell fails and tells them to delete the canary; the second is the
   * canary itself, over the real subtree, so the hole cannot bite without something going red.
   *
   * Measured when written: zero files in `components/`, `app/` and `lib/` contain the shape, and
   * the detector was shown to match a planted instance. */
  /* FOUR FORMS, NOT ONE. The strip is `(^|\s)//`, so it needs whitespace only BEFORE the slashes -
     the space after was never required, and a template literal is a string too. Each of these loses
     the real call, and the widened canary below is calibrated to exactly this set. */
  for (const probe of [
    'const u = "a // b"; const { t } = useLabels();',
    'const u = "a //b"; const { t } = useLabels();',
    'const u = `a // b`; const { t } = useLabels();',
    'const u = `a //b`; const { t } = useLabels();',
  ]) {
    assert.doesNotMatch(
      stripTsComments(probe), /useLabels\(\)/,
      `the strip no longer eats a real call in ${JSON.stringify(probe)}. That is an IMPROVEMENT and ` +
      'this assertion is now wrong: delete it and the canary below, and rewrite the paragraph above ' +
      'the strip, because the bound it describes is gone.',
    );
  }

  /* AND THE TWO IT DOES NOT EAT, so the canary cannot be widened into flagging harmless code.
     `"a//b"` has no whitespace before the slashes, and a URL is the case the `(^|\s)` was added
     for in the first place. A canary that fired on these would send someone rewriting correct
     strings. */
  for (const safe of [
    'const u = "a//b"; const { t } = useLabels();',
    'const u = "https://x"; const { t } = useLabels();',
  ]) {
    assert.match(
      stripTsComments(safe), /useLabels\(\)/,
      `the strip now eats ${JSON.stringify(safe)}, which it did not before. The canary below does ` +
      'NOT guard this shape, so L2 and L3 can now go blind on it - widen DANGEROUS before shipping.',
    );
  }

  /* `[ \t]`, NOT `\s`, AND THIS COST A FALSE POSITIVE BEFORE IT SHIPPED. With `\s` the canary fired
     on `AuthProvider.tsx` and `BrandMark.tsx` - and no single line in either matched. **`\s`
     includes a newline**, so the pattern bridged an apostrophe in one comment, a `//` starting a
     comment line below it, and an apostrophe further down: "don't ... // ... it's". The character
     classes excluded `\n` and the separator did not, which is the whole bug. A string literal lives
     on one line, so the separator must be a space or a tab. */
  /* WIDENED (#1914). This required whitespace on BOTH sides of the slashes and checked only
     " and ' delimiters, while the strip requires whitespace only BEFORE and does not care what
     quotes the string uses. So `"a //b"` and `` `a // b` `` were eaten and unguarded - the exact
     blind-not-red failure the paragraph above says must never happen.

     Measured over all 461 app/lib/components files when widened: the narrow form fired on 3 files,
     this one on 4. The extra is app/api/pine-script/route.ts:39, a prompt string ending
     "...Start directly with //@version=6" - genuinely eaten by the strip, genuinely missed before.
     It is not on landing's import path today, which is why this cell still passes; if it ever
     arrives, red is the correct outcome and blind was not.

     STILL `[ \t]` AND NOT `\s`, for the reason below, and the newline-bridging regression was
     re-checked after widening: zero files match the whole file while no single line matches. */
  const DANGEROUS = /"[^"\n]*[ \t]\/\/[^"\n]*"|'[^'\n]*[ \t]\/\/[^'\n]*'|`[^`\n]*[ \t]\/\/[^`\n]*`/;
  const blinded = SUBTREE.filter((f) => DANGEROUS.test(readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(
    blinded, [],
    `${blinded.join(', ')} contains a string literal with a spaced // in it, and is on landing's ` +
    'import path. The comment strip would truncate that line, so L2 and L3 would stop seeing the ' +
    'rest of the file - BLIND, not red. Either rewrite the literal (join it, or drop the spaces ' +
    'around the //), or make the strip string-aware and delete this canary with L0\'s hole assertion.',
  );
});

test('L1. CONTROLS: the walk reaches landing\'s real subtree, and the detector it feeds can fire', () => {
  /* Without these, every assertion below is satisfied by a walk that found nothing. A silent
     under-count in a control is worse than a loud failure - that is `_appPath.mts`'s own lesson. */
  assert.ok(
    SUBTREE.length >= 6,
    `the render-edge walk from ${LANDING} reached only ${SUBTREE.length} files (${SUBTREE.join(', ')}). ` +
    'A low count means the walk is broken, so L2 and L3 below would be false passes rather than results.',
  );
  for (const expected of ['components/LandingContent.tsx', 'components/LandingTerminal.tsx']) {
    assert.ok(SUBTREE.includes(expected), `the walk did not reach ${expected}, so it is not following landing's imports`);
  }

  /* THE DETECTOR'S POSITIVE CONTROL. `useLabels(` has to be findable somewhere, or L2's "found none"
     means "my pattern does not work" rather than "landing does not read labels". */
  const consumers = readdirSync(path.join(ROOT, 'components'))
    .filter((f) => f.endsWith('.tsx'))
    .filter((f) => /useLabels\s*\(/.test(read(`components/${f}`)));
  assert.ok(
    consumers.length >= 5,
    `only ${consumers.length} components call useLabels(), so the pattern L2 uses is probably broken. ` +
    'There were dozens on 2026-10-31 - this is the control that separates "landing is clean" from ' +
    '"my regex finds nothing anywhere".',
  );
});

test('L2. no component landing renders reads the label table - this is what #1889 rests on', () => {
  const offenders = SUBTREE
    .filter((f) => f !== LABELS_MODULE)
    .filter((f) => /useLabels\s*\(/.test(read(f)));
  assert.deepEqual(
    offenders, [],
    `${offenders.join(', ')} calls useLabels() and is reachable from ${LANDING}. **This invalidates ` +
    'the premise #1889 rests on.** §14 dropped lib/labelKeys.ts and lib/labelDefaults.en.json from its ' +
    'trigger list BECAUSE landing could not read them; if landing reads them now, a label change can ' +
    'alter `/` with no rendered check in the way. Either revert that component to taking its copy as a ' +
    'prop from lib/i18n/dictionaries.ts, or put the two label files back in §14 and say so there. ' +
    'Do NOT delete this cell to make the suite green.',
  );
});

test('L3. no labels context is provided above landing, so a label value could not reach it even if read', () => {
  /* The second half of the measurement, and it fails independently of L2. A component could call
     useLabels() with no provider above it and silently get DEFAULT_LABELS_CONTEXT, whose `t` is
     `key => key` - so the two assertions answer different questions and both matter. */
  const providers = SUBTREE.filter((f) => /<LabelsProvider\b/.test(read(f)));
  assert.deepEqual(
    providers, [],
    `${providers.join(', ')} renders <LabelsProvider> and is reachable from ${LANDING}. The label table ` +
    'would then be live on `/`. On 2026-10-31 the only renderer was components/AppShell.tsx, which is ' +
    'NOT on landing\'s path and IS still in §14\'s trigger list - that separation is the thing this ' +
    'cell protects.',
  );
});

test('L4. no .ts module on landing\'s path re-exports a component, so the render-edge walk cannot be routed around', () => {
  /* THE BOUND OF L2 AND L3, CHECKED RATHER THAN DOCUMENTED. The walk those two use follows `.tsx`
     files only - a deliberate narrowing, after the first run reported a false positive from a TYPE
     reference in `lib/limits.ts:49`. The cost of that narrowing is that a component reached only
     through a `.ts` barrel would be invisible. Nothing does that here, and this cell is what tells
     us if that changes, rather than a comment hoping someone reads it. */
  const barrels = ALL_REACHABLE
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => read(f).split('\n').some((l) => /^\s*export\s[^;]*from\s*['"][^'"]*components\//.test(l)));
  assert.deepEqual(
    barrels, [],
    `${barrels.join(', ')} re-exports from components/ and is on landing's import path. L2 and L3 walk ` +
    '.tsx files only, so a component arriving through this module would not be checked by them. Either ' +
    'import that component directly where it is rendered, or widen reachableFrom() to follow this ' +
    'module - do not leave the hole open.',
  );
  /* The control: the full walk is genuinely larger than the render-edge one, so this cell is looking
     at something L2 does not. If they were equal, L4 would be asserting nothing. */
  assert.ok(
    ALL_REACHABLE.length > SUBTREE.length,
    `the full walk (${ALL_REACHABLE.length}) is not larger than the render-edge walk (${SUBTREE.length}), ` +
    'so one of the two is broken and this cell is not covering the gap it claims to.',
  );
});
