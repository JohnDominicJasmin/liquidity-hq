/* QA: PR #2813 (#1651 owner item 25), a series that did not move gets no reading. The oracle is written from the stated rule, not from the code: under 20 candles it says nothing; with 20 or more, dead means the last 20 closes are all one price, or more than 10 of the last 20 candles traded nothing.
 *   M1 the function agrees with the oracle over the edges and 2000 generated series
 *   M2 the AI read gets no indicator readings on a dead series (and does on a moving one)
 *   M3 no chart pattern on a series that did not trade (the same prices with volume do name one)
 *   M4 the EMA card reads FREEZE with the phrase, before any selected-indicator gate; no stop or target follows from FREEZE
 *   M5 the phrase has a label, and the Bybit path in the browser applies the same rule */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notEnoughMovement } from '../lib/deadSeries.ts';
import { selectedIndicatorReadings } from '../lib/indicatorReadings.ts';
import { computeKlineMetrics } from '../lib/klineMetrics.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
type C = { close: number; volume?: number };
const oracle = (all: C[]) => {
  if (all.length < 20) return false;
  const last = all.slice(all.length - 20);
  return new Set(last.map((c) => c.close)).size === 1 || last.filter((c) => c.volume === 0).length >= 11;
};
const flat = (n: number, volume = 5): C[] => Array.from({ length: n }, () => ({ close: 100, volume }));
const moving = (n: number, volume = 5): C[] => Array.from({ length: n }, (_, i) => ({ close: 100 + (i % 5), volume }));

test('M1. the function agrees with the rule', () => {
  assert.equal(notEnoughMovement(flat(19)), false, 'too short to say');
  assert.equal(notEnoughMovement(flat(20)), true); assert.equal(notEnoughMovement([...flat(19), { close: 101, volume: 5 }]), false);
  assert.equal(notEnoughMovement([{ close: 101, volume: 5 }, ...flat(20)]), true, 'only the last 20 count');
  const zeros = (k: number) => moving(30).map((c, i) => (i >= 30 - k ? { ...c, volume: 0 } : c));
  assert.equal(notEnoughMovement(zeros(10)), false); assert.equal(notEnoughMovement(zeros(11)), true);
  assert.equal(notEnoughMovement(moving(40).map((c) => ({ close: c.close }))), false, 'an unknown volume is not zero');
  assert.equal(notEnoughMovement(moving(40).map((c) => ({ ...c, volume: NaN }))), false);
  let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647; let dead = 0;
  for (let i = 0; i < 2000; i++) {
    const still = rnd(), idle = rnd();
    const s = Array.from({ length: 15 + Math.floor(rnd() * 30) }, () => ({ close: rnd() < still * 1.3 ? 100 : 100 + Math.floor(rnd() * 3), volume: rnd() < idle ? 0 : 1 }));
    assert.equal(notEnoughMovement(s), oracle(s), `series ${i}`); if (oracle(s)) dead++;
  }
  assert.ok(dead > 100 && dead < 1900, `CONTROL: ${dead} of 2000 generated series were dead`);
});

const ohlcv = (cs: C[]) => cs.map((c, i) => ({ time: i * 3_600_000, open: c.close, high: c.close + 1, low: c.close - 1, close: c.close, volume: c.volume as number }));

test('M2. a dead series has no indicator readings', () => {
  const sel = ['SMA', 'BOLL', 'SAR', 'MACD'];
  assert.ok(selectedIndicatorReadings(ohlcv(moving(300)), sel, undefined).length >= 4, 'CONTROL: a moving series has readings');
  assert.deepEqual(selectedIndicatorReadings(ohlcv(flat(300)), sel, undefined), []);
  assert.deepEqual(selectedIndicatorReadings(ohlcv(moving(300, 0)), sel, undefined), []);
});

test('M3. no chart pattern on a series that did not trade', () => {
  /* rising candles name an uptrend when they trade */
  const rows = (volume: string) => Array.from({ length: 121 }, (_, i) => [String(i * 900_000), String(100 + i), String(102 + i), String(99 + i), String(101 + i), volume, String(i * 900_000 + 899_999), volume, '1', volume, volume, '0']);
  const traded = computeKlineMetrics(rows('10')), idle = computeKlineMetrics(rows('0'));
  assert.ok(traded && traded.chartPattern, `CONTROL: the trading series named no pattern (${traded?.chartPattern})`);
  assert.ok(idle, 'the metrics themselves are still computed');
  assert.equal(idle!.chartPattern, null);
});

test('M4. the EMA card reads FREEZE with the phrase, ahead of the selected-indicator gates, and FREEZE sets no stop or target', () => {
  const s = read('lib/useEMAStrategy.ts');
  const at = s.search(/const deadSeries = notEnoughMovement\(cRibbon\);\s*\n\s*if \(deadSeries\) \{ verdict = 'FREEZE'; phase = 'Not enough movement to judge'; \}/);
  assert.ok(at > 0, 'the dead-series verdict is gone');
  assert.ok(at > s.indexOf('let verdict: StrategyVerdict = judged.verdict;') && at < s.indexOf('const BUF = 0.005;'));
  assert.ok(!/if \(deadSeries\)[\s\S]*verdict = '(LONG_SETUP|SHORT_SETUP)'/.test(s.slice(at)), 'something after it sets a setup again');
  assert.match(s.slice(s.indexOf('const BUF = 0.005;'), s.indexOf('// Conditions checklist')), /if \(verdict === 'LONG_SETUP'\) \{[\s\S]*\} else if \(verdict === 'SHORT_SETUP'\) \{/);
});

test('M5. the phrase is translated by label, and the browser Bybit path applies the rule', () => {
  assert.ok(read('lib/emaPhaseI18n.ts').includes("'Not enough movement to judge': 'EMA_PHASE_NOT_ENOUGH_MOVEMENT',"));
  assert.equal((JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>).EMA_PHASE_NOT_ENOUGH_MOVEMENT, 'Not enough movement to judge');
  assert.match(read('components/MarketProvider.tsx'), /const dead = notEnoughMovement\(klines\.slice\(0, -1\)[\s\S]{0,200}const patterns = dead \? \[\] : detectPatterns\(patternCandles\);/);
});
