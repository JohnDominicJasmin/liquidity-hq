/* #2206 / #2166: single-asterisk emphasis in the Arena's AI-read text. Unit cells on the pure seam, `lib/reasoningMarkup.ts`.
 *
 * `REASONING_SPLIT` is what `ReasoningText` splits the model's prose on; `emphasisInner(segment)` says whether a segment is
 * emphasis. Cells follow PM's list on the PR: *clean* is emphasis, **bold** is unchanged, and "5 * 3", "5 * 3 * 2", a lone "*" and
 * "* x *" stay literal, plus mixed bold and italic and the newline guard. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { REASONING_SPLIT, emphasisInner } from '../lib/reasoningMarkup.ts';

const split = (s: string) => s.split(REASONING_SPLIT);
const emphasised = (s: string) => split(s).map(emphasisInner).filter((x): x is string => x !== null);

test('R1. "A *clean* sweep comes first." splits around the emphasis, and emphasisInner returns the word', () => {
  assert.deepEqual(split('A *clean* sweep comes first.'), ['A ', '*clean*', ' sweep comes first.']);
  assert.equal(emphasisInner('*clean*'), 'clean');
});

for (const literal of ['5 * 3', '5 * 3 * 2', 'a lone * here', '*', '* x *', '**unclosed']) {
  test(`R2. ${JSON.stringify(literal)} stays literal: no segment is emphasis`, () => {
    assert.deepEqual(emphasised(literal), [], `${JSON.stringify(literal)} produced emphasis: ${JSON.stringify(emphasised(literal))}`);
  });
}

test('R3. **bold** is one segment and is NOT single-asterisk emphasis', () => {
  assert.deepEqual(split('say **bold** now'), ['say ', '**bold**', ' now']);
  assert.equal(emphasisInner('**bold**'), null);
});

test('R4. mixed: **a *b* c** stays ONE bold segment (bold wins, the inner asterisks are not split out)', () => {
  assert.deepEqual(split('**a *b* c**'), ['', '**a *b* c**', '']);
  assert.equal(emphasisInner('**a *b* c**'), null);
});

test('R5. bold and italic side by side are two segments of two kinds', () => {
  const segs = split('**Liquidity sits above.** A *clean* sweep');
  assert.ok(segs.includes('**Liquidity sits above.**'));
  assert.ok(segs.includes('*clean*'));
  assert.deepEqual(emphasised('**Liquidity sits above.** A *clean* sweep'), ['clean']);
});

test('R6. emphasis does not match across a newline', () => {
  assert.deepEqual(emphasised('*one\ntwo*'), [], 'an emphasis span crossed a newline');
  assert.equal(emphasisInner('*one\ntwo*'), null);
});

test('R7. links and newlines are still split out (the existing behaviour is untouched)', () => {
  assert.deepEqual(split('see [docs](https://example.com) now'), ['see ', '[docs](https://example.com)', ' now']);
  assert.deepEqual(split('a\nb'), ['a', '\n', 'b']);
});

test('R8. CONTROL: emphasisInner can say no and can say yes (it is not a constant)', () => {
  assert.equal(emphasisInner('*x*'), 'x');
  assert.equal(emphasisInner('x'), null);
  assert.equal(emphasisInner('* x *'), null, 'a space after the opening asterisk must not count');
});

test('R9. a two-word emphasis keeps its inner space; a trailing space before the closing asterisk is not emphasis', () => {
  assert.equal(emphasisInner('*two words*'), 'two words');
  assert.equal(emphasisInner('*two words *'), null);
});
