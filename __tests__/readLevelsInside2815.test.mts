/* QA: PR #2815 (#1651 owner item 27), the AI read's levels stay inside the chart. The REAL candleRange / levelsInside run; the route's use of them is read from its source.
 *   W1 the range is the lowest low and highest high of the CLOSED candles; the forming candle does not widen it; no candles, no range
 *   W2 a level below the low or above the high is dropped, the edges are kept, order and other fields untouched; with no range nothing is dropped
 *   W3 the route drops them from the answer after every other check, records which, and leaves an unread range (failed fetch) alone */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { candleRange, levelsInside } from '../lib/readLevels.ts';

const H = 3_600_000, T0 = Date.UTC(2026, 0, 1);
const c = (i: number, low: number, high: number) => ({ time: T0 + i * H, open: low, high, low, close: high, volume: 1 });
const NOW = T0 + 3 * H + H / 2;   // candles 0..2 are closed, 3 is forming

test('W1. the range is from closed candles only', () => {
  const candles = [c(0, 95, 105), c(1, 90, 100), c(2, 99, 110), c(3, 10, 900)];
  assert.deepEqual(candleRange(candles, H, NOW), { low: 90, high: 110 });
  assert.equal(candleRange([], H, NOW), null); assert.equal(candleRange([c(3, 10, 900)], H, NOW), null, 'only a forming candle');
  assert.equal(candleRange(candles, 0, NOW), null);
  assert.deepEqual(candleRange([c(0, 0, 105), c(1, NaN, 500), c(2, 99, 101)], H, NOW), { low: 99, high: 101 }, 'a zero or unreadable bar is not part of the range');
});

test('W2. outside is dropped, the edges are kept, no range drops nothing', () => {
  const levels = [89.99, 90, 100, 110, 110.01, 5000].map((price, i) => ({ price, label: `L${i}`, type: 'support' }));
  assert.deepEqual(levelsInside(levels, { low: 90, high: 110 }), levels.slice(1, 4));
  assert.deepEqual(levelsInside(levels, null), levels); assert.notEqual(levelsInside(levels, null), levels, 'a copy, not the caller\'s array');
  assert.deepEqual(levelsInside([{ price: NaN }], { low: 90, high: 110 }), []);
});

test('W3. the route filters the answer after its other checks and says what it dropped', () => {
  const s = readFileSync(new URL('../app/api/grok/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(s, /const candles = await fetchRibbonCandles\([^;]*;\s*levels = readLevels\(candles, TF_MS\[tf\], Date\.now\(\)\);\s*range = candleRange\(candles, TF_MS\[tf\], Date\.now\(\)\);\s*\} catch \{ levels = null; range = null; \}/);
  const at = s.indexOf('const inside = levelsInside(result.levels ?? [], range);');
  assert.ok(at > s.lastIndexOf('if (restated)') && at < s.indexOf('return NextResponse.json({ result, usage });'), 'the filter is not between the checks and the answer');
  assert.match(s.slice(at), /if \(inside\.length !== \(result\.levels \?\? \[\]\)\.length\) \{\s*\(result\.checks \?\?= \[\]\)\.push\(`level dropped: outside the candles' range \(\$\{[\s\S]{0,200}result\.levels = inside;/);
});
