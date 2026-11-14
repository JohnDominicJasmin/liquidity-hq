import test from 'node:test';
import assert from 'node:assert/strict';
import { detectNyOpenBreakout, nyOpenUtc, NY_OPEN_BREAKOUT, FRESH_BARS } from '../lib/strategies/nyOpenBreakout.ts';

/* QA's unit cells for strategy 2 (#2308): New York open breakout. Rules from the PR text: the open is 09:30 New York on a weekday (14:30 UTC in winter / EST, 13:30 UTC in summer / EDT, computed from the date,
 * never fixed); the opening range is the high and low of the first 30 minutes and exists only once those candles have closed; BUY = the first close above the range high, SELL = the first close below the
 * range low; only the FIRST close outside counts for the session and only while fresh; works on 5m/15m/30m, wait on anything coarser. */

const WINTER = Date.UTC(2026, 0, 12);   // Monday 12 Jan 2026: EST, open 14:30 UTC
const SUMMER = Date.UTC(2026, 6, 13);   // Monday 13 Jul 2026: EDT, open 13:30 UTC
const SAT = Date.UTC(2026, 0, 10);      // Saturday
type C = { time: number; open: number; high: number; low: number; close: number; volume: number };
const bar = (time: number, o: number, c: number, h?: number, l?: number): C => ({ time, open: o, close: c, high: h ?? Math.max(o, c) + 0.5, low: l ?? Math.min(o, c) - 0.5, volume: 100 });
/** `pre` quiet candles before the open, the 30 minute range (high 105, low 99), then `post` closes. */
function session(dayStart: number, openHourUtc: number, tfMin: number, post: number[], pre = 9): C[] {
  const tf = tfMin * 60_000; const open = dayStart + (openHourUtc * 60 + 30) * 60_000; const cs: C[] = [];
  for (let i = pre; i > 0; i--) cs.push(bar(open - i * tf, 101, 101.5));
  const rangeN = 30 / tfMin;
  for (let i = 0; i < rangeN; i++) cs.push(i === 0 ? bar(open, 100, 104, 105, 99.5) : i === 1 ? bar(open + tf, 104, 100, 104.5, 99) : bar(open + i * tf, 101, 102, 103, 100));
  let t = open + rangeN * tf; for (const c of post) { cs.push(bar(t, 102, c)); t += tf; }
  return cs;
}
const ctx = (tfMin: number) => ({ coin: 'btc', tf: `${tfMin}m`, tfMs: tfMin * 60_000 });

test('2-a. the open is 14:30 UTC in winter and 13:30 UTC in summer; none on a weekend', () => {
  assert.equal(nyOpenUtc(WINTER + 20 * 3_600_000), WINTER + (14 * 60 + 30) * 60_000);
  assert.equal(nyOpenUtc(SUMMER + 20 * 3_600_000), SUMMER + (13 * 60 + 30) * 60_000);
  assert.equal(nyOpenUtc(SAT + 15 * 3_600_000), null, 'Saturday has no New York open');
  assert.equal(nyOpenUtc(Date.UTC(2026, 0, 11) + 15 * 3_600_000), null, 'Sunday has none either');
  // the clocks change: US DST began Sun 8 Mar 2026 and ended Sun 1 Nov 2026
  assert.equal(nyOpenUtc(Date.UTC(2026, 2, 6) + 20 * 3_600_000), Date.UTC(2026, 2, 6) + (14 * 60 + 30) * 60_000, 'Fri 6 Mar: still EST');
  assert.equal(nyOpenUtc(Date.UTC(2026, 2, 9) + 20 * 3_600_000), Date.UTC(2026, 2, 9) + (13 * 60 + 30) * 60_000, 'Mon 9 Mar: EDT');
});

for (const [name, day, hh] of [['winter (EST)', WINTER, 14], ['summer (EDT)', SUMMER, 13]] as Array<[string, number, number]>) {
  test(`2-b. ${name}: the first close ABOVE the range high is a BUY, the first close BELOW the range low a SELL (15m)`, () => {
    const buy = session(day, hh, 15, [103, 106]); const rb = detectNyOpenBreakout(buy, ctx(15));
    assert.equal(rb.verdict, 'buy'); assert.equal(rb.signalDir, 'long'); assert.equal(rb.signalTimestamp, buy[buy.length - 1].time);
    assert.equal(rb.params.hi, 105); assert.equal(rb.params.lo, 99); assert.equal(rb.params.inv, 99, 'invalidation = the range low');
    const sell = session(day, hh, 15, [101, 98]); const rs = detectNyOpenBreakout(sell, ctx(15));
    assert.equal(rs.verdict, 'sell'); assert.equal(rs.signalDir, 'short'); assert.equal(rs.params.inv, 105, 'invalidation = the range high');
  });
}

test('2-c. CONTROLS (wait): inside the range, range not yet complete, exactly at the edge, data gap, weekend, before the open', () => {
  assert.equal(detectNyOpenBreakout(session(WINTER, 14, 15, [103, 104]), ctx(15)).verdict, 'wait', 'closes stay inside 99-105');
  assert.equal(detectNyOpenBreakout(session(WINTER, 14, 15, [105]), ctx(15)).verdict, 'wait', 'a close exactly AT the range high is not above it');
  const mid = session(WINTER, 14, 15, []); assert.equal(detectNyOpenBreakout(mid.slice(0, -1), ctx(15)).verdict, 'wait', 'only one of the two range candles has closed');
  const gap = session(WINTER, 14, 15, [106]); gap.splice(gap.length - 3, 1); assert.equal(detectNyOpenBreakout(gap, ctx(15)).verdict, 'wait', 'a missing range candle');
  assert.equal(detectNyOpenBreakout(session(SAT, 14, 15, [106]), ctx(15)).verdict, 'wait', 'weekend');
  const pre = session(WINTER, 14, 15, []).slice(0, 5); assert.equal(detectNyOpenBreakout(pre, ctx(15)).verdict, 'wait', 'before the open: too few candles / no range');
});

test('2-d. the winter clock applied in summer (a fixed 14:30 UTC open) would read wait: the summer session must use 13:30', () => {
  const summer = session(SUMMER, 13, 15, [106]);
  assert.equal(detectNyOpenBreakout(summer, ctx(15)).verdict, 'buy');
  const wrong = session(SUMMER, 14, 15, [106]);   // the same shape placed at 14:30 UTC in summer = 10:30 New York: not the opening range
  assert.equal(detectNyOpenBreakout(wrong, ctx(15)).verdict, 'wait');
});

test('2-e. NO REPEAT: only the FIRST close outside counts; a later, bigger break is not a new signal; the first break goes stale after FRESH_BARS', () => {
  assert.equal(FRESH_BARS, 2);
  const first = session(WINTER, 14, 15, [106]); const atFirst = detectNyOpenBreakout(first, ctx(15));
  const next = session(WINTER, 14, 15, [106, 107]); const atNext = detectNyOpenBreakout(next, ctx(15));
  assert.equal(atFirst.verdict, 'buy'); assert.equal(atNext.verdict, 'buy');
  assert.equal(atNext.signalTimestamp, atFirst.signalTimestamp, 'a second candle later is still the SAME first break: the page pings once');
  assert.equal(detectNyOpenBreakout(session(WINTER, 14, 15, [106, 107, 108]), ctx(15)).verdict, 'wait', 'stale after FRESH_BARS closed candles');
  const reversal = session(WINTER, 14, 15, [106, 100, 98]);   // a later close below the low is a second break: not counted
  assert.equal(detectNyOpenBreakout(reversal, ctx(15)).verdict, 'wait', 'the first break (up) is old; the later sell is not a new signal');
});

test('2-f. it works on 5m, 15m and 30m; on 1h and coarser it says wait; a 7m candle (does not divide 30) says wait', () => {
  for (const tf of [5, 15, 30]) { const cs = session(WINTER, 14, tf, [106], 10); assert.equal(detectNyOpenBreakout(cs, ctx(tf)).verdict, 'buy', `${tf}m`); }
  assert.equal(detectNyOpenBreakout(session(WINTER, 14, 15, [106]), ctx(60)).verdict, 'wait', '1h');
  assert.equal(detectNyOpenBreakout(session(WINTER, 14, 15, [106]), ctx(240)).verdict, 'wait', '4h');
  assert.equal(detectNyOpenBreakout(session(WINTER, 14, 15, [106]), ctx(7)).verdict, 'wait', '7m');
  assert.equal(NY_OPEN_BREAKOUT.minCandles, 10);
});

test('2-g. a break more than 6 hours after the open is not this session (wait)', () => {
  const day = session(WINTER, 14, 30, Array.from({ length: 13 }, () => 102).concat([106]), 10);
  assert.equal(detectNyOpenBreakout(day, ctx(30)).verdict, 'wait');
});
