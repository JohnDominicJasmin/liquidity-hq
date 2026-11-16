/* #2446: chart patterns are judged on CLOSED bars only. computeKlineMetrics passed the newest 15-minute bar (still forming) into detectPatterns while RSI and the volume ratio already left it out, so a Doji / Hammer /
 * Shooting star / Engulfing could appear and vanish on a candle seconds old, and the Telegram alert sends the first pattern.
 *   K1-K3  lib/klineMetrics.computeKlineMetrics, REAL code with real klines
 *   K4     the Bybit-only path in components/MarketProvider.tsx takes the same window (source anchor)
 * WHAT IT CANNOT PROVE: the Bybit-only path's behaviour (it lives inside the provider). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeKlineMetrics } from '../lib/klineMetrics.ts';
import { detectPatterns } from '../lib/patterns.ts';

/* a Binance kline row: [openTime, o, h, l, c, baseVol, closeTime, quoteVol, ...] */
const bar = (i: number, o: number, h: number, l: number, c: number) => [String(i * 900_000), String(o), String(h), String(l), String(c), '10', String(i * 900_000 + 899_999), '1000', '5', '5', '500', '0'];
const quiet = (n: number) => Array.from({ length: n }, (_, i) => bar(i, 100, 101, 99, i % 2 ? 100.5 : 99.5));
const DOJI = bar(40, 100, 103, 97, 100.02);
const candles = (rows: string[][]) => rows.map((k) => ({ o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));

test('K1. a would-be Doji on the FORMING bar is not labelled; once that bar has closed (a newer bar is forming) the Doji is', () => {
  assert.equal(computeKlineMetrics([...quiet(40), DOJI])!.chartPattern, null, 'a pattern was judged on the bar that is still forming');
  assert.equal(computeKlineMetrics([...quiet(40), DOJI, bar(41, 100, 101, 99, 100.4)])!.chartPattern, 'Doji', 'a closed Doji was not labelled');
  assert.ok(detectPatterns(candles([...quiet(40), DOJI]).slice(-25)).includes('Doji'), 'CONTROL: the Doji bar is a Doji to the detector, so K1 measures the window and not the shape');
});
test('K2. the forming bar cannot change the label: whatever shape it has, the same closed bars give the same chartPattern', () => {
  const closed = [...quiet(39), bar(39, 100, 103, 97, 100.02)];                           // the last CLOSED bar is a Doji
  const shapes = [bar(40, 100, 100.2, 99.8, 100.1), bar(40, 100, 130, 95, 128), bar(40, 100, 100, 70, 99.9), bar(40, 99, 101, 98, 99)];
  const labels = shapes.map((s) => computeKlineMetrics([...closed, s])!.chartPattern);
  assert.deepEqual([...new Set(labels)], ['Doji'], 'the forming bar changed the label: ' + JSON.stringify(labels));
});
test('K3. the label is exactly what the detector says about the 25 closed bars before the forming one, across several series', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    let x = seed * 7919; const rnd = () => { x = (x * 48271) % 2147483647; return x / 2147483647; };
    let p = 100; const rows: string[][] = [];
    for (let i = 0; i < 60; i++) { const o = p, c = p + (rnd() - 0.5) * 4, h = Math.max(o, c) + rnd() * 1.5, l = Math.min(o, c) - rnd() * 1.5; rows.push(bar(i, o, h, l, c)); p = c; }
    const expected = detectPatterns(candles(rows.slice(-26, -1))).join('; ') || null;
    assert.equal(computeKlineMetrics(rows)!.chartPattern, expected, `seed ${seed}: the window is not the 25 closed bars before the forming one`);
  }
});

const MP = readFileSync(new URL('../components/MarketProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
test('K4. the Bybit-only path in MarketProvider also judges closed bars only (slice(-26, -1))', () => {
  assert.ok(MP.includes('slice(-26, -1)'), 'the Bybit-only path passes the forming bar to detectPatterns again');
  assert.equal(/detectPatterns\([^)]*slice\(-25\)/.test(MP), false, 'a slice(-25) window (including the forming bar) is back');
});
