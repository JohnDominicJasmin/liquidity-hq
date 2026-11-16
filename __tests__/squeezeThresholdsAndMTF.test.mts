/* #2451: the squeeze score stops firing on ordinary readings (S3), the multi-timeframe cells can no longer contradict RSI (S4), and one funding threshold table is used everywhere (S9).
 *   R1-R4  REAL computeSqueezeScore: the rungs. Funding counts from 0.02% (22) and 0.05% (40), negative from -0.015% (22) / -0.03% (40); a long/short share counts from 58% (22) / 65% (40); the old 0.01% / -0.005% / 52% rungs are gone;
 *          a direction needs two signals AND the dominant side at 40+
 *   M1-M3  REAL computeTFSignal (sliced from components/MultiTFSqueezeView.tsx and run): funding and L/S amplify ONLY the side RSI chose; the direction never contradicts RSI (a property over a grid); RSI neutral stays neutral
 *   U1     the sidebar and Markets use the same funding bands as classifyFunding and the scanner (+0.05% / -0.03%): the 0.04 / -0.02 pair is gone
 * The slice is OUR OWN checked-in source, never input. WHAT IT CANNOT PROVE: the cells' rendering. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { computeSqueezeScore } from '../lib/marketStore.ts';

/* Cast rather than a named import: stripTypeScriptTypes is experimental and this repo's @types/node does not declare it (TS2305), though it exists at runtime (same pattern as libStrippable.test.mts). */
const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
const coin = (f: Record<string, unknown> = {}) => ({ price: 100, ...f }) as never;
const S = (f: Record<string, unknown>) => computeSqueezeScore(coin(f));
const LS = (long: number, short: number) => ({ longRatio: long, shortRatio: short });

test('R1. funding rungs: +0.01% is baseline (no signal), +0.02% = 22, +0.05% = 40; -0.005% no signal, -0.015% = 22, -0.03% = 40', () => {
  const lone = (fr: number) => S({ fundingRate: fr, ...LS(0.5, 0.5) });             // a second, neutral input so the coin is "enough"
  assert.equal(lone(0.0001).score, 0, '+0.01% was counted as a signal (it is the exchanges\' baseline)'); assert.equal(lone(0.00019).score, 0);
  assert.equal(lone(0.0002).score, 22); assert.equal(lone(0.00049).score, 22); assert.equal(lone(0.0005).score, 40);
  assert.equal(lone(-0.00005).score, 0, '-0.005% was counted as a signal'); assert.equal(lone(-0.00014).score, 0);
  assert.equal(lone(-0.00015).score, 22); assert.equal(lone(-0.0003).score, 40);
});
test('R2. long/short share rungs: 52% is not positioning (no signal), 58% = 22, 65% = 40, on either side', () => {
  const ls = (long: number, short: number) => S({ fundingRate: 0, ...LS(long, short) });
  assert.equal(ls(0.52, 0.1).score, 0, 'a 52% long share was counted as a signal'); assert.equal(ls(0.579, 0.1).score, 0);
  assert.equal(ls(0.58, 0.1).score, 22); assert.equal(ls(0.65, 0.1).score, 40);
  assert.equal(ls(0.1, 0.52).score, 0); assert.equal(ls(0.1, 0.58).score, 22); assert.equal(ls(0.1, 0.65).score, 40);
});
test('R3. THE DEFECT: funding +0.01% with a 52% long share is no direction, score 0 ("Balanced", enough) - it used to read "Long liquidation risk" at 20', () => {
  const r = S({ fundingRate: 0.0001, ...LS(0.52, 0.1) });
  assert.equal(r.dir, 'NEUTRAL'); assert.equal(r.score, 0); assert.equal(r.label, 'Balanced'); assert.equal(r.enough, true);
});
test('R4. a direction needs two signals AND the dominant side at 40+: 22 + 22 = 44 is a setup, 22 + 8 = 30 is not, 40 alone is not, 40 + 15 is', () => {
  assert.equal(S({ fundingRate: 0.0002, ...LS(0.58, 0.1) }).dir, 'LONG_LIQ'); assert.equal(S({ fundingRate: 0.0002, ...LS(0.58, 0.1) }).score, 44);
  const weak = S({ fundingRate: 0.0002, takerBuyRatio: 0.42, takerBasis: 'candles' }); assert.equal(weak.dir, 'NEUTRAL', '22 + 8 = 30 was called a setup'); assert.equal(weak.score, 30);
  assert.equal(S({ fundingRate: 0.0005 }).label, 'Not enough data', 'funding +0.05% alone with no second input');
  assert.equal(S({ fundingRate: 0.0005, takerBuyRatio: 0.38, takerBasis: 'candles' }).dir, 'LONG_LIQ');
  assert.equal(S({ fundingRate: -0.0003, ...LS(0.1, 0.58) }).dir, 'SHORT_SQ'); assert.equal(S({ fundingRate: -0.0003, ...LS(0.1, 0.58) }).score, 62);
});

const SRC = readFileSync(new URL('../components/MultiTFSqueezeView.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const a = SRC.indexOf('function computeTFSignal('); assert.ok(a > 0, 'CONTROL: computeTFSignal not found');
const fn = SRC.slice(a, SRC.indexOf('\n}\n', a) + 3);
type TF = { dir: 'FLUSH' | 'SQUEEZE' | 'NEUTRAL'; strength: number; rsi: number | null };
const tf = new Function(`return (${stripTypeScriptTypes(fn.replace(/^function computeTFSignal/, 'function computeTFSignal')).replace(/^function computeTFSignal/, 'function')});`)() as (rsi: number | null, fr: number | null, l: number | null, s: number | null) => TF;

test('M1. THE DEFECT: RSI 38 (oversold) with funding +0.05% and a 65% long share is SQUEEZE-side at RSI strength, never FLUSH 45', () => {
  const r = tf(38, 0.0005, 0.65, 0.1);
  assert.notEqual(r.dir, 'FLUSH', 'an oversold timeframe read FLUSH because funding and the long share pointed the other way'); assert.equal(r.dir, 'SQUEEZE'); assert.equal(r.strength, 10, 'funding and the long share changed an oversold cell');
});
test('M2. funding and L/S amplify the side RSI chose: overbought 72 + funding 0.05% + 65% long = FLUSH 85; oversold 30 + funding -0.03% + 65% short = SQUEEZE 85; the mid rungs add 15 / 10', () => {
  assert.deepEqual([tf(72, 0.0005, 0.65, 0.1).dir, tf(72, 0.0005, 0.65, 0.1).strength], ['FLUSH', 85]);
  assert.deepEqual([tf(30, -0.0003, 0.1, 0.65).dir, tf(30, -0.0003, 0.1, 0.65).strength], ['SQUEEZE', 85]);
  assert.equal(tf(72, 0.0002, 0.58, 0.1).strength, 40 + 15 + 10);
  assert.equal(tf(72, 0.0001, 0.52, 0.1).strength, 40, 'the removed 0.01% / 52% rungs added points');
  assert.equal(tf(72, 0.00045, 0.1, 0.1).strength, 40 + 15, 'funding 0.045% is the 15 rung, not the 25 rung (the 0.05% boundary moved)');
});
test('M3. PROPERTY over a grid: the direction never contradicts RSI (RSI <= 40 is never FLUSH, RSI >= 60 never SQUEEZE), RSI 41-59 is always NEUTRAL with strength 0, and null RSI is neutral', () => {
  const frs = [null, -0.0005, -0.0003, -0.00015, 0, 0.0001, 0.0002, 0.0005, 0.001], ratios: [number, number][] = [[0.1, 0.1], [0.52, 0.1], [0.58, 0.1], [0.65, 0.1], [0.1, 0.58], [0.1, 0.65]];
  let n = 0;
  for (let rsi = 5; rsi <= 95; rsi += 1) for (const fr of frs) for (const [l, s] of ratios) {
    const r = tf(rsi, fr, l, s); n++;
    if (rsi <= 40) assert.notEqual(r.dir, 'FLUSH', `rsi ${rsi} fr ${fr} ls ${l}/${s} read FLUSH`);
    if (rsi >= 60) assert.notEqual(r.dir, 'SQUEEZE', `rsi ${rsi} fr ${fr} ls ${l}/${s} read SQUEEZE`);
    if (rsi > 40 && rsi < 60) { assert.equal(r.dir, 'NEUTRAL'); assert.equal(r.strength, 0); }
  }
  assert.ok(n > 3000, 'CONTROL: the grid shrank'); assert.deepEqual(tf(null, 0.0005, 0.65, 0.1), { dir: 'NEUTRAL', strength: 0, rsi: null });
});

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
test('U1. the dashboard sidebar and Markets read funding with the same bands as classifyFunding and the scanner (+0.05% / -0.03%)', () => {
  const dash = strip(readFileSync(new URL('../components/DashboardTerminal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')), mk = strip(readFileSync(new URL('../components/MarketsTerminal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
  assert.ok(dash.includes('if (fr >= 0.05)       sig = {') && dash.includes('else if (fr <= -0.03) sig = {'), 'the sidebar funding bands changed');
  assert.ok(mk.includes("if (fr >= 0.05) return { key: 'MARKETS_SIGNAL_LONGS_OVERCROWDED'") && mk.includes("if (fr <= -0.03) return { key: 'MARKETS_SIGNAL_SHORTS_SQUEEZED'"), 'the Markets funding bands changed');
  assert.equal(/fr >= 0\.04|fr <= -0\.02\b/.test(dash + mk), false, 'the old 0.04 / -0.02 pair is back: one coin reads differently on different screens');
});
