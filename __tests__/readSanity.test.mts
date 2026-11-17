/* #2502: an AI read's prose must not contradict the numbers it was given (PM audit 2026-11-17: "price below EMA9 / below VWAP" while price was above both).
 *   R1  extractReadInputs reads the inputs back out of the PROMPT: "Last Close: $64,670 / EMA 9: $64,530 / SMA 200: $66,000.50 / price ABOVE VWAP"; absent inputs are null; BELOW VWAP too
 *   R2  PM's real string (A): close 64670, EMA9 64530, SMA200 66000, price above VWAP - "price below both EMA9 and SMA200" keeps the TRUE half: "price below SMA200"
 *   R3  PM's real string (B): "...ribbon and price below VWAP." loses the wrong clause: "4 bearish signals including trending short ribbon."
 *   R4  a correct claim is left alone ("Price is above EMA9 and above VWAP, so trend holds."), nothing recorded as dropped
 *   R5  a both-wrong pair ("Price below both EMA9 and VWAP.") drops the SENTENCE whole (text ""), and says what it dropped
 *   R6  the 0.05% dead band: a price within 0.05% of the average is too close to call (nothing judged); just outside it the claim is judged
 *   R7  with nothing known (no close/EMA/SMA/VWAP side) the text is returned untouched
 *   R8  applyResultChecks applies it to reasoning, chartAnalysis, waitFor, raidTrigger AND catalysts, puts "prose fixed or dropped (<field>)" in checks, never blanks reasoning/chartAnalysis, and a catalyst that becomes empty is removed
 *   R9  source pins: the route imports extractReadInputs; the Arena Ribbon chip reads a tick when it agrees with the verdict, a cross when it opposes, a dot otherwise (no green up-arrow on a bearish read)
 * WHAT IT CANNOT PROVE: that the AI will not state a NEW kind of wrong claim (only EMA9, SMA200 and VWAP sides are checked), or the wording quality of the fixed sentence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractReadInputs, dropContradictingClauses, type ReadInputs } from '../lib/readSanity.ts';
import { applyResultChecks } from '../lib/grok.ts';

const INPUTS: ReadInputs = { close: 64670, ema9: 64530, sma200: 66000, vwapSide: 'above' };
const PROMPT = 'Last Close: $64,670\nEMA 9: $64,530\nSMA 200: $66,000\nprice ABOVE VWAP';
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('R1. the inputs are read back out of the prompt', () => {
  assert.deepEqual(extractReadInputs('Last Close: $64,670 / EMA 9: $64,530 / SMA 200: $66,000.50 / price ABOVE VWAP'), { close: 64670, ema9: 64530, sma200: 66000.5, vwapSide: 'above' });
  assert.deepEqual(extractReadInputs('Last Close: $1,234.5, price BELOW VWAP'), { close: 1234.5, ema9: null, sma200: null, vwapSide: 'below' });
  assert.deepEqual(extractReadInputs('nothing numeric here'), { close: null, ema9: null, sma200: null, vwapSide: null });
});

test('R2. (A) "price below both EMA9 and SMA200": only EMA9 is wrong, the true half stays', () => {
  const r = dropContradictingClauses('Neutral momentum regime with price below both EMA9 and SMA200 plus a bearish structure break on the 4H gives a clear edge to shorts even without a full short setup trigger.', INPUTS);
  assert.equal(r.text, 'Neutral momentum regime with price below SMA200 plus a bearish structure break on the 4H gives a clear edge to shorts even without a full short setup trigger.');
  assert.equal(r.dropped.length, 1, 'the changed pair is recorded');
});

test('R3. (B) "...and price below VWAP" while price is above VWAP: the wrong clause goes', () => {
  const r = dropContradictingClauses('4 bearish signals including trending short ribbon and price below VWAP.', INPUTS);
  assert.equal(r.text, '4 bearish signals including trending short ribbon.');
  assert.ok(r.dropped.some((d) => /wrong side/.test(d)), `what was dropped must say so: ${JSON.stringify(r.dropped)}`);
});

test('R4. a correct claim is untouched and nothing is recorded', () => {
  const s = 'Price is above EMA9 and above VWAP, so trend holds.';
  assert.deepEqual(dropContradictingClauses(s, INPUTS), { text: s, dropped: [] });
  const s2 = 'Price is below SMA200, a headwind for longs.';
  assert.deepEqual(dropContradictingClauses(s2, INPUTS), { text: s2, dropped: [] });
});

test('R5. a both-wrong pair drops the whole sentence, its neighbours stay', () => {
  const r = dropContradictingClauses('Price below both EMA9 and VWAP.', INPUTS);
  assert.equal(r.text, ''); assert.ok(r.dropped.length >= 1);
  const two = dropContradictingClauses('Price below both EMA9 and VWAP. Funding is neutral across the board today.', INPUTS);
  assert.equal(two.text, 'Funding is neutral across the board today.');
});

test('R6. the 0.05% dead band: a claim on the wrong side is NOT judged inside it, and IS judged just outside it', () => {
  const above = 'Price is above EMA9 on this timeframe right now.'; const below = 'Price is below EMA9 on this timeframe right now.';
  // price 0.04% BELOW the EMA: "above" is strictly wrong, but too close to call
  const a = dropContradictingClauses(above, { close: 100, ema9: 100.04, sma200: null, vwapSide: null });
  assert.equal(a.text, above); assert.deepEqual(a.dropped, []);
  // price 0.04% ABOVE the EMA: "below" is strictly wrong, but too close to call
  const b = dropContradictingClauses(below, { close: 100.04, ema9: 100, sma200: null, vwapSide: null });
  assert.equal(b.text, below); assert.deepEqual(b.dropped, []);
  // price 0.1% below the EMA: outside the band, "above" is judged
  const c = dropContradictingClauses(above, { close: 100, ema9: 100.1, sma200: null, vwapSide: null });
  assert.ok(c.dropped.length >= 1, 'a claim 0.1% on the wrong side must be judged');
});

test('R7. nothing known, nothing changed', () => {
  const s = 'Price below both EMA9 and VWAP.';
  assert.deepEqual(dropContradictingClauses(s, { close: null, ema9: null, sma200: null, vwapSide: null }), { text: s, dropped: [] });
  assert.deepEqual(dropContradictingClauses('', INPUTS), { text: '', dropped: [] });
});

test('R8. applyResultChecks: every prose field is checked, the log line names the field, reasoning/chartAnalysis are never blanked, an emptied catalyst is removed', () => {
  const base = { signal: 'NEUTRAL', bias: 'NEUTRAL', confidence: 50, citations: [], counted: undefined, checks: [] as string[], patterns: [] as string[], levels: [] as Array<{ label: string; price: number }> };
  const result = { ...base, reasoning: 'Price below both EMA9 and VWAP.', chartAnalysis: '4 bearish signals including trending short ribbon and price below VWAP.', waitFor: 'Price below VWAP and then a close back under EMA9 on the 4h.', raidTrigger: 'Price below both EMA9 and VWAP.', catalysts: ['Price below both EMA9 and VWAP.', 'CPI prints at 12:30 UTC with a hot reading expected.'] };
  const out = applyResultChecks(result as never, PROMPT) as unknown as Record<string, unknown> & { checks: string[] };
  assert.equal(out.chartAnalysis, '4 bearish signals including trending short ribbon.', 'chartAnalysis is fixed');
  assert.equal(out.reasoning, 'Price below both EMA9 and VWAP.', 'a reasoning that would be emptied keeps its original text rather than showing nothing (the log records it)');
  assert.equal(out.raidTrigger, null, 'a raid trigger that is wrong in full becomes null');
  assert.deepEqual(out.catalysts, ['CPI prints at 12:30 UTC with a hot reading expected.'], 'the wrong catalyst is removed, the true one stays');
  for (const f of ['reasoning', 'chartAnalysis', 'raidTrigger', 'catalysts']) assert.ok(out.checks.some((c) => c.startsWith(`prose fixed or dropped (${f})`)), `no check line for ${f}: ${JSON.stringify(out.checks)}`);
});

test('R9. source pins: the route reads the inputs; the Ribbon chip mark follows agreement with the verdict', () => {
  assert.match(read('app/api/grok/route.ts'), /import \{ extractReadInputs \} from '@\/lib\/readSanity'/);
  const page = read('app/(main)/arena/page.tsx');
  assert.ok(page.includes("a: ribbonRel === 'agrees' ? '✓' : ribbonRel === 'opposes' ? '✗' : '•'"), 'the Ribbon chip mark is not agree / oppose / neutral');
  assert.ok(page.includes("emaSignal.signalDir === verdictDir ? 'agrees' : 'opposes'"));
});
