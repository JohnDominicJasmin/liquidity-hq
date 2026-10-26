import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasValue, coverageOf, formatFieldCoverage, VALUE_FIELDS } from '@/lib/econCoverage';

/* #1651 / #1757: THE FIELD-COVERAGE COUNTER, AND THE ZERO THAT IS A READING.
 *
 * `/api/econ-calendar/ingest` reports how many events carry actual/previous/estimate, so the next person
 * reads a number instead of inferring one from a table of dashes. The first version filtered on truthiness,
 * which gets the one interesting case wrong: a 0.0% CPI print is a reading, and `filter((e) => e[key])`
 * calls it missing.
 *
 * WHY THIS SUITE HAD TO WAIT FOR THE LIFT. A test over today's payload passes on the BUGGY version too -
 * all three keys are absent on every event, so both predicates agree on all twenty. The only test that can
 * tell them apart PLANTS a value, and planting one means calling the function directly. As a closure inside
 * the route handler it could not be called at all without `next/server` coming with it. That is what makes
 * E2 and E8 load-bearing rather than E3.
 *
 * NONE OF THIS IS REACHABLE TODAY and the tests should not be read as live bugs: the three keys have no
 * producer anywhere, so every count is 0/20 under either predicate. It is fixed before a producer exists
 * because after that the bug is silent and the counter is the thing someone would trust. */

/* The shape production actually serves - qa bab22a5, 20 events, these four keys and nothing else. */
const TODAYS_EVENT = { name: 'CPI', type: 'inflation', isoDate: '2026-11-12', impact: 'high' };

test('E1: hasValue answers "is it usable", not merely "is it present"', () => {
  /* A zero is a reading. This is the whole point of #1757 and so it is the first assertion. */
  assert.equal(hasValue(0), true, 'a real 0 is a value - a 0.0% print is exactly what this counter confirms arrived');
  assert.equal(hasValue(-0), true);
  assert.equal(hasValue('0'), true, 'a string zero is still a reading');
  assert.equal(hasValue(1.5), true);
  assert.equal(hasValue('3.2%'), true);

  assert.equal(hasValue(undefined), false);
  assert.equal(hasValue(null), false);
  assert.equal(hasValue(''), false);
  assert.equal(hasValue('   '), false, 'whitespace is a missing value wearing a string');
  assert.equal(hasValue('\t\n'), false);

  /* NaN is present and unusable. A feed returning NaN for every print would otherwise report FULL
     coverage - the worst possible reading from an instrument built to catch exactly that case. */
  assert.equal(hasValue(NaN), false, 'NaN is there but not usable');
  assert.equal(hasValue(Number('nope')), false, 'the same thing arriving from a failed parse');
});

test('E2 CONTROL: hasValue disagrees with truthiness on the two cases that are the entire fix', () => {
  /* Without this, the fix and a no-op are indistinguishable. Each disagreement is named rather than
     counted, so a regression says WHICH case moved instead of just lowering a number. */
  const truthy = (v: unknown) => Boolean(v);

  assert.equal(truthy(0), false, 'the old predicate dropped a real 0 ...');
  assert.equal(hasValue(0), true, '... and the new one keeps it');

  assert.equal(truthy('   '), true, 'the old predicate counted whitespace as a value ...');
  assert.equal(hasValue('   '), false, '... and the new one does not');

  /* NaN was falsy before and is false now, so it is NOT part of the behaviour change - it was already
     excluded by accident rather than on purpose, and E1 pins it so it stays excluded deliberately. */
  assert.equal(truthy(NaN), false);
  assert.equal(hasValue(NaN), false, 'same answer, different reason - accident before, rule now');
});

test('E3: coverageOf over the payload production actually serves reads zero on all three', () => {
  const events = Array.from({ length: 20 }, () => ({ ...TODAYS_EVENT }));
  for (const f of VALUE_FIELDS) {
    assert.equal(coverageOf(events, f), 0, `${f} must read 0 when the key is absent entirely`);
  }
});

test('E4: a planted value is counted per field, and the zero is the one that proves the fix', () => {
  const events: unknown[] = [
    { ...TODAYS_EVENT, actual: 0 },        // a real 0.0 print - the case truthiness missed
    { ...TODAYS_EVENT, previous: '   ' },  // whitespace from an upstream - absent
    { ...TODAYS_EVENT, estimate: NaN },    // parsed from something malformed - present, unusable
    { ...TODAYS_EVENT },
  ];
  assert.equal(coverageOf(events, 'actual'), 1, 'the planted 0 must be counted');
  assert.equal(coverageOf(events, 'previous'), 0, 'whitespace must not be counted');
  assert.equal(coverageOf(events, 'estimate'), 0, 'NaN must not be counted');
});

test('E5: nothing in the shape throws - empty, null, undefined, and a null element', () => {
  for (const f of VALUE_FIELDS) {
    assert.equal(coverageOf([], f), 0, 'an empty calendar is 0, not a throw');
    assert.equal(coverageOf(null, f), 0);
    assert.equal(coverageOf(undefined, f), 0);
    assert.equal(coverageOf([null, undefined, { ...TODAYS_EVENT }], f), 0, 'a null element must not throw');
  }
  assert.equal(coverageOf([null, { actual: 0 }], 'actual'), 1,
    'a null element beside a real value still counts the value - the guard must skip, not abort');
});

test('E6: the STRING shape, because /ops is read by eye and counts cannot see a reorder', () => {
  /* Dev asked for this and it is the right addition: a renamed field or a reordered list passes every
     count assertion above while changing the line a human reads on /ops. */
  const events = [{ ...TODAYS_EVENT, actual: 0 }, { ...TODAYS_EVENT }, { ...TODAYS_EVENT }];
  assert.equal(formatFieldCoverage(events), 'actual 1/3, previous 0/3, estimate 0/3');

  /* An empty calendar must read 0/0 rather than 0/undefined - the detail string is what /ops prints. */
  assert.equal(formatFieldCoverage([]), 'actual 0/0, previous 0/0, estimate 0/0');
  assert.equal(formatFieldCoverage(null), 'actual 0/0, previous 0/0, estimate 0/0');
  assert.equal(formatFieldCoverage(undefined), 'actual 0/0, previous 0/0, estimate 0/0');
});

test('E7: VALUE_FIELDS is pinned - a rename changes what /ops prints', () => {
  assert.deepEqual([...VALUE_FIELDS], ['actual', 'previous', 'estimate'],
    'these three names appear in the api_health detail, so renaming one is a visible change rather than a refactor');
});

test('E8 CONTROL: the OLD predicate fails E4, so this suite catches the bug it was written for', () => {
  /* The code this replaced was `filter((e) => e[field])`. Reconstructed here ONLY to prove the suite can
     tell the two apart - without it, E4 passing says nothing about whether the fix was needed at all. */
  const oldCoverageOf = (events: readonly unknown[], field: string) =>
    events.filter((e) => (e as Record<string, unknown>)[field]).length;

  const events = [{ ...TODAYS_EVENT, actual: 0 }, { ...TODAYS_EVENT }];
  assert.equal(oldCoverageOf(events, 'actual'), 0, 'the old predicate dropped a real 0');
  assert.equal(coverageOf(events, 'actual'), 1, 'the new one keeps it');
  assert.notEqual(oldCoverageOf(events, 'actual'), coverageOf(events, 'actual'),
    'if these ever agree on this input, the predicate has regressed to truthiness');
});
