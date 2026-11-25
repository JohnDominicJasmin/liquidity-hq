/* QA: PR #2814 (#1651 owner item 26), the AI is told one rule in one unit: a side is crowded above 1.8:1 long/short (longs) or below 0.55:1 (shorts). The REAL formatter, chat prompt and read prompt run; nothing is sent to a model.
 *   K1 the edges: 1.8 and 0.55 are balanced, just past them is crowded; no ratio means no note
 *   K2 the Arena field and the chat line carry the same ratio and words, and 60/40 (1.5:1) now reads balanced
 *   K3 no other crowding threshold is left in the prompt text */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crowdedSide, ratioNote } from '../lib/crowding.ts';
import { arenaNumberFields, arenaPriceUnit } from '../lib/arenaContextFields.ts';
import { buildChatSystemPrompt, type ChatContext } from '../lib/chatPrompt.ts';
import type { CoinData } from '../lib/marketStore.ts';

test('K1. the edges of the rule', () => {
  assert.equal(crowdedSide(1.8, 1), null); assert.equal(crowdedSide(1.81, 1), 'longs');
  assert.equal(crowdedSide(0.55, 1), null); assert.equal(crowdedSide(0.54, 1), 'shorts');
  assert.equal(crowdedSide(0.5, 0.5), null);
  assert.equal(ratioNote(0.5, 0.5), ' (L/S 1.00:1) (balanced)'); assert.equal(ratioNote(0.7, 0.3), ' (L/S 2.33:1) (overleveraged longs)'); assert.equal(ratioNote(0.3, 0.7), ' (L/S 0.43:1) (overleveraged shorts)');
  for (const [l, s] of [[0.5, 0], [NaN, 0.5], [0.5, NaN], [-0.1, 0.5]]) { assert.equal(ratioNote(l, s), '', `${l}/${s}`); assert.equal(crowdedSide(l, s), null); }
});

test('K2. the Arena field and the chat line say the same thing', () => {
  for (const [long, short, words] of [[0.6, 0.4, ' (L/S 1.50:1) (balanced)'], [0.62, 0.38, ' (L/S 1.63:1) (balanced)'], [0.66, 0.34, ' (L/S 1.94:1) (overleveraged longs)'], [0.34, 0.66, ' (L/S 0.52:1) (overleveraged shorts)']] as const) {
    const arena = arenaNumberFields({ price: 100, bnLongRatio: long, bnShortRatio: short } as Partial<CoinData>, arenaPriceUnit('btc')).longShortRatio;
    assert.ok(arena.endsWith(words), `Arena ${long}: "${arena}"`);
    const chat = buildChatSystemPrompt({ coin: 'btc', longRatio: long, shortRatio: short, ratioVenue: 'Binance' } as ChatContext, { search: false });
    const line = chat.split('\n').find((l) => l.includes('Long/Short %')) ?? '';
    assert.ok(line.includes(words), `chat ${long}: "${line}"`);
  }
});

test('K3. one pair of thresholds in the prompt', () => {
  const s = readFileSync(new URL('../lib/grok.ts', import.meta.url), 'utf8');
  const crowd = s.split('\n').filter((l) => /Long\/Short ratio/.test(l) && /crowded/.test(l));
  assert.ok(crowd.length >= 4, `CONTROL: ${crowd.length} crowding lines found`);
  for (const l of crowd) assert.ok(/> 1\.8:1/.test(l) || /< 0\.55:1/.test(l), l.trim());
  assert.equal(/(0\.8|0\.6|0\.5):1[^\n]*crowded/.test(s), false);
});
