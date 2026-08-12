/* #316 - closed candles only, and recompute when one closes.
 *
 * The property that matters is the repaint guard: a signal must not be able to
 * appear and disappear inside one candle. These pin the mechanism underneath
 * it - which candles are visible, and when we look again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TF_MS, CLOSE_SKEW_MS, dropForming, msUntilNextClose, sameCandle,
} from '../lib/candles.ts';

const MIN = 60_000;
const bar = (t: number) => ({ time: t, close: 1 });

test('every supported interval divides a day, which is what epoch alignment needs', () => {
  // If this ever fails, floor(t / intervalMs) is no longer the candle index and
  // msUntilNextClose / sameCandle are both silently wrong. A weekly or monthly
  // interval would break it - see the note in lib/candles.ts.
  for (const [tf, ms] of Object.entries(TF_MS)) {
    assert.equal(86_400_000 % ms, 0, `${tf} does not divide a day`);
  }
});

test('msUntilNextClose counts to the boundary, not from now', () => {
  const t = Date.UTC(2026, 7, 12, 13, 22, 30); // 13:22:30
  assert.equal(msUntilNextClose(TF_MS['1m'], t), 30_000);
  assert.equal(msUntilNextClose(TF_MS['5m'], t), 2 * MIN + 30_000);   // -> 13:25
  assert.equal(msUntilNextClose(TF_MS['1h'], t), 37 * MIN + 30_000);  // -> 14:00
  assert.equal(msUntilNextClose(TF_MS['4h'], t), 2 * 3600_000 + 37 * MIN + 30_000); // -> 16:00
});

test('exactly on a boundary returns a full period, never zero', () => {
  // Zero would busy-loop: fire, land on the same boundary, fire again.
  const t = Date.UTC(2026, 7, 12, 16, 0, 0);
  assert.equal(msUntilNextClose(TF_MS['4h'], t), TF_MS['4h']);
  assert.equal(msUntilNextClose(TF_MS['1m'], t), TF_MS['1m']);
});

test('the skew is positive, so we never ask before the candle exists', () => {
  assert.ok(CLOSE_SKEW_MS > 0);
});

test('dropForming removes the still-open bar', () => {
  const now = Date.UTC(2026, 7, 12, 13, 22, 30);
  const open = Date.UTC(2026, 7, 12, 13, 20, 0);   // 13:20 5m bar, closes 13:25
  const prev = Date.UTC(2026, 7, 12, 13, 15, 0);
  const out = dropForming([bar(prev), bar(open)], TF_MS['5m'], now);
  assert.deepEqual(out.map(c => c.time), [prev]);
});

test('a bar that closed exactly now is KEPT - it is closed, not forming', () => {
  const closeAt = Date.UTC(2026, 7, 12, 13, 25, 0);
  const openedAt = closeAt - TF_MS['5m'];
  assert.deepEqual(
    dropForming([bar(openedAt)], TF_MS['5m'], closeAt).map(c => c.time),
    [openedAt],
    'time + interval > now is false at exactly the close, so it survives',
  );
});

test('a payload with no forming bar loses nothing', () => {
  // Blind `slice(0, -1)` would silently discard a real closed candle here.
  const now = Date.UTC(2026, 7, 12, 13, 30, 0);
  const times = [13 * 60 + 15, 13 * 60 + 20].map(m => Date.UTC(2026, 7, 12, 0, m, 0));
  assert.deepEqual(dropForming(times.map(bar), TF_MS['5m'], now).map(c => c.time), times);
});

test('more than one trailing unclosed bar is handled, not just the last', () => {
  const now = Date.UTC(2026, 7, 12, 13, 22, 0);
  const times = [
    Date.UTC(2026, 7, 12, 13, 15, 0),  // closed 13:20
    Date.UTC(2026, 7, 12, 13, 20, 0),  // closes 13:25 - open
    Date.UTC(2026, 7, 12, 13, 25, 0),  // closes 13:30 - open (upstream oddity)
  ];
  assert.deepEqual(dropForming(times.map(bar), TF_MS['5m'], now).map(c => c.time), [times[0]]);
});

test('dropForming on an empty array is empty, not a crash', () => {
  assert.deepEqual(dropForming([], TF_MS['1h'], Date.now()), []);
});

test('sameCandle is true within one period and false across a close', () => {
  const fetched = Date.UTC(2026, 7, 12, 13, 21, 0);
  assert.equal(sameCandle(fetched, TF_MS['5m'], Date.UTC(2026, 7, 12, 13, 24, 59)), true);
  assert.equal(sameCandle(fetched, TF_MS['5m'], Date.UTC(2026, 7, 12, 13, 25, 0)), false,
    'a close happened, so the cached candles no longer describe the present');
});

test('sameCandle scales with the interval instead of a flat five minutes', () => {
  const fetched = Date.UTC(2026, 7, 12, 1, 0, 0);
  // The old 5-minute TTL refetched a 1d chart 96 times a day to see one change.
  assert.equal(sameCandle(fetched, TF_MS['1d'], Date.UTC(2026, 7, 12, 23, 59, 0)), true);
  assert.equal(sameCandle(fetched, TF_MS['1d'], Date.UTC(2026, 7, 13, 0, 0, 1)), false);
  // ...and served a 1m chart a candle five periods stale.
  assert.equal(sameCandle(fetched, TF_MS['1m'], Date.UTC(2026, 7, 12, 1, 1, 0)), false);
});

test('the worst-case client staleness is now the skew, not the timeframe', () => {
  // QA measured 5.5 min (1m) to 20 min (4h) worst case. The client half of that
  // becomes CLOSE_SKEW_MS for every timeframe.
  for (const ms of Object.values(TF_MS)) {
    const justAfterClose = 1_000_000 * ms + CLOSE_SKEW_MS;
    assert.equal(sameCandle(justAfterClose - CLOSE_SKEW_MS - 1, ms, justAfterClose), false,
      'a fetch from before the close must not be reused after it');
  }
});
