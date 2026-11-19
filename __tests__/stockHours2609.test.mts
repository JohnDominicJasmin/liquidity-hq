import test from 'node:test';
import assert from 'node:assert/strict';
import { STRATEGIES } from '../lib/strategies/index.ts';
import { usCashOpen } from '../lib/marketHours.ts';
import { coinKind } from '../lib/coins.ts';

/* #2609 TOKENIZED STOCKS READ THE US CASH SESSION ONLY. Expectations hand-derived from the written rule (09:30-16:00 New York on a weekday = 13:30-20:00 UTC in summer time, 14:30-21:00 UTC in winter time; the clock changes 2026-03-08 and 2026-11-01), holidays NOT modelled:
 *   H1 usCashOpen at the boundary minutes, both sides of both clock changes, weekends   H2 the three session strategies (NY open, session sweep, VWAP reclaim) on a STOCK answer WAIT + marketClosed when the last candle opened outside the session and run normally inside it
 *   H3 every other strategy, and every non-stock coin, is identical to the ungated detector at any hour (compared aapl vs btc on the same candles)   H4 NaN / junk times are closed. */
const U = (y: number, m: number, d: number, h: number, mi = 0) => Date.UTC(y, m - 1, d, h, mi);

test('H1. the cash session boundaries, summer time, winter time, both sides of both clock changes, weekends', () => {
  const cases: Array<[string, number, boolean]> = [
    ['Wed 2026-07-15 13:29 UTC = 09:29 EDT', U(2026, 7, 15, 13, 29), false], ['Wed 13:30 UTC = 09:30 EDT', U(2026, 7, 15, 13, 30), true], ['Wed 19:59 UTC = 15:59 EDT', U(2026, 7, 15, 19, 59), true], ['Wed 20:00 UTC = 16:00 EDT', U(2026, 7, 15, 20, 0), false],
    ['Wed 2026-01-14 14:29 UTC = 09:29 EST', U(2026, 1, 14, 14, 29), false], ['Wed 14:30 UTC = 09:30 EST', U(2026, 1, 14, 14, 30), true], ['Wed 20:59 UTC = 15:59 EST', U(2026, 1, 14, 20, 59), true], ['Wed 21:00 UTC = 16:00 EST', U(2026, 1, 14, 21, 0), false],
    ['Fri 2026-03-06 (still EST) 13:30 UTC = 08:30 closed', U(2026, 3, 6, 13, 30), false], ['Fri 2026-03-06 14:30 UTC open', U(2026, 3, 6, 14, 30), true],
    ['Mon 2026-03-09 (EDT after the change) 13:30 UTC open', U(2026, 3, 9, 13, 30), true], ['Mon 2026-03-09 13:29 UTC closed', U(2026, 3, 9, 13, 29), false],
    ['Fri 2026-10-30 (EDT) 13:30 UTC open', U(2026, 10, 30, 13, 30), true], ['Fri 2026-10-30 20:00 UTC closed', U(2026, 10, 30, 20, 0), false],
    ['Mon 2026-11-02 (EST after the change) 13:30 UTC = 08:30 closed', U(2026, 11, 2, 13, 30), false], ['Mon 2026-11-02 14:30 UTC open', U(2026, 11, 2, 14, 30), true], ['Mon 2026-11-02 20:59 UTC open', U(2026, 11, 2, 20, 59), true], ['Mon 2026-11-02 21:00 UTC closed', U(2026, 11, 2, 21, 0), false],
    ['Sat 2026-07-18 15:00 UTC', U(2026, 7, 18, 15), false], ['Sun 2026-07-19 15:00 UTC', U(2026, 7, 19, 15), false], ['Sat 2026-01-17 16:00 UTC', U(2026, 1, 17, 16), false],
    ['Wed 2026-07-15 03:00 UTC (overnight)', U(2026, 7, 15, 3), false],
  ];
  for (const [name, ms, open] of cases) assert.equal(usCashOpen(ms), open, name);
});
test('H4. a NaN or infinite time is closed', () => { for (const v of [NaN, Infinity, -Infinity]) assert.equal(usCashOpen(v), false); });

/* a seeded random walk, 1h candles whose LAST candle opens at `lastOpen` (UTC ms) */
function series(lastOpen: number, n = 400, tfMs = 3_600_000) {
  let s = 20261119 >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = []; let p = 200;
  for (let i = 0; i < n; i++) { const o = p, c = Math.max(1, o * (1 + (rnd() - 0.5) * 0.006)); out.push({ time: lastOpen - (n - 1 - i) * tfMs, open: o, high: Math.max(o, c) * (1 + rnd() * 0.002), low: Math.min(o, c) * (1 - rnd() * 0.002), close: c, volume: 100 + rnd() * 900 }); p = c; }
  return out;
}
const SESSION = new Set(['ny_open_breakout', 'session_sweep', 'vwap_reclaim']);
const run = (id: string, coin: string, candles: ReturnType<typeof series>, tf = '1h', tfMs = 3_600_000) => STRATEGIES.find((x) => x.id === id)!.detect(candles as never, { coin, tf, tfMs, btcCandles: candles as never, oiChange6Pct: null } as never);

test('H2. CONTROL: aapl is a stock, btc is not', () => { assert.equal(coinKind('aapl'), 'stock'); assert.notEqual(coinKind('btc'), 'stock'); });
test('H2. the session strategies on a stock: WAIT + marketClosed outside the cash session, the ungated detector inside it', () => {
  const closed = series(U(2026, 7, 15, 3)), open = series(U(2026, 7, 15, 15)), weekend = series(U(2026, 7, 18, 15));
  for (const id of SESSION) {
    for (const [name, c] of [['03:00 UTC (overnight)', closed], ['Saturday 15:00 UTC', weekend]] as const) { const r = run(id, 'aapl', c); assert.equal(r.verdict, 'wait', `${id} ${name}`); assert.equal((r.params as Record<string, unknown>).marketClosed, true, `${id} ${name}: marketClosed`); }
    const a = run(id, 'aapl', open), b = run(id, 'btc', open); assert.deepEqual(a, b, `${id} inside the cash session must equal the ungated result`); assert.notEqual((a.params as Record<string, unknown>).marketClosed, true);
    const btcClosed = run(id, 'btc', closed); assert.notEqual((btcClosed.params as Record<string, unknown>).marketClosed, true, `${id}: a non-stock coin is never market-closed`);
  }
});
test('H3. every other strategy is identical for a stock and for btc on the same candles, at any hour', () => {
  for (const when of [U(2026, 7, 15, 3), U(2026, 7, 15, 15), U(2026, 7, 18, 15)]) for (const def of STRATEGIES) {
    if (SESSION.has(def.id)) continue;
    const c = series(when); assert.deepEqual(run(def.id, 'aapl', c), run(def.id, 'btc', c), `${def.id} at ${new Date(when).toISOString()}`);
  }
});
