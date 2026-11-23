/* QA: PR #2791 (#1185), the Confluence Score's multi-timeframe RSI row drops out when all three RSI values are missing (Dev's list on the PR).
 * WHY IT MATTERS (the real scorer, lib/confluence.ts computeConfluence): every directional factor adds its weight to the denominator even when it votes neutral, so a neutral RSI row built from three nulls pulls the score toward 0 by 20 points of denominator. The cells:
 *   R1 the dilution is real: the same bullish factors score higher WITHOUT a neutral 20-point row than with it (the defect the guard removes)
 *   R2 multiTfRsiFactor(null, null, null) is neutral (so the guard in the component, not the function, is what keeps it out of the score)
 *   R3 the component builds the row only when at least one of the three RSI values is not null, one or two landed timeframes still vote (source read: the guard expression precedes the call and covers all three)
 *   R4 a landed timeframe above 57 votes bull with weight 20; below 43 bear; between neutral (the shown "▲ +20" row of the staging probe)
 * The component is a React render; there is no renderer here, so R3 reads its source, the same way heldWhileStale2783 checks its wiring. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeConfluence, multiTfRsiFactor, type ConfluenceFactorInput } from '../lib/confluence.ts';

const bull = (label: string, weight: number): ConfluenceFactorInput => ({ kind: 'directional', label, dir: 'bull', weight });
const BASE: ConfluenceFactorInput[] = [bull('EMA', 30), bull('Order flow', 20)];

test('R1 a neutral 20 point RSI row dilutes the score toward 0, so a row with no data must not be in the list', () => {
  const without = computeConfluence(BASE).score; const withNeutral = computeConfluence([...BASE, { kind: 'directional', label: 'RSI', dir: 'neutral', weight: 20 }]).score;
  assert.equal(without, 100, 'two bullish factors are not 100'); assert.ok(withNeutral < without, `a neutral row did not dilute: ${withNeutral} vs ${without}`); assert.equal(withNeutral, Math.round((50 / 70) * 100));
});

test('R2 multiTfRsiFactor with three nulls is neutral at weight 20 (the guard in the component is what removes it)', () => {
  const f = multiTfRsiFactor(null, null, null); assert.equal(f.dir, 'neutral'); assert.equal(f.weight, 20);
});

test('R4 a landed timeframe votes on what it has: above 57 bull, below 43 bear, between neutral; always weight 20', () => {
  for (const [args, dir] of [[[70, null, null], 'bull'], [[null, 62, null], 'bull'], [[null, null, 80], 'bull'], [[30, null, null], 'bear'], [[50, 50, 50], 'neutral']] as const) {
    const f = multiTfRsiFactor(...(args as [number | null, number | null, number | null])); assert.equal(f.weight, 20); assert.equal(f.dir, dir, `${JSON.stringify(args)}`);
  }
});

test('R3 the component builds the RSI row only when at least one of the three values is not null', () => {
  const src = readFileSync(new URL('../components/ConfluenceScore.tsx', import.meta.url), 'utf8');
  const m = /d\.rsi14 == null && d\.rsi1h == null && d\.rsi4h == null \? \[\] : \[multiTfRsiFactor\(d\.rsi14, d\.rsi1h, d\.rsi4h\)\]/.exec(src);
  assert.ok(m, 'the all-null guard before multiTfRsiFactor is not in ConfluenceScore.tsx');
  assert.equal((src.match(/multiTfRsiFactor\(/g) ?? []).length, 1, 'multiTfRsiFactor is called from more than one place: another path can still add a neutral row');
});
