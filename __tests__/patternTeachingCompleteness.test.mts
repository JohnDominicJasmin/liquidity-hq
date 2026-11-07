/* #1818 Phase 2 Part B: every pattern the chart can NAME must have something to TEACH.
 *
 * ── THIS IS NOT A REPORT THAT DEV MISSED SOMETHING ───────────────────────────────────────────────
 *
 * Both maps are deliberately `Partial<Record<PatternType, ...>>`, and `PatternIllustration.tsx:141`
 * says why in as many words: a total record *"would make us draw a picture of a feature that does
 * not exist in order to compile"*. That reasoning is right. Forcing completeness through the type
 * system would buy compile-time safety by making the only escape a placeholder drawing, which is
 * worse than an absence.
 *
 * WHAT `Partial` TRADES AWAY IS VISIBILITY, AND THAT IS WHAT THIS FILE SUPPLIES. The code compiles
 * with 7 of 12 covered and nothing anywhere reports the other 5. `PatternPanel.tsx:84` resolves
 * `COPY[type] ?? null` and `:108` does `if (!copy) return null`, so a chart that names a wedge
 * renders NO panel at all - no error, no placeholder, no log. The feature is simply absent for that
 * pattern, and absent in a way no gate can see.
 *
 * 7 OF 12 IS THE RATIO THAT FOOLS A SPOT CHECK. Open the Arena a few times and you land on a flag,
 * a channel or a range - all covered - and conclude the panel works. The gap only shows on a wedge
 * or a triangle, which `chartPatterns.ts` returns from real geometry.
 *
 * ── IT LANDS RED, ON PURPOSE, AND THAT IS DIFFERENT FROM A PLACEHOLDER ──────────────────────────
 *
 * A permanently-red cell is as useless as a permanently-green one: people learn to ignore the
 * colour. The distinction here is that the component EXISTS and the gap is REAL, so red is
 * actionable today - it means "write the five", not "this is not built yet". There are exactly two
 * honest ways to green it, and the failure message names both so nobody has to guess:
 *
 *   1. add copy and an illustration for the five remaining types, or
 *   2. narrow PATTERN_TYPES so the chart stops naming patterns the panel cannot teach.
 *
 * Both are legitimate. Deleting this cell is not.
 *
 * ── THE EXPECTED SET IS DERIVED, NEVER TYPED OUT ────────────────────────────────────────────────
 *
 * `PATTERN_TYPES` is the source of truth. If this file hardcoded twelve names it would stop
 * tracking the type union the moment a thirteenth arrived - which is precisely the failure it
 * exists to catch, so writing it that way would be self-defeating.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_appPath.mts';
import { PATTERN_TYPES } from '../lib/chartPatterns.ts';

const labels = JSON.parse(readFileSync(path.join(ROOT, 'lib/labelDefaults.en.json'), 'utf8'));
const panelSrc = readFileSync(path.join(ROOT, 'components/PatternPanel.tsx'), 'utf8');
const illustrationSrc = readFileSync(path.join(ROOT, 'components/patterns/PatternIllustration.tsx'), 'utf8');

/** `bull_flag` -> `PATTERN_BULL_FLAG_`, the convention every existing key follows. */
const keyPrefix = (type: string) => `PATTERN_${type.toUpperCase()}_`;
const SUFFIXES = ['NAME', 'WHAT', 'WATCH'];

test('C1. CONTROL: the derivation reads both maps, so the gaps below are real', () => {
  /* Without this, a regex that stopped matching would report every type as missing and the cell
     would look like a catastrophic finding instead of a broken scan. */
  assert.ok(PATTERN_TYPES.length >= 12,
    `only ${PATTERN_TYPES.length} entries in PATTERN_TYPES - the import is wrong, so every count below is meaningless`);

  const copyKeys = [...panelSrc.matchAll(/'(PATTERN_[A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(copyKeys.length >= 21,
    `only ${copyKeys.length} PATTERN_* keys found in PatternPanel.tsx; 7 covered types x 3 keys is 21. The scan is broken.`);

  const illustrated = [...illustrationSrc.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(illustrated.some((t) => PATTERN_TYPES.includes(t as never)),
    `no PATTERN_ILLUSTRATIONS entry matched a PATTERN_TYPES member (found: ${illustrated.join(', ') || 'none'})`);

  /* And the positive control proper: a type known to BE covered must come back covered. If
     bull_flag reads as missing, the matcher is wrong rather than the product. */
  for (const s of SUFFIXES) {
    assert.ok(`${keyPrefix('bull_flag')}${s}` in labels,
      `${keyPrefix('bull_flag')}${s} is absent from labelDefaults - bull_flag is known-covered, so this scan is broken`);
  }
});

test('C2. every PATTERN_TYPES member has teaching copy in labelDefaults.en.json', () => {
  const missing = [];
  for (const type of PATTERN_TYPES) {
    const absent = SUFFIXES.filter((s) => !(`${keyPrefix(type)}${s}` in labels));
    if (absent.length) missing.push(`${type} (no ${absent.join(', ')})`);
  }

  assert.deepEqual(missing, [],
    `${missing.length} of ${PATTERN_TYPES.length} pattern types have NO teaching copy:\n  ` +
    missing.join('\n  ') +
    '\n\nThe chart names these from real geometry (lib/chartPatterns.ts classifies triangles and ' +
    'wedges), and PatternPanel.tsx:108 does `if (!copy) return null` - so the panel renders NOTHING ' +
    'for them. Silently: no error, no placeholder.\n' +
    'TWO WAYS TO FIX, both legitimate:\n' +
    '  1. write PATTERN_<TYPE>_NAME/_WHAT/_WATCH for each type listed above, or\n' +
    '  2. narrow PATTERN_TYPES so the chart stops naming patterns the panel cannot teach.\n' +
    'The copy is user-facing and the keys live in 4 locales plus lhq_labels, so option 1 is the ' +
    "owner's to approve, not dev's to invent.");
});

test('C3. every PATTERN_TYPES member is wired into the panel COPY map', () => {
  /* Separate from C2 because the two can disagree: a key can exist in labelDefaults and never be
     referenced by the panel, which renders nothing just the same. The label file is where the words
     live; the COPY map is what reaches the screen. */
  const referenced = new Set([...panelSrc.matchAll(/'(PATTERN_[A-Z_]+)'/g)].map((m) => m[1]));
  const unwired = PATTERN_TYPES.filter((type) => !SUFFIXES.every((s) => referenced.has(`${keyPrefix(type)}${s}`)));

  assert.deepEqual(unwired, [],
    `${unwired.length} pattern types are not wired into PatternPanel's COPY map: ${unwired.join(', ')}.\n` +
    'The map is `satisfies Partial<Record<PatternType, ...>>`, and the `Partial` is why the compiler ' +
    'does not catch this. That is a DELIBERATE and correct choice - the file says a total record ' +
    '"would make us draw a picture of a feature that does not exist in order to compile" - so this ' +
    'cell supplies the visibility Partial trades away rather than arguing for its removal.\n' +
    'Once all 12 are covered, dropping `Partial` would make the compiler hold the line and this ' +
    'assertion becomes redundant - which is the better end state.');
});

test('C4. every PATTERN_TYPES member has an illustration', () => {
  /* PATTERN_ILLUSTRATIONS is Partial for the same stated reason. Checked separately from the copy
     because a type could plausibly get words and no drawing, and the panel reserves a 96x58 box for
     one either way. */
  const drawn = new Set([...illustrationSrc.matchAll(/^\s{2}([a-z_]+):\s/gm)].map((m) => m[1]));
  const undrawn = PATTERN_TYPES.filter((t) => !drawn.has(t));

  assert.deepEqual(undrawn, [],
    `${undrawn.length} pattern types have no entry in PATTERN_ILLUSTRATIONS: ${undrawn.join(', ')}.\n` +
    'Same two fixes as C2: draw them, or narrow PATTERN_TYPES. `illustrationFor` returns null for ' +
    'these, so the panel would show text beside an empty box if copy ever lands without a drawing.');
});

test('C5. no PATTERN_* copy predicts price or prescribes a trade', () => {
  /* SCANNED BY PREFIX, NOT FROM A LIST OF THE SEVEN THAT EXIST. That is the whole value: the five
     missing types from C2 come under this check automatically on the day someone writes them, which
     is the day the vocabulary actually matters. A cell enumerating today's keys would pass forever
     and guard nothing new.
     The ban is the one already agreed for this panel, and it is the same class the #1185 sweep found
     product-wide - /disclaimer promises these metrics "do not predict future price movement" while
     ~20 strings elsewhere do exactly that. This cell stops the teaching panel joining them. */
  const BANNED = [
    [/\b(usually|typically|tends? to|often|likely|unlikely)\b/i, 'likelihood claim'],
    [/\b(will|won't|going to|about to)\s+\w/i, 'prediction'],
    [/\b(resolves?|pending|imminent|expect|target)\b/i, 'outcome prediction'],
    [/\b(you should|buy|sell|enter|exit|take profit|stop out)\b/i, 'trade instruction'],
    [/\b\d{1,3}(\.\d+)?%/, 'a percentage, which reads as a probability'],
    [/\b(continuation|reversal)\b/i, 'continuation/reversal as an outcome'],
  ] as const;

  const patternKeys = Object.keys(labels).filter((k) => /^PATTERN_/.test(k));
  assert.ok(patternKeys.length >= 21,
    `only ${patternKeys.length} PATTERN_* keys in labelDefaults - the prefix scan is broken, so a clean result below would be a false pass`);

  const offenders: string[] = [];
  for (const key of patternKeys) {
    const val = labels[key];
    if (typeof val !== 'string') continue;
    for (const [rx, why] of BANNED) {
      if (rx.test(val)) offenders.push(`${key}: ${why}\n      ${JSON.stringify(val).slice(0, 160)}`);
    }
  }

  assert.deepEqual(offenders, [],
    `pattern teaching copy must describe the shape, never forecast it:\n  ${offenders.join('\n  ')}\n\n` +
    'Describe what the shape IS and what traders WATCH. Not what price does next.');
});

test('C6. every _WATCH string describes what traders watch, rather than instructing the reader', () => {
  /* The _WATCH key is the one most likely to drift into advice, because its job is to say what
     people do about the shape. The convention Dev established is to open "Traders watch", which
     attributes the behaviour to traders rather than telling the reader to do it - and that framing
     is what keeps the whole key out of C5's "trade instruction" class.
     Pinned so a later author does not reach for the shorter "Watch for..." and turn a description
     into an imperative. */
  const watchKeys = Object.keys(labels).filter((k) => /^PATTERN_.*_WATCH$/.test(k));
  assert.ok(watchKeys.length >= 7, `only ${watchKeys.length} PATTERN_*_WATCH keys found - scan broken`);

  const imperative = watchKeys.filter((k) => !/^traders\b/i.test(String(labels[k]).trim()));
  assert.deepEqual(imperative, [],
    `${imperative.join(', ')} do not open by attributing the behaviour to traders. ` +
    '"Traders watch for X" describes a market; "Watch for X" instructs the reader, which is the ' +
    'line this panel is not allowed to cross.');
});

test('C7. the panel RESERVES its height before the dismissal state is known', () => {
  /* WHY THIS IS A SOURCE ASSERTION AND NOT A BROWSER ONE. The property is "the box occupies its
     space before the answer arrives", which is visible in the render path and does not need a
     deployed page. perf.spec.ts already measures the CONSEQUENCE - /arena CLS under 0.1, which has
     really fired, at 0.146 in run 42057776390 - but it only sees shifts inside navigation + ~3.7s
     (settle waits 2500ms, then the observer collects 1200ms with buffered:true replaying the gap).
     A dismissal read that ever moves from localStorage to a database could land outside that
     window. This cell asserts the property that survives that change. */
  assert.match(panelSrc, /visibility:\s*state === 'pending' \? 'hidden' : 'visible'/,
    "the 'pending' state must render HIDDEN at full height, not be skipped. If the panel returns " +
    'early or renders nothing while the dismissal state is unknown, it inserts post-paint and gives ' +
    "back the CLS win #1987 bought on /arena (0.365 -> 0.068, and 0.146 failing as recently as run " +
    '42057776390).');

  /* The reservation is worth nothing if an early return beats it. :108 `if (!copy) return null`
     already does exactly that for any uncovered type - which is why C8 exists. */
  const reservationIdx = panelSrc.search(/visibility:\s*state === 'pending'/);
  const earlyReturns = [...panelSrc.matchAll(/\breturn null;/g)].map((m) => m.index ?? 0)
    .filter((i) => i < reservationIdx);
  assert.ok(earlyReturns.length <= 1,
    `${earlyReturns.length} early \`return null\` statements run BEFORE the height reservation. ` +
    'Each one is a path on which no space is reserved. One is known and tracked by C8; more than ' +
    'that means a new unreserved path has been added.');
});

test('C8. SCOPE: exactly five types are uncovered, so C7 cannot quietly keep testing 7 of 12', () => {
  /* THE HALF THAT STOPS C7 PASSING VACUOUSLY. C7 asserts a property of the render path, but
     `:108 if (!copy) return null` means the path is never reached for a type with no copy - so the
     reservation is untested for those, and scoping C7 "to covered types" alone would silently keep
     testing 7 of 12 forever.
     So the uncovered set is pinned HERE, and hardcoded ONLY here. Everything else in this file
     derives from PATTERN_TYPES. */
  const UNCOVERED_TODAY = ['wedge_rising', 'wedge_falling', 'triangle_asc', 'triangle_desc', 'triangle_sym'];
  const referenced = new Set([...panelSrc.matchAll(/'(PATTERN_[A-Z_]+)'/g)].map((m) => m[1]));
  const uncovered = PATTERN_TYPES.filter(
    (t) => !SUFFIXES.every((s) => referenced.has(`PATTERN_${t.toUpperCase()}_${s}`)));

  assert.deepEqual([...uncovered].sort(), [...UNCOVERED_TODAY].sort(),
    `the uncovered set has changed - it is now [${uncovered.join(', ')}].\n\n` +
    'IF THIS IS RED BECAUSE THE SET SHRANK, THAT IS GOOD NEWS: copy has been written. Widen C7 to ' +
    'cover the newly covered types and update the list here in the same commit.\n' +
    'IF IT GREW, a type was added to PATTERN_TYPES without copy and the panel renders nothing for ' +
    'it - see C2.\n' +
    'Either way this is the one assertion in this file allowed to name types explicitly; it exists ' +
    'so C7 cannot keep covering 7 of 12 while 12 exist.');
});
