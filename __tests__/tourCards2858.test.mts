/* QA: PR #2858 (#1185 item 105): no card of the tour's first step leaves the tour card on a phone. The measurement is a browser run; this holds the three style rules it rests on. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../components/SpotlightTour.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('S1. step 1: equal shares, may shrink below a long word, and the word breaks inside its card', () => {
  const from = src.indexOf('function Step1Visual'); const to = src.indexOf('\nfunction ', from + 10); assert.ok(from >= 0 && to > from, 'CONTROL: step 1 found');
  const card = /<div key=\{c\.id\} style=\{\{([^}]*)\}\}>/.exec(src.slice(from, to).replace(/`1px solid \$\{BDR\}`/, "'border'"))?.[1] ?? '';
  assert.ok(card, 'CONTROL: the card style found');
  for (const rule of ["flex: '1 1 0'", 'minWidth: 0', "overflowWrap: 'anywhere'"]) assert.ok(card.includes(rule), rule);
});
