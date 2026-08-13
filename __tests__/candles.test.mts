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

/* ── #325 second attempt: the TTL floor, swept ───────────────────────────────
 *
 * The first attempt shipped and got both non-prod environments banned by
 * Binance. Its tests asserted the TTL was positive and never exceeded one
 * period; a four-second trough at one end of the range passes both.
 *
 * These SWEEP the offset across the whole period instead of sampling it. The
 * bug lived at one end and no mid-candle sample could see it - which is the
 * "controls answer the questions you already thought of" failure, in the test
 * that was supposed to be the control.
 */
import { intervalToMs, closedCandleTtl } from '../lib/candles.ts';

/** The route's own TTLs, so the floor is compared against the real fallback. */
const ttlFor = (iv: string): number =>
  /^(1|3|5)$|^(1|3|5)m$/.test(iv) ? 30_000
  : /^(15|30)$|^(15|30)m$/.test(iv) ? 60_000
  : /^(60|120)$|^(1|2)h$/.test(iv) ? 300_000
  : 900_000;

test('#325 THE BAN: TTL never drops below the pre-feature fallback, swept', () => {
  // 200 offsets per interval, INCLUDING the last millisecond of the candle -
  // which is where the four-second trough was and where every client lands.
  for (const iv of ['1m', '5m', '15m', '30m', '1h', '4h', '1d']) {
    const ms = intervalToMs(iv)!;
    const floor = ttlFor(iv);
    for (let i = 0; i <= 200; i++) {
      const offset = Math.min(ms - 1, Math.round((i / 200) * ms));
      const ttl = closedCandleTtl(ms, floor, 1_000_000 * ms + offset);
      assert.ok(ttl >= floor,
        `${iv} at +${offset}ms: TTL ${ttl}ms is BELOW the ${floor}ms fallback - this is the ban`);
    }
  }
});

test('#325: TTL never exceeds one period plus the skew', () => {
  for (const iv of ['1m', '15m', '1h', '4h', '1d']) {
    const ms = intervalToMs(iv)!;
    for (let i = 0; i <= 200; i++) {
      const offset = Math.min(ms - 1, Math.round((i / 200) * ms));
      const ttl = closedCandleTtl(ms, ttlFor(iv), 1_000_000 * ms + offset);
      assert.ok(ttl <= ms + CLOSE_SKEW_MS, `${iv} at +${offset}ms: TTL ${ttl} exceeds a period`);
    }
  }
});

test('#325: the benefit survives - mid-candle still expires AT the close', () => {
  // The floor must not swallow the feature. Mid-candle on a slow interval, the
  // boundary distance dominates and the entry still dies when the candle does.
  const ms = intervalToMs('4h')!;
  const ttl = closedCandleTtl(ms, ttlFor('4h'), 1_000_000 * ms + ms / 2);
  assert.equal(ttl, ms / 2 + CLOSE_SKEW_MS, 'mid-candle should be boundary-aligned, not floored');
  assert.ok(ttl > ttlFor('4h'), 'and longer than the old fixed TTL, which is the point');
});

test('#325: near the close the floor takes over, which is the safe direction', () => {
  const ms = intervalToMs('4h')!;
  const ttl = closedCandleTtl(ms, ttlFor('4h'), 1_000_000 * ms + ms - 1000);
  assert.equal(ttl, ttlFor('4h'), 'the last moments fall back to the pre-feature TTL');
});

/* ── #313: the gap left behind after an outage ─────────────────────────────── */
import { barsAfter, type Bar } from '../lib/candles.ts';

const gapBar = (t: number, close = 100): Bar =>
  ({ timestamp: t, open: 99, high: 101, low: 98, close, volume: 5 });

test('#313: returns exactly the candles that closed during the outage', () => {
  const rows = [gapBar(1000), gapBar(2000), gapBar(3000), gapBar(4000), gapBar(5000)];
  assert.deepEqual(barsAfter(rows, 2000).map(b => b.timestamp), [3000, 4000, 5000]);
});

test('#313: the bar the stream already delivered is NOT re-sent', () => {
  // Same timestamp, fetched later, would have a different close - it would
  // rewrite a candle the user watched form.
  const rows = [gapBar(2000, 111), gapBar(3000)];
  assert.deepEqual(barsAfter(rows, 2000).map(b => b.timestamp), [3000]);
});

test('#313: ascending order, even when the upstream returns newest-first', () => {
  // Bybit returns newest-first. Delivered in that order through an upsert path,
  // each older bar overwrites the newer one and the chart ends up showing the
  // START of the gap as its latest candle.
  const rows = [gapBar(5000), gapBar(4000), gapBar(3000)];
  assert.deepEqual(barsAfter(rows, 2000).map(b => b.timestamp), [3000, 4000, 5000]);
});

test('#313: nothing streamed yet means getBars owns the series, not the backfill', () => {
  assert.deepEqual(barsAfter([gapBar(1000), gapBar(2000)], 0), []);
});

test('#313: a drop with no elapsed candles backfills nothing', () => {
  // Reconnecting inside the same candle must not re-push it.
  assert.deepEqual(barsAfter([gapBar(1000), gapBar(2000)], 2000), []);
});
