import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAiUsage, estimateRowCostUsd, PLAIN_CALL_COST_USD, SEARCH_CALL_COST_USD, XAI_RATES_BY_MODEL } from '../lib/aiCost.ts';

/* #1399 part 1 (PR #1401): the parser behind every ledger row, and the /ops
 * estimate that now derives from the same rate table.
 *
 * THE LOAD-BEARING RULE: an unmeasured call is NOT a free call. When xAI sends
 * nothing usable, `costUsd` must be null with source 'unknown' - never 0. A zero
 * here would read as "this account costs nothing" in part 2's monthly ceiling
 * and in the owner's spend-by-tier number, which is the "unknown reads as fine"
 * shape this project keeps paying for. The two REAL payloads below are the ones
 * Dev captured against xAI on 2026-09-23 (token counts and ticks as reported;
 * no prompt text was kept). The fallback must reproduce xAI's own figure from
 * the rate table to the tick, or the table is wrong. */

const M = 'grok-4.3';

/* /v1/chat/completions, real response 2026-09-23: prompt 199 (192 cached),
   completion 1, reasoning 381, total 581, cost 10,021,500 ticks. */
const CHAT_USAGE = {
  prompt_tokens: 199, completion_tokens: 1, total_tokens: 581,
  prompt_tokens_details: { cached_tokens: 192 },
  completion_tokens_details: { reasoning_tokens: 381 },
  cost_in_usd_ticks: 10021500,
};
/* /v1/responses, real response 2026-09-23: input 199 (192 cached), output 117
   (116 reasoning), total 316, cost 3,396,500 ticks. */
const RESPONSES_USAGE = {
  input_tokens: 199, output_tokens: 117, total_tokens: 316,
  input_tokens_details: { cached_tokens: 192 },
  cost_in_usd_ticks: 3396500,
};

const close = (a: number | null, b: number, msg: string) => { assert.ok(a != null, msg + ' (was null)'); assert.ok(Math.abs(a - b) < 1e-12, `${msg}: ${a} != ${b}`); };

test('both real payloads: xAI priced the call itself, and the figure is the tick conversion', () => {
  const chat = parseAiUsage(M, CHAT_USAGE);
  assert.equal(chat.source, 'xai');
  close(chat.costUsd, 0.00100215, 'chat/completions cost');
  assert.equal(chat.promptTokens, 199);
  // Billed output is total - prompt (582 incl. reasoning), not the reported completion_tokens of 1.
  assert.equal(chat.completionTokens, 382, 'reasoning tokens are billed as output and must be counted');

  const resp = parseAiUsage(M, RESPONSES_USAGE);
  assert.equal(resp.source, 'xai');
  close(resp.costUsd, 0.00033965, '/v1/responses cost');
  assert.equal(resp.promptTokens, 199);
  assert.equal(resp.completionTokens, 117);
});

test('fallback: with the cost field stripped, the rate table reproduces xAI\'s own figure to the tick', () => {
  const { cost_in_usd_ticks: _c, ...chatNoCost } = CHAT_USAGE;
  const chat = parseAiUsage(M, chatNoCost);
  assert.equal(chat.source, 'estimated');
  close(chat.costUsd, 0.00100215, 'estimated chat cost must equal what xAI charged');

  const { cost_in_usd_ticks: _r, ...respNoCost } = RESPONSES_USAGE;
  const resp = parseAiUsage(M, respNoCost);
  assert.equal(resp.source, 'estimated');
  close(resp.costUsd, 0.00033965, 'estimated responses cost must equal what xAI charged');
});

test('CONTROL: the fallback can be wrong - pricing completion_tokens alone would miss the reasoning tokens', () => {
  // If the parser ever regresses to `completion_tokens` (1), the chat call prices at ~$0.000047, not $0.001002.
  const { cost_in_usd_ticks: _c, ...chatNoCost } = CHAT_USAGE;
  const r = parseAiUsage(M, chatNoCost);
  const wrong = (7 * 1.25 + 192 * 0.20 + 1 * 2.50) / 1e6;
  assert.ok(Math.abs((r.costUsd ?? 0) - wrong) > 1e-6, 'the estimate equals the WRONG (completion_tokens-only) price - reasoning tokens are being dropped');
});

test('cost_in_nano_usd is accepted as a second choice', () => {
  const r = parseAiUsage(M, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost_in_nano_usd: 2500 });
  assert.equal(r.source, 'xai');
  close(r.costUsd, 0.0000025, 'nano conversion');
});

test('ticks of 0 is a real $0 from xAI, not unknown', () => {
  const r = parseAiUsage(M, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_in_usd_ticks: 0 });
  assert.equal(r.source, 'xai');
  assert.equal(r.costUsd, 0);
});

test('UNKNOWN IS NULL, NEVER 0: no usage, garbage, non-numeric tokens, or an unpriced model', () => {
  for (const [label, usage] of [
    ['undefined', undefined], ['null', null], ['string', 'usage'], ['empty object', {}],
    ['non-numeric tokens', { prompt_tokens: '199', completion_tokens: '1' }],
    ['NaN tokens', { prompt_tokens: NaN, completion_tokens: 5 }],
  ] as const) {
    const r = parseAiUsage(M, usage);
    assert.equal(r.source, 'unknown', `${label}: source`);
    assert.equal(r.costUsd, null, `${label}: cost must be null, not ${r.costUsd}`);
  }
  // Tokens present but the model is not in the rate table and xAI sent no cost: a wrong number is worse than none.
  const { cost_in_usd_ticks: _c, ...noCost } = CHAT_USAGE;
  const r = parseAiUsage('grok-99-future', noCost);
  assert.equal(r.source, 'unknown');
  assert.equal(r.costUsd, null);
  assert.equal(r.promptTokens, 199, 'the token counts are still recorded even when the cost cannot be');
});

test('cached prompt tokens cannot exceed prompt tokens in the fallback', () => {
  const r = parseAiUsage(M, { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 50 } });
  assert.equal(r.source, 'estimated');
  close(r.costUsd, (0 * 1.25 + 10 * 0.20 + 2 * 2.50) / 1e6, 'cached clamped to prompt');
});

test('the /ops estimate derives from the one rate table: 1 quick = 0.004125, 1 deep = 0.009125', () => {
  const rate = XAI_RATES_BY_MODEL['grok-4.3'];
  assert.deepEqual(rate, { input: 1.25, cachedInput: 0.20, output: 2.50 });
  close(PLAIN_CALL_COST_USD, 0.004125, 'plain call');
  close(SEARCH_CALL_COST_USD, 0.009125, 'search call');
  close(estimateRowCostUsd({ quick_count: 1 }), 0.004125, 'one quick');
  close(estimateRowCostUsd({ deep_count: 1 }), 0.009125, 'one deep');
  close(estimateRowCostUsd({ quick_count: 2, chat_search_count: 1, onchain_count: 1 }), 2 * 0.004125 + 2 * 0.009125, 'mixed row');
  assert.equal(estimateRowCostUsd({}), 0, 'an empty day row costs nothing');
});
