import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plainSummary } from '../lib/plainSummary.ts';
import type { SummaryLevel } from '../lib/plainSummary.ts';

/* Coverage for #2116 - the one plain-English line above the AI read.
 *
 * A pure function returning label keys, so these are real unit tests end to end: no component, no
 * mock, no network. That shape is the point of the design - the copy stays translatable and the
 * logic stays targetable.
 *
 * LEVELS ARE PASSED UNSORTED ON PURPOSE. "The highest support" and "the lowest resistance" are the
 * whole behaviour, and a sorted fixture would let a function that simply takes the first element
 * pass every cell.
 */

const L = (price: number, type: 'support' | 'resistance'): SummaryLevel => ({ price, type });

/** Supports 100/120/110 and resistances 200/180 - deliberately not in order. */
const BOTH_SIDES: SummaryLevel[] = [
  L(100, 'support'), L(120, 'support'), L(110, 'support'),
  L(200, 'resistance'), L(180, 'resistance'),
];

test('S1. bearish watches the HIGHEST support and cancels on the LOWEST resistance', () => {
  const s = plainSummary('BEARISH', BOTH_SIDES);
  assert.ok(s, 'BEARISH is a known tier and must produce a line');
  assert.equal(s.verdictKey, 'ARENA_PLAIN_SUMMARY_BEARISH');
  assert.equal(s.watch?.key, 'ARENA_PLAIN_SUMMARY_WATCH_BELOW', 'a bearish read is confirmed by a break DOWN');
  assert.equal(s.watch?.price, '$120', 'the highest support is the nearest one below, so it is the level to watch');
  assert.equal(s.cancel?.key, 'ARENA_PLAIN_SUMMARY_CANCEL_ABOVE');
  assert.equal(s.cancel?.price, '$180', 'the lowest resistance is the nearest one above, so it is what cancels');
});

test('S2. bullish is the exact mirror', () => {
  const s = plainSummary('BULLISH', BOTH_SIDES);
  assert.ok(s);
  assert.equal(s.watch?.key, 'ARENA_PLAIN_SUMMARY_WATCH_ABOVE');
  assert.equal(s.watch?.price, '$180', 'bullish watches the nearest resistance above');
  assert.equal(s.cancel?.key, 'ARENA_PLAIN_SUMMARY_CANCEL_BELOW');
  assert.equal(s.cancel?.price, '$120', 'bullish is cancelled by losing the nearest support below');

  /* The mirror asserted as a relationship, not just as two literals: the levels swap roles between
     the two directions, which is what makes a copy-paste error in one branch visible. */
  const bear = plainSummary('BEARISH', BOTH_SIDES);
  assert.equal(s.watch?.price, bear?.cancel?.price, "bullish's watch level is bearish's cancel level");
  assert.equal(s.cancel?.price, bear?.watch?.price, "bullish's cancel level is bearish's watch level");
});

test('S3. a missing side drops its clause and nothing else', () => {
  const noResistance = plainSummary('BEARISH', [L(100, 'support'), L(120, 'support')]);
  assert.equal(noResistance?.watch?.price, '$120', 'the side that exists still renders');
  assert.equal(noResistance?.cancel, undefined, 'the absent side must be omitted, not invented');

  const none = plainSummary('LEAN BEARISH', []);
  assert.equal(none?.verdictKey, 'ARENA_PLAIN_SUMMARY_LEAN_BEARISH', 'a read with no levels still gets its verdict');
  assert.equal(none?.watch, undefined);
  assert.equal(none?.cancel, undefined);
});

test('S4. FLAT gets the verdict sentence only', () => {
  const s = plainSummary('FLAT', BOTH_SIDES);
  assert.deepEqual(s, { verdictKey: 'ARENA_PLAIN_SUMMARY_FLAT' },
    'with no direction there is no "a break this way confirms it", and "watch $X" without a '
    + 'direction would be worse than silence - so FLAT must carry neither clause even when levels exist');
});

test('S5. an unknown tier returns null rather than guessing', () => {
  for (const unknown of ['WOBBLY', '', 'bearish', 'BEARISH ', 'LEAN', 'UNKNOWN']) {
    assert.equal(plainSummary(unknown, BOTH_SIDES), null, `'${unknown}' must not produce a line`);
  }
  /* CONTROL: every tier the read can actually emit DOES produce one, so S5 is not passing because
     the function returns null for everything. */
  for (const known of ['BULLISH', 'LEAN BULLISH', 'FLAT', 'LEAN BEARISH', 'BEARISH']) {
    assert.notEqual(plainSummary(known, BOTH_SIDES), null, `'${known}' is a real tier and must produce a line`);
  }
});

test('S6. non-finite prices are dropped before "nearest" is computed', () => {
  /* NaN and Infinity both, because `Number.isFinite` is the guard and a `!isNaN` check would have
     let Infinity through - where `Math.max` would then return it and the line would read "$Infinity". */
  const s = plainSummary('BEARISH', [
    L(NaN, 'support'), L(100, 'support'),
    L(Infinity, 'resistance'), L(180, 'resistance'),
  ]);
  assert.equal(s?.watch?.price, '$100', 'NaN must not win Math.max');
  assert.equal(s?.cancel?.price, '$180', 'Infinity must not win Math.min');

  // CONTROL: with the non-finite entries removed the answer is the same, so they were truly ignored.
  const clean = plainSummary('BEARISH', [L(100, 'support'), L(180, 'resistance')]);
  assert.deepEqual(s, clean, 'dropping the non-finite levels should leave the result identical');

  // And a read whose ONLY level is non-finite keeps its verdict and drops the clause.
  const allBad = plainSummary('BEARISH', [L(NaN, 'support')]);
  assert.equal(allBad?.verdictKey, 'ARENA_PLAIN_SUMMARY_BEARISH');
  assert.equal(allBad?.watch, undefined, 'a NaN-only side must omit its clause, not print NaN');
});

test('S7. a cheap coin keeps its significant digits', () => {
  const s = plainSummary('BEARISH', [L(0.0000123, 'support'), L(0.0000456, 'resistance')]);
  assert.equal(s?.watch?.price, '$0.0000123', 'a sub-cent price rounded to $0.00 would name a level that is not a level');
  assert.equal(s?.cancel?.price, '$0.0000456');
  // CONTROL: a normal price is not given spurious precision by the same formatter.
  assert.equal(plainSummary('BEARISH', [L(73400, 'support')])?.watch?.price, '$73,400');
});

test('S8. the cancel-without-watch pairing is the CALLER\'s invariant, and this records where it lives', () => {
  /* THE FUNCTION DOES NOT GUARANTEE THE PAIRING, and asserting that it does would be a cell that
     claims something false. `watch` and `cancel` are set by independent `if`s, so a bearish read
     carrying resistances but no supports returns a cancel clause with no watch clause: */
  const s = plainSummary('BEARISH', [L(180, 'resistance'), L(200, 'resistance')]);
  assert.equal(s?.watch, undefined);
  assert.ok(s?.cancel, 'the function does return cancel alone - this is its real contract');

  /* The invariant is enforced in the component instead, for a stated reason: a lone cancel clause
     would need its first word capitalised, and capitalising a translated string is an
     English-shaped assumption that breaks in other locales.
     ASSERTED IN SOURCE, so removing that guard fails a test rather than quietly shipping a
     half-sentence. A source assertion is the weaker kind, and it is used here only because the
     alternative is leaving the end-to-end invariant uncovered: this file cannot mount the page. */
  const page = readFileSync('app/(main)/arena/page.tsx', 'utf8');
  assert.match(page, /const cancel = watch && s\.cancel \?/,
    'the Arena render must keep gating the cancel clause on the watch clause; plainSummary alone '
    + 'does not enforce it, so this guard is the only thing standing between a reader and a '
    + 'sentence that cancels something it never named');
});
