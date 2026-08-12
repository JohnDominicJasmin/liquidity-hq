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

/* ── #325: boundary-aligned cache expiry ─────────────────────────────────────
 *
 * The TTL for a closed-candle request is "time until this candle closes", not a
 * fixed number of minutes. These pin the arithmetic the route relies on and the
 * dialect handling, which is where it would silently go wrong: a bybit "60"
 * and a binance "1h" are the same hour and must produce the same boundary.
 */
import { intervalToMs } from '../lib/candles.ts';

test('#325: both exchange dialects map to the same milliseconds', () => {
  // The route does not translate between dialects - each caller sends its own -
  // so a boundary computed from one must match the other.
  assert.equal(intervalToMs('1m'), intervalToMs('1'));
  assert.equal(intervalToMs('15m'), intervalToMs('15'));
  assert.equal(intervalToMs('1h'), intervalToMs('60'));
  assert.equal(intervalToMs('4h'), intervalToMs('240'));
  assert.equal(intervalToMs('1d'), intervalToMs('D'));
});

test('#325: intervals with no computable boundary return null, not a guess', () => {
  // A week is not a divisor of the epoch offset and months vary in length, so
  // the boundary maths in this file does not hold. The route falls back to the
  // plain TTL rather than expiring at a wrong instant.
  assert.equal(intervalToMs('W'), null);
  assert.equal(intervalToMs('M'), null);
  assert.equal(intervalToMs(''), null);
  assert.equal(intervalToMs('0'), null);
  assert.equal(intervalToMs('junk'), null);
});

test('#325: the TTL is always positive and never exceeds one period', () => {
  // Zero would expire the entry instantly and hammer upstream; longer than a
  // period would serve a closed candle into the next one.
  for (const iv of ['1m', '15m', '1h', '4h', '1d']) {
    const ms = intervalToMs(iv)!;
    for (const offset of [0, 1, ms / 3, ms - 1]) {
      const ttl = msUntilNextClose(ms, 1_000_000 * ms + offset) + CLOSE_SKEW_MS;
      assert.ok(ttl > 0, `${iv} produced a non-positive TTL`);
      assert.ok(ttl <= ms + CLOSE_SKEW_MS, `${iv} TTL ${ttl} exceeds one period`);
    }
  }
});

test('#325: upstream fetches per candle drop to one', () => {
  // The measurement that justified this over a bypass. Old: ttlFor is a fixed
  // stopwatch, so fetches = period / ttl. New: one per candle, by construction.
  const ttlFor = (ms: number) => ms <= 5 * 60_000 ? 30_000 : ms <= 30 * 60_000 ? 60_000
                                : ms <= 2 * 3600_000 ? 300_000 : 900_000;
  for (const [iv, expectedOld] of [['1m', 2], ['15m', 15], ['1h', 12], ['4h', 16], ['1d', 96]] as const) {
    const ms = intervalToMs(iv)!;
    assert.equal(Math.round(ms / ttlFor(ms)), expectedOld, `${iv} old fetch count`);
    // Boundary-aligned: the entry lives exactly one candle, so exactly one fetch.
    assert.equal(Math.round(ms / (msUntilNextClose(ms, 1_000_000 * ms) )), 1, `${iv} new fetch count`);
  }
});
