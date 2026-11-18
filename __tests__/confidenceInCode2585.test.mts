/* QA's BEHAVIOURAL run of #2585 "AI: confidence computed in code" (#1651; owner sweep 2026-11-18: perps-vs-spot -20 / +10, Pre-NY / Asia -10, ribbon FREEZE -15, WaveTrend confirming +5, tier bands LEAN 55-75). Expected numbers are literals from that text, not output of the code under test.
 * The REAL buildArenaPrompt (Quick and Deep) feeds the REAL applyResultChecks, exactly as app/api/grok/route.ts does. No billed call.
 *   K1  no adjusting line: confidence untouched, no "adjusted in code" entry (control)
 *   K2  futures-led -20, spot-led +10, "could not be measured" 0, a normal ratio 0
 *   K3  Pre-NY -10, Asia Session -10, NY / London 0
 *   K4  ribbon FREEZE -15 (a verdict that merely contains the word elsewhere is 0), WaveTrend CONFIRMING +5, NOT CONFIRMING / N/A 0
 *   K5  stacked: the sum, floored at 0 and capped at 100, whole numbers, never NaN
 *   K6  Quick and Deep prompts give the same delta
 *   K7  the model's own number is parsed strictly: 90 and 100 read; missing, NaN, text, 101, a negative number are refused (route 502 + refund), 90.7 reads as 90
 *   K8  the prompt no longer asks for the arithmetic ("subtract 20", "add 10", "subtract 10", "subtract 15", "+5 confidence")
 *   K9  THE CAP: a LEAN tier is 55-75% in the prompt's own band table; after the code adjustment a LEAN must still be <= 75 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyResultChecks, buildArenaPrompt, parseCombinedRead, adjustConfidence, type GrokContext, type ChartData, type CombinedResult } from '../lib/grok.ts';

const ctx = (o: Partial<GrokContext>): GrokContext => new Proxy({ ...o } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : `<${String(k)}>`), has: () => true }) as unknown as GrokContext;
const CHART: ChartData = { tf: '4h', ema9: 61000, sma200: 58000, rsi: 55, recent20: 'flat', hi: 62000, lo: 59000, lastClose: 61500 } as ChartData;
const NORMAL_PERP = 'Futures and spot are trading in their usual proportions for this coin. Nothing unusual about who is driving the move.';
const FUT = 'Futures trading is 8.0x its usual share against spot.';
const SPOT = 'Futures trading is unusually quiet at 0.3x its usual share. More of this move is people actually buying the coin.';
const RIBBON = (v: string) => `[4H ribbon + 1D SMA200 filter] ${v} · phase · conditions`;
const BASE = { perpSpot: NORMAL_PERP, session: 'NY', emaStrategy: RIBBON('LONG_SETUP'), waveTrend: 'NOT CONFIRMING - no divergence' };
const prompts = (o: Partial<GrokContext>) => ({ quick: buildArenaPrompt(ctx({ ...BASE, ...o }), CHART, 'quick'), deep: buildArenaPrompt(ctx({ ...BASE, ...o }), CHART, 'deep') });
const result = (signal: CombinedResult['signal'], confidence: number, counted: { bullish: number; bearish: number } | null = null): CombinedResult => ({ ...parseCombinedRead(`SIGNAL: FLAT\nCONFIDENCE: 50\nREASONING: r.`, '4h', 'NY')!, signal, confidence, counted, checks: [] });
const run = (p: string, signal: CombinedResult['signal'], confidence: number, counted: { bullish: number; bearish: number } | null = null) => applyResultChecks(result(signal, confidence, counted), p);

test('K1. nothing to adjust: the confidence is untouched and no entry is logged', () => {
  for (const p of Object.values(prompts({}))) { const r = run(p, 'FLAT', 70); assert.equal(r.confidence, 70); assert.ok(!r.checks?.some((c) => /adjusted in code/.test(c))); assert.equal(adjustConfidence(p).delta, 0); }
});
test('K2. perps vs spot: futures-led -20, spot-led +10, unmeasured 0, normal 0', () => {
  for (const [perpSpot, want] of [[FUT, 50], [SPOT, 80], ['Perps vs spot could not be measured for this coin.', 70], [NORMAL_PERP, 70]] as const)
    for (const [kind, p] of Object.entries(prompts({ perpSpot }))) assert.equal(run(p, 'FLAT', 70).confidence, want, `${kind} ${perpSpot.slice(0, 30)}`);
});
test('K3. session: Pre-NY and Asia Session -10; NY and London 0', () => {
  for (const [session, want] of [['Pre-NY', 60], ['Asia Session', 60], ['NY', 70], ['London', 70]] as const) assert.equal(run(prompts({ session }).quick, 'FLAT', 70).confidence, want, session);
});
test('K4. ribbon FREEZE -15 and WaveTrend CONFIRMING +5; NOT CONFIRMING and N/A are 0', () => {
  assert.equal(run(prompts({ emaStrategy: RIBBON('FREEZE') }).quick, 'FLAT', 70).confidence, 55);
  assert.equal(run(prompts({ emaStrategy: RIBBON('LONG_SETUP') }).quick, 'FLAT', 70).confidence, 70);
  for (const [waveTrend, want] of [['CONFIRMING - bullish cross', 75], ['NOT CONFIRMING - none', 70], ['N/A - not enough bars', 70], ['-', 70]] as const) assert.equal(run(prompts({ waveTrend }).quick, 'FLAT', 70).confidence, want, waveTrend);
});
test('K5. stacked adjustments: summed, floored at 0, capped at 100, whole numbers, never NaN', () => {
  const all = prompts({ perpSpot: FUT, session: 'Asia Session', emaStrategy: RIBBON('FREEZE') }).quick; // -20 -10 -15
  assert.equal(run(all, 'FLAT', 80).confidence, 35); assert.equal(run(all, 'FLAT', 30).confidence, 0, 'went below 0');
  const up = prompts({ perpSpot: SPOT, waveTrend: 'CONFIRMING - x' }).quick; // +10 +5
  assert.equal(run(up, 'FLAT', 95).confidence, 100, 'went above 100'); assert.equal(run(up, 'FLAT', 82).confidence, 97);
  for (const c of [0, 1, 55, 100]) { const v = run(all, 'FLAT', c).confidence; assert.ok(Number.isInteger(v) && v >= 0 && v <= 100); }
});
test('K6. Quick and Deep prompts give the same delta', () => {
  const { quick, deep } = prompts({ perpSpot: FUT, session: 'Pre-NY', emaStrategy: RIBBON('FREEZE'), waveTrend: 'CONFIRMING - x' });
  assert.deepEqual(adjustConfidence(quick), adjustConfidence(deep)); assert.equal(adjustConfidence(quick).delta, -20 - 10 - 15 + 5);
});
test('K7. the model\'s own number is read strictly', () => {
  const read = (c: string) => parseCombinedRead(`SIGNAL: FLAT\n${c}\nREASONING: r.`, '4h', 'NY');
  assert.equal(read('CONFIDENCE: 90')?.confidence, 90); assert.equal(read('CONFIDENCE: 100')?.confidence, 100); assert.equal(read('CONFIDENCE: 90.7')?.confidence, 90);
  for (const bad of ['', 'CONFIDENCE: NaN', 'CONFIDENCE: high', 'CONFIDENCE: 101', 'CONFIDENCE: -5', 'CONFIDENCE: ']) assert.equal(read(bad), null, `${JSON.stringify(bad)} was read as a verdict`);
});
test('K8. the prompt no longer asks the model for the arithmetic', () => {
  for (const [kind, p] of Object.entries(prompts({}))) {
    for (const old of [/subtract 20/i, /add 10/i, /subtract 10/i, /subtract 15/i, /\+5 confidence/i, /add \+5/i]) assert.doesNotMatch(p, old, `${kind}: ${old}`);
    assert.match(p, /the app applies the perps-vs-spot, session, WaveTrend and FREEZE adjustments/);
  }
});
test('K9. THE CAP: a LEAN is 55-75% in the prompt\'s own band table, and stays <= 75 after the code adjustment', () => {
  const { quick } = prompts({ perpSpot: SPOT, waveTrend: 'CONFIRMING - x' }); // +15
  assert.match(quick, /LEAN BEARISH \/ LEAN BULLISH: 55.75% confidence/);
  const r = run(quick, 'LEAN BULLISH', 70, { bullish: 3, bearish: 1 });
  assert.ok(r.confidence <= 75, `LEAN BULLISH shown at ${r.confidence}% after the adjustment; the band is 55-75`);
});
