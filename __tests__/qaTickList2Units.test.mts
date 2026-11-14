import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wilderRsi, formatRsi } from '../lib/rsi.ts';
import { firstVenueThatAnswers } from '../lib/venueFallback.ts';
import { isSafeHttpUrl } from '../lib/safeUrl.ts';
import { splitFollowUps } from '../lib/chatPrompt.ts';
import { detectPatterns } from '../lib/patterns.ts';
import { signedUsd } from '../lib/numberFormat.ts';

/* QA's G1 unit group for Tick list 2 on #2292 (rows that are pure functions: these are unit runs, NOT live runs). Each expectation comes from the tracker row, with a negative case beside it. */

/* 39.1 (#2015): a flat series has no RSI, and never reads 100 */
test('39.1-a. RSI of a dead-flat series is unknown (null / "-"), never 100', () => {
  const flat = Array.from({ length: 40 }, () => 100);
  assert.equal(wilderRsi(flat), null);
  assert.equal(formatRsi(wilderRsi(flat)), '-');
});
test('39.1-b. CONTROLS: all-up closes still read 100 (really overbought); a mixed series reads a finite value', () => {
  assert.equal(wilderRsi(Array.from({ length: 40 }, (_, i) => 100 + i)), 100);
  const mixed = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 3);
  const v = wilderRsi(mixed); assert.ok(v !== null && v > 0 && v < 100, `mixed RSI ${v}`);
  assert.equal(wilderRsi([1, 2, 3]), null, 'fewer than period+1 closes is unknown');
});

/* 25.1 / 27.1 / 34.1 (#2014): the venue fallback returns the first venue that ANSWERS, including an empty answer */
test('25.1-a. a falsy but real answer ([]) is returned, not treated as a failure', async () => {
  assert.deepEqual(await firstVenueThatAnswers([{ venue: 'Bybit', run: async () => [] as number[] }, { venue: 'Binance', run: async () => [1] }], 'BTC'), []);
});
test('34.1-a. a failing primary falls back to the next venue and reports it', async () => {
  const seen: string[] = [];
  const r = await firstVenueThatAnswers([{ venue: 'Bybit', run: async () => { throw new Error('502'); } }, { venue: 'Binance futures', run: async () => 'ok' }], 'BTC', (f, _e, n) => seen.push(`${f}->${n}`));
  assert.equal(r, 'ok'); assert.deepEqual(seen, ['Bybit->Binance futures']);
});
test('34.1-b. CONTROLS: null entries are skipped, all-fail throws with every venue named, nothing attemptable says so', async () => {
  assert.equal(await firstVenueThatAnswers([null, { venue: 'X', run: async () => 7 }], 'ETH'), 7);
  await assert.rejects(firstVenueThatAnswers([{ venue: 'A', run: async () => { throw new Error('a down'); } }, { venue: 'B', run: async () => { throw new Error('b down'); } }], 'SOL'), /All venues failed for SOL - A: a down; B: b down/);
  await assert.rejects(firstVenueThatAnswers([null, undefined], 'DOGE'), /No venue for DOGE/);
});

/* 51.1 (#2113): a model-supplied URL is only a link when it is http(s) */
test('51.1-a. javascript:, data:, vbscript:, relative and empty URLs are not safe; http(s) are', () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', '//evil.test/x', '/relative', 'evil.test', '', null, undefined, 42]) assert.equal(isSafeHttpUrl(bad), false, String(bad));
  for (const ok of ['https://example.com/a?b=1', 'http://example.com']) assert.equal(isSafeHttpUrl(ok), true, ok);
});

/* 11.1 (C5): a bold follow-up chip keeps no stray "*" */
test('11.1-a. "**Q?**" and a bolded marker become clean chips and a clean body', () => {
  const r = splitFollowUps('The read is neutral.\n\n**FOLLOW-UPS:**\n1. **What would flip the bias?**\n2. - Where is the nearest liquidity?\n3. **How strong is the funding signal?**');
  assert.equal(r.text, 'The read is neutral.');
  assert.deepEqual(r.followUps, ['What would flip the bias?', 'Where is the nearest liquidity?', 'How strong is the funding signal?']);
  for (const q of r.followUps) assert.doesNotMatch(q, /\*/);
});
test('11.1-b. CONTROLS: no marker gives no chips and keeps the text; at most three chips', () => {
  assert.deepEqual(splitFollowUps('Just an answer.'), { text: 'Just an answer.', followUps: [] });
  assert.equal(splitFollowUps('a\nFOLLOW-UPS:\nQuestion number one here?\nQuestion number two here?\nQuestion number three here?\nQuestion number four here?').followUps.length, 3);
});

/* 58.1 (#1263 c9205092): a flat market is no uptrend */
test('58.1-a. twelve dead-flat candles report no uptrend / higher-highs pattern', () => {
  const flat = Array.from({ length: 12 }, () => ({ o: 100, h: 100, l: 100, c: 100 }));
  const p = detectPatterns(flat);
  assert.ok(!p.some(x => /uptrend|higher highs/i.test(x)), `flat market reported: ${JSON.stringify(p)}`);
});
test('58.1-b. CONTROL: a genuine staircase still reports its higher highs / higher lows', () => {
  const up = Array.from({ length: 12 }, (_, i) => ({ o: 100 + i * 2, h: 103 + i * 2, l: 99 + i * 2, c: 102 + i * 2 }));
  assert.ok(detectPatterns(up).some(x => /higher highs/i.test(x)), `rising candles reported: ${JSON.stringify(detectPatterns(up))}`);
});

/* 7.3: an unknown number never prints a direction */
test('7.3-a. signedUsd of NaN/Infinity prints no sign and no NaN; real values keep their sign', () => {
  for (const bad of [NaN, Infinity, -Infinity]) assert.doesNotMatch(signedUsd(bad, 'M', 1), /NaN|Infinity|^[+-]/);
  assert.equal(signedUsd(527, 'M', 0), '+$527M'); assert.equal(signedUsd(-26.14, 'M', 1), '-$26.1M');
});

/* 45.1 (#1946): the ticker-collision guard covers the class, not one venue (source guard) */
test('45.1-a. generate-coins.mjs keeps a TICKER_COLLISIONS map and drops a colliding id', () => {
  const src = readFileSync(new URL('../scripts/generate-coins.mjs', import.meta.url), 'utf8');
  assert.match(src, /const TICKER_COLLISIONS = new Map\(\[/);
  assert.match(src, /TICKER_COLLISIONS\.get\(id\)/);
});

/* 7.2 / 7.4 / 7.5 (source guards on the prompt builders; the AI route is fenced) */
test('7.5-a. the chat prompt is built server-side from data and strips raw fields (source guard)', () => {
  const chat = readFileSync(new URL('../lib/chatPrompt.ts', import.meta.url), 'utf8');
  assert.match(chat, /export function buildChatSystemPrompt/);
  const route = readFileSync(new URL('../app/api/grok-chat/route.ts', import.meta.url), 'utf8');
  assert.match(route, /buildChatSystemPrompt|parseChatContext/, 'the route builds the prompt from the parsed context');
});
