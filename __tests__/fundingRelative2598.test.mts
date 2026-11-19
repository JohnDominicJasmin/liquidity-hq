import test from 'node:test';
import assert from 'node:assert/strict';
import { fundingClassRelative, parseBinanceFunding, parseBybitFunding, type FundingPoint } from '../lib/strategies/liveInputs.ts';

/* QA's oracle for #2598 condition 1, from the PR's own rule text (NOT from the code): history = the coin's SETTLED rates of the last 90 days (the live rate is not in it); no reading (null) with fewer than 60
 * settlements or an oldest one younger than 45 days; longs_heavy = live rate > 0 and at least 95% of the history STRICTLY lower; shorts_heavy = live rate < 0 and at least 95% STRICTLY higher; a tie is never heavy; 0 is never heavy.
 * Also run on REAL Bybit settled funding (BTC/ETH/SOL, 90 settlements each over the last 30 days, 540 history points each): 270 of 270 agree with an independent oracle (audit_funding.mts, scratchpad). */
const H = 3_600_000, NOW = Date.UTC(2026, 10, 19);
const flat = (n: number, stepH = 8, rate = 0.0001): FundingPoint[] => Array.from({ length: n }, (_, i) => ({ time: NOW - (n - i) * stepH * H, rate }));
const withTop = (n: number, topCount: number): FundingPoint[] => flat(n).map((p, i) => ({ ...p, rate: i < topCount ? 0.0005 : 0.0001 }));
const cls = (r: number | null | undefined, h: FundingPoint[] | null | undefined) => fundingClassRelative(r, h, NOW)?.fundingClass ?? null;

test('F1. a rate strictly above the whole history is longs_heavy, strictly below is shorts_heavy', () => {
  assert.equal(cls(0.0002, flat(240)), 'longs_heavy'); assert.equal(cls(-0.0002, flat(240)), 'shorts_heavy');
});
test('F2. a tie is never heavy, and a rate of 0 is never heavy', () => {
  assert.equal(cls(0.0001, flat(240)), 'none', 'funding at the exchange baseline equals its own top value: not heavy'); assert.equal(cls(0, flat(240)), 'none');
});
test('F3. the 95% line: exactly 95% strictly lower is heavy; 94.5% is not', () => {
  assert.equal(cls(0.0002, withTop(200, 10)), 'longs_heavy', '190 of 200 below = 95%'); assert.equal(cls(0.0002, withTop(200, 11)), 'none', '189 of 200 below = 94.5%');
});
test('F4. no reading (null, never a guess): fewer than 60 settlements, a history younger than 45 days, no history, a NaN rate', () => {
  assert.equal(cls(0.0002, flat(59, 24)), null, '59 settlements'); assert.equal(cls(0.0002, flat(60, 8)), null, '60 settlements over 20 days');
  assert.equal(cls(0.0002, flat(60, 24)), 'longs_heavy', '60 settlements over 60 days is enough');
  assert.equal(cls(0.0002, null), null); assert.equal(cls(0.0002, undefined), null); assert.equal(cls(NaN, flat(240)), null); assert.equal(cls(null, flat(240)), null);
});
test('F5. only the last 90 days count: older settlements are ignored', () => {
  const old: FundingPoint[] = Array.from({ length: 200 }, (_, i) => ({ time: NOW - (100 + i) * 24 * H, rate: 0.01 })); // 100+ days old, huge rates
  assert.equal(cls(0.0002, [...old, ...flat(240)]), 'longs_heavy', 'old extreme settlements must not make a normal rate look ordinary');
});
test('F6. the parsers: Binance oldest-first rows, Bybit newest-first rows, junk dropped', () => {
  assert.deepEqual(parseBinanceFunding([{ fundingTime: 1000, fundingRate: '0.0001' }, { fundingTime: 'x', fundingRate: '1' }, null]), [{ time: 1000, rate: 0.0001 }]);
  assert.deepEqual(parseBybitFunding({ result: { list: [{ fundingRate: '-0.0002', fundingRateTimestamp: '2000' }, { fundingRate: 'bad', fundingRateTimestamp: '1000' }] } }), [{ time: 2000, rate: -0.0002 }]);
  assert.deepEqual(parseBinanceFunding('nope'), []); assert.deepEqual(parseBybitFunding(null), []);
});
