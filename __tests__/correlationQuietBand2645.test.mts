import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tintPct, GREEN_CAP_PCT, RED_CAP_PCT } from '../lib/correlationRamp.ts';

/* #2645 (#1185 Correlation audit): THE HEATMAP DOES NOT TINT CELLS THAT CARRY NO SIGNAL. Written rule (the PR body and the file's own comment): r = 0 and every weak positive r (0 < r <= 0.35) get NO tint; the positive ramp above 0.35 and the whole negative side are unchanged.
 *   Q1 no tint at r = 0 (also -0) and across the weak positive band, including the edge 0.35 itself
 *   Q2 the positive ramp above 0.35 starts at the 4 percent floor, rises, and still reaches the green cap at r = 1
 *   Q3 the negative side is unchanged: 6 percent floor from r just below 0, the red cap at r = -1, the literal values the old curve gave
 *   Q4 the heatmap maps the numbers to colour mixes with the right token, and a zero tint is a fully clear cell */
const lit = (n: number) => Number(n.toFixed(4));

test('Q1. no tint at r = 0 and none anywhere in 0 < r <= 0.35 (the edge included)', () => {
  assert.equal(tintPct(0), 0); assert.equal(tintPct(-0), 0);
  for (const r of [0.0001, 0.01, 0.05, 0.1, 0.2, 0.25, 0.3, 0.34, 0.3499, 0.35]) assert.equal(tintPct(r), 0, `r = ${r} must be untinted`);
  for (let i = 1; i <= 35; i++) assert.equal(tintPct(i / 100), 0, `r = ${i / 100} must be untinted`);
});
test('Q2. above 0.35 the green ramp starts at its 4 percent floor, rises, and reaches the cap at r = 1', () => {
  assert.ok(tintPct(0.3501) >= 4 && tintPct(0.3501) < 4.01, `just above the edge: ${tintPct(0.3501)}`);
  assert.equal(lit(tintPct(1)), GREEN_CAP_PCT); assert.equal(GREEN_CAP_PCT, 50);
  let prev = tintPct(0.36); for (let i = 37; i <= 100; i++) { const v = tintPct(i / 100); assert.ok(v >= prev, `the positive ramp dipped at ${i / 100}`); prev = v; }
  assert.equal(lit(tintPct(0.675)), lit(4 + Math.pow((0.675 - 0.35) / 0.65, 2.2) * 46), 'the mid-ramp value moved');
  assert.ok(tintPct(0.5) > 4 && tintPct(0.5) < 10, `r 0.5 -> ${tintPct(0.5)}`);
});
test('Q3. the negative side is unchanged: literal values of the old curve', () => {
  assert.equal(lit(tintPct(-1)), RED_CAP_PCT); assert.equal(RED_CAP_PCT, 56);
  assert.equal(lit(tintPct(-0.01)), lit(6 + Math.pow(0.01, 1.5) * 50)); assert.equal(lit(tintPct(-0.35)), 16.3531)   // 6 + 0.35 * sqrt(0.35) * 50 = 6 + 0.207063 * 50; assert.equal(lit(tintPct(-0.5)), lit(6 + Math.pow(0.5, 1.5) * 50));
  for (const r of [-0.0001, -0.05, -0.2]) assert.ok(tintPct(r) >= 6, `a negative r keeps the 6 percent floor: ${r} -> ${tintPct(r)}`);
});
test('Q4. the heatmap picks the token by sign and prints the tint as a colour-mix; zero tint is clear', () => {
  const src = readFileSync(new URL('../components/CorrelationTerminal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/const pct = tintPct\(r\);\n\s*const tok = r > 0 \? '--green' : '--red';\n\s*return `color-mix\(in srgb, var\(\$\{tok\}\) \$\{pct\.toFixed\(1\)\}%, transparent\)`;/.test(src), 'the cell colour is no longer tintPct -> token by sign -> color-mix(... transparent)');
  const mix = (r: number) => { const pct = tintPct(r); const tok = r > 0 ? '--green' : '--red'; return `color-mix(in srgb, var(${tok}) ${pct.toFixed(1)}%, transparent)`; };
  assert.equal(mix(0), 'color-mix(in srgb, var(--red) 0.0%, transparent)', 'r = 0 must be a 0 percent mix (clear)'); assert.equal(mix(0.2), 'color-mix(in srgb, var(--green) 0.0%, transparent)');
  assert.notEqual(mix(0.6), 'color-mix(in srgb, var(--green) 0.0%, transparent)'); assert.notEqual(mix(-0.2), 'color-mix(in srgb, var(--red) 0.0%, transparent)');
});
