import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSupplyDemand, btcSide, SUPPLY_DEMAND, FRESH_BARS, MIN_CANDLES } from '../lib/strategies/supplyDemand.ts';

/* QA's unit cells for strategy 4 (#2313): supply/demand zone retest with a BTC check. Rules from the PR text: an IMPULSE is a candle whose body is at least 1.5x the ATR(14) before it and which closes beyond the
 * whole range of the candle just before it (the BASE); a bullish impulse leaves a DEMAND zone = the base candle's range (bearish: SUPPLY). The zone is used ONCE (the first candle back in it is the retest), and
 * dies when a candle closes through its far side. BUY = the retest candle's low reaches the zone top and it closes back ABOVE it; SELL the mirror. Fresh for 2 closed candles. BTC CHECK (any coin but BTC): a buy
 * needs BTC above its EMA50, a sell below; against = wait with the reason; no BTC candles = no answer (wait with btcUnknown, which the caller must treat as unknown). */

const T0 = 1_700_000_000_000; const TF = 3_600_000;
type C = { time: number; open: number; high: number; low: number; close: number; volume: number };
const mk = (i: number, o: number, c: number, h: number, l: number): C => ({ time: T0 + i * TF, open: o, close: c, high: h, low: l, volume: 100 });
const quiet = (i: number): C => mk(i, 100, 100.3, 101, 99);          // true range 2: ATR(14) = 2, zone base = [99, 101]
/** 70 quiet candles (indexes 0..69), then the listed candles appended. */
function series(extra: Array<[number, number, number, number]>, pre = 70): C[] { const cs = Array.from({ length: pre }, (_, i) => quiet(i)); extra.forEach(([o, c, h, l], k) => cs.push(mk(pre + k, o, c, h, l))); return cs; }
const UP_IMPULSE: [number, number, number, number] = [100, 104, 104.5, 99.8];      // body 4 >= 1.5 x ATR 2, closes above the base high 101
const DN_IMPULSE: [number, number, number, number] = [100, 96, 100.2, 95.5];       // body 4, closes under the base low 99
const AWAY_UP: [number, number, number, number] = [104, 105, 105.5, 103];          // stays clear of the demand zone
const AWAY_DN: [number, number, number, number] = [96, 95, 97, 94.5];
const RETEST_BUY: [number, number, number, number] = [103, 102, 103.2, 100.5];     // low reaches the zone top (101), closes back above it
const RETEST_SELL: [number, number, number, number] = [97, 98.3, 99.2, 97];          // high reaches the zone bottom (99), closes back under it
const ctxBtc = { coin: 'btc', tf: '1h', tfMs: TF };
const btcUp = (): C[] => Array.from({ length: 70 }, (_, i) => mk(i, 100 + i, 101 + i, 102 + i, 99 + i));      // closes well above its EMA50
const btcDown = (): C[] => Array.from({ length: 70 }, (_, i) => mk(i, 200 - i, 199 - i, 201 - i, 198 - i));

test('4-a. BUY: a bullish impulse leaves a demand zone (the base range 99-101); the retest dips into it and closes back above: buy, on the retest candle, invalidation = the zone low', () => {
  const cs = series([UP_IMPULSE, AWAY_UP, RETEST_BUY]); const r = detectSupplyDemand(cs, ctxBtc);
  assert.equal(r.verdict, 'buy'); assert.equal(r.signalDir, 'long'); assert.equal(r.signalTimestamp, cs[cs.length - 1].time);
  assert.equal(r.params.zoneHi, 101); assert.equal(r.params.zoneLo, 99); assert.equal(r.params.inv, 99); assert.equal(r.params.btcChecked, false, 'BTC itself needs no BTC check');
});
test('4-b. SELL: the mirror on a supply zone: invalidation = the zone high', () => {
  const cs = series([DN_IMPULSE, AWAY_DN, RETEST_SELL]); const r = detectSupplyDemand(cs, ctxBtc);
  assert.equal(r.verdict, 'sell'); assert.equal(r.signalDir, 'short'); assert.equal(r.params.inv, 101);
});
test('4-c. CONTROLS (wait): an impulse that is too small; one that does not close beyond the base; a touch that closes INSIDE the zone (no rejection); a close through the far side kills the zone; under 60 candles', () => {
  assert.equal(detectSupplyDemand(series([[100, 102, 102.5, 99.8], AWAY_UP, RETEST_BUY]), ctxBtc).verdict, 'wait', 'body 2 < 1.5 x ATR');
  assert.equal(detectSupplyDemand(series([[100, 100.9, 104.5, 99.8], AWAY_UP, RETEST_BUY]), ctxBtc).verdict, 'wait', 'closes inside the base range');
  assert.equal(detectSupplyDemand(series([[96, 100, 100.5, 95.5], AWAY_UP, RETEST_BUY]), ctxBtc).verdict, 'wait', 'a big body that closes INSIDE the base range (99-101) is not an impulse');
  assert.equal(detectSupplyDemand(series([UP_IMPULSE, AWAY_UP, [103, 100.8, 103.2, 100.5]]), ctxBtc).verdict, 'wait', 'the retest closed inside the zone (<= 101)');
  assert.equal(detectSupplyDemand(series([UP_IMPULSE, [104, 98, 104.5, 97.5], AWAY_UP, RETEST_BUY]), ctxBtc).verdict, 'wait', 'a close under 99 broke the demand zone');
  assert.equal(MIN_CANDLES, 60); assert.equal(detectSupplyDemand(series([UP_IMPULSE, AWAY_UP, RETEST_BUY], 50), ctxBtc).verdict, 'wait', '53 candles');
  assert.equal(SUPPLY_DEMAND.minCandles, 60);
});
test('4-d. USED ONCE: the FIRST candle back in the zone decides; if it did not reject, a later rejecting touch is not a signal', () => {
  const firstFails = series([UP_IMPULSE, AWAY_UP, [103, 100.8, 103.2, 100.5], AWAY_UP, RETEST_BUY]);
  assert.equal(detectSupplyDemand(firstFails, ctxBtc).verdict, 'wait');
});
test('4-e. NO REPEAT: fresh for FRESH_BARS closed candles with the same identity, then stale', () => {
  assert.equal(FRESH_BARS, 2);
  const at0 = detectSupplyDemand(series([UP_IMPULSE, AWAY_UP, RETEST_BUY]), ctxBtc);
  const at1 = detectSupplyDemand(series([UP_IMPULSE, AWAY_UP, RETEST_BUY, AWAY_UP]), ctxBtc);
  const at2 = detectSupplyDemand(series([UP_IMPULSE, AWAY_UP, RETEST_BUY, AWAY_UP, AWAY_UP]), ctxBtc);
  assert.equal(at0.verdict, 'buy'); assert.equal(at1.verdict, 'buy'); assert.equal(at1.signalTimestamp, at0.signalTimestamp);
  assert.equal(at2.verdict, 'wait', 'two candles on the retest is stale');
});
test('4-f. BTC CHECK for another coin: a buy needs BTC above its EMA50; BTC below it blocks the buy (wait + btcBlocked, with the BTC reason key)', () => {
  const cs = series([UP_IMPULSE, AWAY_UP, RETEST_BUY]);
  const ok = detectSupplyDemand(cs, { coin: 'eth', tf: '1h', tfMs: TF, btcCandles: btcUp() });
  assert.equal(ok.verdict, 'buy'); assert.equal(ok.params.btcChecked, true); assert.equal(SUPPLY_DEMAND.reasonKeyFor!(ok), 'STRAT_SD_BUY_BTC');
  const blocked = detectSupplyDemand(cs, { coin: 'eth', tf: '1h', tfMs: TF, btcCandles: btcDown() });
  assert.equal(blocked.verdict, 'wait'); assert.equal(blocked.params.btcBlocked, true); assert.equal(SUPPLY_DEMAND.reasonKeyFor!(blocked), 'STRAT_SD_WAIT_BTC');
});
test('4-g. BTC CHECK mirror: a sell needs BTC BELOW its EMA50', () => {
  const cs = series([DN_IMPULSE, AWAY_DN, RETEST_SELL]);
  const ok = detectSupplyDemand(cs, { coin: 'sol', tf: '1h', tfMs: TF, btcCandles: btcDown() });
  assert.equal(ok.verdict, 'sell'); assert.equal(SUPPLY_DEMAND.reasonKeyFor!(ok), 'STRAT_SD_SELL_BTC');
  assert.equal(detectSupplyDemand(cs, { coin: 'sol', tf: '1h', tfMs: TF, btcCandles: btcUp() }).params.btcBlocked, true);
});
test('4-h. NO BTC CANDLES for another coin is UNKNOWN, not a quiet wait: the result carries btcUnknown so the caller can show an error; BTC itself ignores the check', () => {
  const cs = series([UP_IMPULSE, AWAY_UP, RETEST_BUY]);
  const r = detectSupplyDemand(cs, { coin: 'eth', tf: '1h', tfMs: TF });
  assert.equal(r.verdict, 'wait'); assert.equal(r.params.btcUnknown, true);
  assert.equal(detectSupplyDemand(cs, { coin: 'eth', tf: '1h', tfMs: TF, btcCandles: btcUp().slice(0, 40) }).params.btcUnknown, true, 'too few BTC candles is unknown as well');
  assert.equal(detectSupplyDemand(cs, ctxBtc).verdict, 'buy');
  assert.equal(SUPPLY_DEMAND.needsBtc, true);
});
test('4-i. btcSide: +1 above the EMA50, -1 below, 0 without enough data', () => {
  assert.equal(btcSide(btcUp()), 1); assert.equal(btcSide(btcDown()), -1); assert.equal(btcSide(undefined), 0); assert.equal(btcSide(btcUp().slice(0, 30)), 0);
});
