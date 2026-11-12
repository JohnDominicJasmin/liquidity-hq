/* #2187 / #1631: a PATTERNS bullet that joins several patterns with semicolons becomes separate entries
 * (one pill each). Commas stay inside one pattern; "None" is dropped per part.
 *
 * Fed through parseCombinedRead, the exported entry point, with a verdict so the parse is not refused.
 * No network, nothing billed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCombinedRead } from '../lib/grok.ts';

const read = (bullets: string[]) =>
  parseCombinedRead(
    ['SIGNAL: BULLISH', 'CONFIDENCE: 62', 'PATTERNS:', ...bullets, 'WAIT_FOR: a close above 80,900', 'REASONING: the 4h ribbon is expanding.'].join('\n'),
    '4h', 'NY', Date.UTC(2026, 10, 12),
  );

test('P1: "Double top; Tight consolidation" is two entries', () => {
  assert.deepEqual(read(['- Double top; Tight consolidation'])?.patterns, ['Double top', 'Tight consolidation']);
});

test('P2: "None; Double top" is one entry', () => {
  assert.deepEqual(read(['- None; Double top'])?.patterns, ['Double top']);
});

test('P3: "Bear flag, 4h" stays one entry (commas are not separators)', () => {
  assert.deepEqual(read(['- Bear flag, 4h'])?.patterns, ['Bear flag, 4h']);
});

test('P4: "None detected" alone is no entries', () => {
  assert.deepEqual(read(['- None detected'])?.patterns, []);
});

test('P5: separate bullets and a joined one add up, in order; empty parts are dropped', () => {
  assert.deepEqual(read(['- Bull flag', '- Double top;; Tight consolidation; '])?.patterns, ['Bull flag', 'Double top', 'Tight consolidation']);
});
