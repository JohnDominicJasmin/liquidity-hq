/* #1727: WHICH Fear & Greed RESPONSES ARE READ, AND WHICH ARE REFUSED. No network, no route, no credentials - the predicate is in
 * lib/fng.ts precisely so it can be exercised directly.
 *
 * WHY THIS FILE EXISTS. Two of the three readers in app/api/telegram/alert/route.ts used to write `?? '50'` for a response they could
 * not read, and the `isNaN` guard under it never fired because `parseInt('50')` is 50. A fabricated 50 trips none of the alert gates
 * (<=15, >=75, <=25), so the symptom was an alert that silently did not go out - the same shape as #1651's finding C, where "no
 * extreme" and "we could not read it" looked identical.
 *
 * THE PART WORTH TESTING IS NOT THE HAPPY PATH. A `parseInt` guard accepts junk as a confident small number: `"0x1f"` is 0, `"4e1"`
 * is 4, `"1e2"` is 1 - and 0, 4 and 1 all trip `<= 15`, so each one FIRES the extreme-fear alert. `"1e2"` means 100, maximum GREED,
 * so it fires the alert that says the opposite of the truth. G3 below pins that by computing what `parseInt` would have returned and
 * asserting the gate it would have tripped, so a future "simplification" back to a numeric guard goes red with the consequence
 * spelled out rather than with a vague type error.
 *
 * THE OTHER DIRECTION MATTERS TOO. A predicate that refuses everything also passes a junk table, so G1 asserts the real readings
 * still read - including the two boundary values and the two that must keep firing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFng } from '../lib/fng.ts';

/** The endpoint's shape, with one value substituted in. `value_classification` is alternative.me's own wording. */
const body = (value: unknown, cls: unknown = 'Extreme Fear') =>
  ({ data: [{ value, value_classification: cls }] }) as unknown as { data?: { value: string; value_classification: string }[] };

/* The alert route's own gates, copied as a predicate so a test can say which one a value would trip.
   Kept here rather than imported because route.ts cannot export them - see lib/fng.ts's header. */
const gateFired = (v: number) => (v <= 15 ? 'extreme fear' : v >= 75 ? 'extreme greed' : v <= 25 ? 'fear' : null);

/* ── G1. Real readings are read, and the ones that must fire still fire ─────────────────────────────────────────── */

const ACCEPTED: Array<[string, number, string | null]> = [
  ['extreme fear at the bottom of the scale', 0, 'extreme fear'],
  ['single digit', 7, 'extreme fear'],
  ['the neutral middle - must fire NOTHING', 42, null],
  ['the old fabricated value, as a real reading', 50, null],
  ['extreme greed at the gate', 75, 'extreme greed'],
  ['the top of the scale', 100, 'extreme greed'],
  ['the fear gate', 25, 'fear'],
  ['one above the fear gate', 26, null],
];

for (const [label, n, expectedGate] of ACCEPTED) {
  test(`G1. ${n} is read (${label})`, () => {
    const read = readFng(body(String(n)));
    assert.ok(read, `a real reading of ${n} was refused - the predicate has overshot and the alert would never fire`);
    assert.equal(read.value, n);
    assert.equal(gateFired(read.value), expectedGate, `${n} would trip the wrong alert gate`);
  });
}

test('G1b. surrounding whitespace is read, not refused', () => {
  const read = readFng(body(' 85 '));
  assert.ok(read, 'a padded value was refused: alternative.me is not required to trim for us');
  assert.equal(read.value, 85);
});

/* ── G2. Anything we cannot read is refused outright - never defaulted, never partially parsed ──────────────────── */

const REFUSED: Array<[string, unknown]> = [
  ['hex, which parseInt reads as 0', '0x1f'],
  ['scientific notation meaning 40', '4e1'],
  ['scientific notation meaning 100', '1e2'],
  ['a number with trailing text - the original defect', '50abc'],
  ['a percentage sign', '50%'],
  ['a float, which parseInt would truncate', '42.7'],
  ['out of range above the scale', '101'],
  ['four digits, refused before any range check', '1234'],
  ['negative', '-1'],
  ['a plus sign', '+50'],
  ['empty string', ''],
  ['whitespace only', '   '],
  ['prose', 'Extreme Fear'],
  ['a NUMBER rather than the string the endpoint sends', 50],
  ['null', null],
  ['undefined', undefined],
  ['an object', {}],
];

for (const [label, raw] of REFUSED) {
  test(`G2. refused: ${label}`, () => {
    assert.equal(readFng(body(raw)), null,
      `accepted ${JSON.stringify(raw)} - an unreadable response became a reading, which is the defect this helper exists to stop`);
  });
}

test('G2b. a response with no data at all is refused', () => {
  assert.equal(readFng({}), null, 'an empty object was read');
  assert.equal(readFng({ data: [] }), null, 'an empty data array was read');
  assert.equal(readFng({ data: undefined }), null, 'a missing data array was read');
});

/* ── G3. THE CONSEQUENCE, pinned. What a parseInt guard would have done with each junk value ────────────────────── */

test('G3. the three junk values a parseInt guard accepts would each FIRE an alert, and one fires the opposite of the truth', () => {
  const cases: Array<[string, number, string, string | null]> = [
    //  raw      what parseInt(raw, 10) returns   what it MEANS      the gate that value trips
    ['0x1f', 0, '31', 'extreme fear'],
    ['4e1', 4, '40', 'extreme fear'],
    ['1e2', 1, '100 - maximum GREED', 'extreme fear'],
  ];
  for (const [raw, parsed, meaning, gate] of cases) {
    assert.equal(parseInt(raw, 10), parsed, `parseInt('${raw}', 10) no longer returns ${parsed} - this test's premise changed`);
    assert.equal(gateFired(parsed), gate,
      `parseInt('${raw}') = ${parsed} would no longer trip "${gate}" - re-derive this table before trusting it`);
    assert.equal(readFng(body(raw)), null,
      `readFng accepted '${raw}'. parseInt reads it as ${parsed}, it means ${meaning}, and ${parsed} fires "${gate}" to every recipient`);
  }
});

test('G3b. the original defect: a fabricated 50 fires nothing, which is why it was invisible for so long', () => {
  assert.equal(gateFired(50), null, 'the gates changed: 50 now fires something, so the old silent failure would not have been silent');
  assert.equal(readFng(body('50abc')), null, "'50abc' was accepted as 50 - the defect, exactly as it was");
});

/* ── G4. The label: alternative.me's wording when it sent one, null when it did not ─────────────────────────────── */

test('G4. the classification is trimmed, and absence is null rather than an empty string', () => {
  assert.equal(readFng(body('42', 'Fear'))?.label, 'Fear');
  assert.equal(readFng(body('42', '  Fear  '))?.label, 'Fear', 'the label was not trimmed');
  assert.equal(readFng(body('42', ''))?.label, null, 'an empty classification must be null, or the message renders "F&G: 42 ()"');
  assert.equal(readFng(body('42', '   '))?.label, null, 'a whitespace-only classification must be null');
  /* The key ABSENT, not passed as undefined - `body`'s default would have supplied a label and the assertion would have tested
     nothing. It failed that way on the first run, which is the argument for running a new test against the code it describes
     before trusting a green. */
  const noLabel = { data: [{ value: '42' }] } as unknown as { data?: { value: string; value_classification: string }[] };
  assert.equal(readFng(noLabel)?.label, null, 'a missing classification must be null');
  assert.equal(readFng(body('42', 7))?.label, null, 'a non-string classification must be null, not the number');
});

test('G4b. a refused value is refused whatever the label says', () => {
  assert.equal(readFng(body('0x1f', 'Extreme Fear')), null, 'a plausible label made an unreadable value acceptable');
});
