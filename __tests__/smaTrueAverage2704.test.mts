/* QA: PR #2704, the chart's SMA line is a rolling mean of the last N closes (#1007; PM 2026-11-20 after the QA indicators matrix: "the SMA chip draws EMA(12)").
 *
 * THE WRITTEN RULE: an indicator called SMA draws the simple moving average, the arithmetic mean of the last N closes, which is also what the verdict gating (smaArr) and the AI reading use. klinecharts' own 'SMA' is the recursive SMA(N,M),
 * which at its defaults IS EMA(12), so the chip drew a different line from the one named and read. The chart registers a custom 'SMA' under the same name (the SAR pattern) over ONE parameter, the length, default 12.
 *
 * WHAT RUNS: the REAL `registerIndicator({ name: 'SMA' ... })` call is cut out of components/KLineProChart.tsx (brace matching), its types stripped, and its `calc` run on synthetic closes against a stand-in `smaArr` import that is the real lib function.
 * Expectations come from the written rule and a hand-rolled mean in this file, never from the code under test.
 *   S1  hand example: closes 1..6, length 3 -> no value for the first 2 bars, then 2, 3, 4, 5 (exactly the mean of the last 3 closes)
 *   S2  60 closes, lengths 2, 5, 12, 20, 50: every bar from length-1 on equals an independent rolling mean (1e-9), the earlier bars carry no value (an empty figure, never NaN)
 *   S3  it is NOT the klinecharts recursive SMA(N,M) (the control: lib's smaNMArr(12,2) IS what the old line drew, and it differs from the rolling mean on a series with a jump) and it equals the real smaArr the gating uses
 *   S4  the length parameter: [1] is read as 2 (a mean of one close is the close itself, the PR clamps to 2), [12.4] as 12, none as the default 12
 *   S5  the registration keeps what the chart needs: name 'SMA', one line figure, price series, calcParams [12]
 *   S6  the registry chip has ONE parameter, Length (default 12), no Weight; toCalcParams gives [12] by default, [20] for length 20, and a stored legacy weight is ignored
 * WHAT THIS CANNOT PROVE: the drawn pixels, the legend text in a browser, or the chart's reaction to the old saved weight in a user's stored settings (the browser run after promotion). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { smaArr, smaNMArr } from '../lib/strategyCore.ts';
import { INDICATORS, toCalcParams, defaultParams } from '../lib/strategyRegistry.ts';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const src = readFileSync(new URL('../components/KLineProChart.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function cutRegistration(name: string): string {
  const at = new RegExp(`registerIndicator\\(\\{\\s*name: '${name}'`).exec(src);
  assert.ok(at, `no registerIndicator({ name: '${name}' ...}) in KLineProChart.tsx`);
  const open = src.indexOf('{', at.index);
  let depth = 0, i = open, inStr: string | null = null, inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '/' && n === '/') { inLine = true; continue; }
    if (c === '/' && n === '*') { inBlock = true; continue; }
    if (c === '\'' || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(open, i + 1);
}
type Figure = { key: string; title: string; type: string };
type Registration = { name: string; shortName: string; series: string; calcParams: number[]; figures: Figure[]; calc: (data: Array<{ close: number }>, ind: { calcParams: number[] }) => Array<Record<string, number>> };
const reg = new Function('smaArr', `return (${stripTypeScriptTypes(`const __x = ${cutRegistration('SMA')};`).replace(/^const __x = /, '').replace(/;\s*$/, '')})`)(smaArr) as Registration;
const run = (closes: number[], calcParams: number[]) => reg.calc(closes.map((close) => ({ close })), { calcParams });
const hand = (closes: number[], n: number) => closes.map((_, i) => (i < n - 1 ? NaN : closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));

test('S1. hand example: closes 1..6, length 3', () => {
  const out = run([1, 2, 3, 4, 5, 6], [3]);
  assert.deepEqual(out.map((o) => o.sma ?? null), [null, null, 2, 3, 4, 5]);
});

test('S2. equals an independent rolling mean at five lengths; early bars empty, never NaN', () => {
  let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 8 + rnd() * 3);
  for (const n of [2, 5, 12, 20, 50]) {
    const out = run(closes, [n]); const want = hand(closes, n);
    assert.equal(out.length, closes.length);
    out.forEach((o, i) => {
      if (Number.isNaN(want[i])) assert.equal(o.sma, undefined, `bar ${i} length ${n} carries a value before ${n} closes exist`);
      else assert.ok(Math.abs(o.sma - want[i]) < 1e-9, `bar ${i} length ${n}: ${o.sma} vs rolling mean ${want[i]}`);
      if ('sma' in o) assert.ok(Number.isFinite(o.sma), `bar ${i} length ${n} is not finite`);
    });
  }
});

test('S3. it is not the klinecharts recursive SMA(N,M) (the old line) and it is the one smaArr the gating uses', () => {
  const closes = [...Array.from({ length: 40 }, () => 100), ...Array.from({ length: 4 }, () => 200)];
  const last = run(closes, [12]).at(-1)!.sma;
  const recursive = smaNMArr(closes, 12, 2).at(-1)!;
  const rolling = smaArr(closes, 12).at(-1)!;
  console.log(`[S3] jump series, last bar: chart ${last.toFixed(4)} · rolling mean ${rolling.toFixed(4)} · klinecharts SMA(12,2) (the old line) ${recursive.toFixed(4)}`);
  assert.ok(Math.abs(recursive - rolling) > 1, 'control: this series must separate the two formulas, or the test cannot tell them apart');
  assert.ok(Math.abs(last - rolling) < 1e-9, 'the chart line is not the rolling mean');
  assert.ok(Math.abs(last - recursive) > 1, 'the chart line is still the recursive SMA(N,M)');
});

test('S4. the length parameter: clamp to 2, round, default 12', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 50 + i * 1.5 + (i % 3));
  const eq = (a: Array<Record<string, number>>, b: Array<Record<string, number>>) => assert.deepEqual(a, b);
  eq(run(closes, [1]), run(closes, [2]));
  eq(run(closes, [12.4]), run(closes, [12]));
  eq(run(closes, []), run(closes, [12]));
  assert.ok(Math.abs(run(closes, [2]).at(-1)!.sma - (closes.at(-1)! + closes.at(-2)!) / 2) < 1e-9);
});

test('S5. the registration keeps what the chart needs', () => {
  assert.equal(reg.name, 'SMA'); assert.equal(reg.series, 'price'); assert.deepEqual(reg.calcParams, [12]);
  assert.equal(reg.figures.length, 1); assert.equal(reg.figures[0].type, 'line'); assert.equal(reg.figures[0].key, 'sma');
});

test('S6. the registry chip has one parameter, Length, and ignores a stored legacy weight', () => {
  const entry = INDICATORS.find((e) => e.id === 'SMA');
  assert.ok(entry, 'no SMA entry in the registry');
  assert.deepEqual(entry.paramSchema.map((p) => p.key), ['length'], 'the SMA chip must expose only Length');
  assert.equal((entry.paramSchema[0] as { default: number }).default, 12);
  assert.deepEqual(toCalcParams(entry), [12]);
  assert.deepEqual(toCalcParams(entry, { length: 20 }), [20]);
  assert.deepEqual(toCalcParams(entry, { length: 20, weight: 5 }), [20], 'a stored Weight from before the change must not reach the chart');
  assert.deepEqual(defaultParams(entry), { length: 12 });
});
