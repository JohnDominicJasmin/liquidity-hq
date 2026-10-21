/* #1626 C (#1647, owner: "Standard RSI"): lib/rsi.ts against an INDEPENDENT oracle, not against itself.
 *
 * THE ORACLE: the published worked example of Wilder's RSI(14) (StockCharts ChartSchool, 33 closes, first RSI on the 15th close). The expected
 * sequence below was reproduced by QA with a separate 6-line implementation before it was written here, so a typo in either would have shown.
 *
 * WHAT THIS PINS: wilderRsiSeries matches the published values to 0.01 on every bar; it is NaN before the 15th close; wilderRsi/computeRSI14 return
 * the last value unrounded and null under 15 closes; a series with no losses reads 100; formatRsi shows one decimal and "-" for nothing, so a 29.96
 * never displays as "30" next to an oversold badge; the RSI route keeps closed candles only (Binance by close time, Bybit without its forming row)
 * and fetches 120 candles; the Scanner compares the unrounded value with 30/70.
 *
 * WHAT IT CANNOT PROVE: that an exchange's candles equal TradingView's (the owner's live check on qa: 5 coins x 1h/4h/1D/1W within 0.5), or that every
 * screen shows its timeframe (labels, checked on the page). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wilderRsiSeries, wilderRsi, computeRSI14, formatRsi } from '../lib/rsi.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CLOSES = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.6140, 46.2820, 46.2820, 46.0028,
  46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548, 44.0288, 44.1783, 44.2181, 44.5672, 43.4205, 42.6628, 43.1314];
const PUBLISHED = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.30, 33.08, 37.77];

test('O1. the series matches the published Wilder example on every bar (to 0.01), from the 15th close on', () => {
  const s = wilderRsiSeries(CLOSES);
  assert.equal(s.length, CLOSES.length);
  for (let i = 0; i < 14; i++) assert.ok(Number.isNaN(s[i]), `bar ${i} should be undefined (NaN), got ${s[i]}`);
  PUBLISHED.forEach((want, k) => { const got = s[14 + k]; assert.ok(Math.abs(got - want) < 0.01, `bar ${14 + k}: want ${want}, got ${got.toFixed(4)}`); });
});

test('O2. the latest value is the last bar, unrounded; fewer than 15 closes give null; computeRSI14 is the same function', () => {
  const v = wilderRsi(CLOSES)!;
  assert.ok(Math.abs(v - 37.77) < 0.01); assert.equal(Number.isInteger(v), false, 'rounded before use');
  assert.equal(wilderRsi(CLOSES.slice(0, 14)), null); assert.ok(wilderRsi(CLOSES.slice(0, 15)) !== null);
  assert.equal(computeRSI14(CLOSES), v);
});

test('O3. no losses at all reads 100; a one-step series reads its seed', () => {
  assert.equal(wilderRsi(Array.from({ length: 30 }, (_, i) => 100 + i)), 100);
  assert.ok(Math.abs(wilderRsi(CLOSES.slice(0, 15))! - 70.53) < 0.01);
});

test('O4. display: one decimal, "-" for nothing; 29.96 shows as 30.0 but the value itself stays under 30 for the badge', () => {
  assert.equal(formatRsi(29.96), '30.0'); assert.equal(formatRsi(37.7712), '37.8'); assert.equal(formatRsi(null), '-'); assert.equal(formatRsi(Number.NaN), '-');
});

test('S1. the RSI route keeps CLOSED candles only and fetches 120 of them', () => {
  const src = stripTsComments(read('app/api/market/rsi/route.ts'));
  assert.ok(/const RSI_HISTORY = 120;/.test(src));
  assert.ok(/return \[\.\.\.list\]\.slice\(1\)\.reverse\(\)\.map\(/.test(src), 'the Bybit forming row is not dropped');
  assert.ok(/body\.filter\(\(k: \(string \| number\)\[\]\) => Number\(k\[6\]\) < now\)/.test(src), 'Binance rows are not filtered by their close time');
});
