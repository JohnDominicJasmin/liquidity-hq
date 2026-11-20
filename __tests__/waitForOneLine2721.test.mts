/* QA: PR #2721, the Arena's WAIT_FOR line ("Confirms to ...") is ONE line of at most 15 words (#1185 box 22: it read 48 words; PM: wordy text).
 *
 * THE WRITTEN RULE (PR body + PM): the WAIT_FOR field of the combined AI read asks for ONE line, at most 15 words: the specific price level and the candle, volume or derivative condition that would move the signal to BEARISH or BULLISH, stated as a fact. It is required when the signal is
 * FLAT, LEAN BULLISH or LEAN BEARISH; N/A for BULLISH / BEARISH. The old four-part instruction (which signals you counted, the level, the candle pattern, the derivative condition, ~50 words) is gone, and so is its 50-word example.
 *   W1  the served prompt (the real buildCombinedPrompt) carries the WAIT_FOR template exactly once, with "ONE line, at most 15 words", the "stated as a fact" rule and the N/A clause for BULLISH / BEARISH
 *   W2  the template's own example is a single sentence of at most 15 words (counted here, not by the code) and names a price level and a condition
 *   W3  none of the old four-part instruction survives in any prompt builder (Combined, Quick, the plain builder): no "(1) which signals", no "(4) what derivative condition", no "Write exactly"
 *   W4  nothing else in the line moved: still REQUIRED for FLAT / LEAN BULLISH / LEAN BEARISH, the field name and the bracket shape the parser reads are unchanged
 *   W5  the parser still reads a WAIT_FOR of any length untouched (a model that ignores the cap is shown as it wrote, not truncated by the app)
 * WHAT THIS CANNOT PROVE: that the MODEL keeps to 15 words: the live reads on qa (6 Quick reads, counted separately). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildCombinedPrompt, buildQuickPrompt, parseCombinedRead } from '../lib/grok.ts';
import type { GrokContext, ChartData } from '../lib/grok.ts';

function ctx(overrides: Partial<GrokContext>): GrokContext {
  return new Proxy({ ...overrides } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : `<${String(k)}>`), has: () => true }) as unknown as GrokContext;
}
const CHART: ChartData = { tf: '1h', rsi: 50, recent20: 'flat', lastClose: 64_200, hi: 64_900, lo: 63_800, ema9: 64_100, sma200: 60_000 };
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const combined = buildCombinedPrompt(ctx({ coin: 'BTC/USDT' }), CHART);
const line = (p: string) => p.split('\n').find((l) => l.startsWith('WAIT_FOR:'));

test('W1. the served prompt carries the one-line, 15-word WAIT_FOR template exactly once', () => {
  assert.equal(combined.split('\nWAIT_FOR:').length - 1, 1, 'the WAIT_FOR template is not in the prompt exactly once');
  const l = line(combined)!; assert.ok(l, 'no WAIT_FOR line');
  assert.match(l, /ONE line, at most 15 words/); assert.match(l, /stated as a fact/); assert.match(l, /Write N\/A if SIGNAL is BULLISH or BEARISH/);
  assert.match(l, /the specific price level and the candle, volume or derivative condition/);
});

test('W2. the template example is one sentence of at most 15 words with a level and a condition', () => {
  const l = line(combined)!; const m = /Example \([^)]*\): "([^"]+)"/.exec(l); assert.ok(m, 'no quoted example in the WAIT_FOR template');
  const ex = m![1]; console.log(`[W2] example (${words(ex)} words): ${ex}`);
  assert.ok(words(ex) <= 15, `the example is ${words(ex)} words: it teaches the model the length the cap forbids`);
  assert.equal((ex.match(/[.!?](\s|$)/g) ?? []).length, 1, 'the example must be ONE sentence'); assert.match(ex, /\$\d/, 'the example names no price level');
  assert.match(ex, /\b(close|candle|volume|funding|taker|ratio)\b/i, 'the example names no candle / volume / derivative condition');
});

test('W3. none of the old four-part instruction survives in any prompt builder', () => {
  const OLD = [/\(1\) which signals you counted/, /\(2\) the specific price level to watch/, /\(3\) what candle\/volume pattern/, /\(4\) what derivative condition/, /Write exactly:/, /Bounce above \$65,500 with CVD flip/];
  for (const [name, p] of [['buildCombinedPrompt', combined], ['buildQuickPrompt', buildQuickPrompt(ctx({ coin: 'BTC/USDT' }), CHART)], ['buildPrompt', buildPrompt(ctx({ coin: 'BTC/USDT' }))]] as const)
    for (const re of OLD) assert.doesNotMatch(p, re, `${name} still carries the old instruction ${re}`);
});

test('W4. still required for FLAT / LEAN BULLISH / LEAN BEARISH, same field name and bracket shape', () => {
  const l = line(combined)!; assert.match(l, /^WAIT_FOR: \[REQUIRED when SIGNAL is FLAT, LEAN BULLISH, or LEAN BEARISH\./); assert.ok(l.endsWith(']'), 'the bracketed template must close');
});

test('W5. the parser reads a WAIT_FOR of any length untouched', () => {
  const long = 'Watch $64,200 for a breakdown candle with a volume spike, and taker sell above 65% plus L/S above 1.5 would confirm it, while a bounce above $65,500 with a CVD flip cancels the bearish bias entirely.';
  const answer = ['SIGNAL: FLAT', 'CONFIDENCE: 50', 'SIDES: EMA9 ABOVE | SMA200 ABOVE | VWAP BELOW', 'REASONING: r', `WAIT_FOR: ${long}`].join('\n');
  const p = parseCombinedRead(answer, '1h', 'NY')!; assert.equal(p.waitFor, long, 'a long WAIT_FOR was truncated or altered by the parser');
  assert.ok(words(long) > 15, 'control: the fixture must be longer than the cap');
});
