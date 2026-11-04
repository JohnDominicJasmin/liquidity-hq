/* #1910 item 7: the three fallbacks that stand between an empty context field and a false statement
 * in the prompt.
 *
 * THE SPEC FOR THIS ITEM IS WRONG AND THE SOURCE IS RIGHT. #1910 asks for: *"`liqLevels: ''` -> the
 * prompt contains `Not available`; same for `news` and `orderWalls`."* The three fallbacks are three
 * DIFFERENT strings:
 *
 *   liqLevels    -> 'Not available'                                                  (lib/grok.ts:497)
 *   news         -> 'News feed unavailable (not loaded) - do not assume there is no news'  (:508)
 *   orderWalls   -> '-'                                                              (:429)
 *
 * Written from the spec, the `news` and `orderWalls` cells would have failed while the product was
 * correct - and the tempting repair is to loosen the assertion until it passes, which is how an
 * expectation older than the page survives as a test. Each string below is read off the module that
 * produces it, and each is pinned as itself.
 *
 * WHY THEY ARE DIFFERENT IS ALSO IN THE SOURCE, and it is the reason they should not be unified:
 * each fallback is the wording the Arena page itself already sends for that field, so the prompt
 * adds no vocabulary the model has not seen from the honest path. `-` is what
 * `app/(main)/arena/page.tsx:1051` sends for absent walls; the news wording is that page's own
 * unloaded-feed expression verbatim, which `aiFeedsUnknownNotEmpty.test.mts` U3 already reads.
 *
 * A FOURTH EXISTS AND IS NOT IN THE SPEC: `ctx.upcomingEvents || 'No events in window'` (:502). It
 * is pinned here too rather than left out, because the three named ones were a sample and the next
 * reader should not infer the list is closed.
 *
 * ANCHORED TO SECTIONS, NOT SEARCHED FOR. `'-'` appears all over a formatted prompt, so asserting
 * "the prompt contains '-'" would pass on any prompt at all. Each cell finds its own section header
 * and reads the line under it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./qa/alias-hooks.mjs', pathToFileURL('./'));

const { buildArenaPrompt } = await import('../lib/grok.ts');

/** A context with every field non-empty, so a cell that empties ONE field changes one thing. */
const ctx = (over: Record<string, unknown> = {}) => ({
  coin: 'BTC', price: '$100', change24h: '+1.00%', ma20: '$99', priceVsMA: 'ABOVE MA20 (+1.01% - bullish)',
  volRatio: '1.10x (normal)', rsi14: '55.0 (Neutral)', rsi1h: '55 (Neutral)', rsi4h: '50 (Neutral)',
  rsiDaily: '60 (Neutral)', longShortRatio: 'Long 55.0% / Short 45.0% (balanced)',
  vwap: '$99 - price ABOVE VWAP (bullish, paying up)', takerRatio: 'Buy 50% / Sell 50% - balanced flow',
  pocLine: '$99 | VAH $101 | VAL $97 - price ABOVE POC (bullish)',
  orderWalls: 'BID WALL 98 (120 BTC)', liqLevels: 'LONG CLUSTER 97.5 ($2.1M)',
  news: '12:00 UTC (2h) Reuters - something happened', upcomingEvents: 'FOMC in 12h',
  oilPrice: '$70', ...over,
} as unknown as Parameters<typeof buildArenaPrompt>[0]);

const chart = {} as Parameters<typeof buildArenaPrompt>[1];

const promptFor = (over: Record<string, unknown> = {}) => buildArenaPrompt(ctx(over), chart, 'deep', []);

/** The line `offset` lines under the section header matching `re`.
 *
 * `offset` IS PER SECTION AND EXPLICIT, because assuming 1 everywhere was wrong. MACRO EVENTS puts
 * a `(CRITICAL: ...)` instruction between its header and its value (`lib/grok.ts:500`), so offset 1
 * read that note instead of the field - both of its cells went red while the product was correct.
 * A forgiving helper that scanned forward for "the first interesting line" would have hidden the
 * mistake and would also pass if a field stopped being inserted at all, which is precisely what the
 * CONTROL cells exist to catch. */
const underHeader = (prompt: string, re: RegExp, offset: number): string => {
  const lines = prompt.split('\n');
  const i = lines.findIndex((l) => re.test(l));
  assert.notEqual(i, -1, `no section header matching ${re} in the prompt - the section was renamed and this cell is anchored to a header that no longer exists, so it would otherwise pass by not looking`);
  return lines[i + offset] ?? '';
};

const CASES = [
  {
    field: 'orderWalls',
    header: /^=== ORDER BOOK LIQUIDITY ===/, offset: 1,
    fallback: '-',
    real: 'BID WALL 98 (120 BTC)',
    why: 'an empty section under this header reads as "there is no order book liquidity" - unknown drawn as zero',
  },
  {
    field: 'liqLevels',
    header: /^=== REALIZED LIQUIDATION CLUSTERS/, offset: 1,
    fallback: 'Not available',
    real: 'LONG CLUSTER 97.5 ($2.1M)',
    why: 'this section is about liquidations that ALREADY happened, so an empty body reads as a confirmed quiet 24h',
  },
  {
    field: 'upcomingEvents',
    header: /^=== MACRO EVENTS - RELEASED/, offset: 2,
    fallback: 'No events in window',
    real: 'FOMC in 12h',
    why: 'not named in the spec; pinned so the next reader does not read the three as a closed list',
  },
  {
    field: 'news',
    header: /^=== LIVE NEWS FEED/, offset: 1,
    fallback: 'News feed unavailable (not loaded) - do not assume there is no news',
    real: '12:00 UTC (2h) Reuters - something happened',
    why: "the page's own unloaded-feed wording, verbatim - an empty string here bypasses aiFeedsUnknownNotEmpty U3 entirely",
  },
] as const;

for (const c of CASES) {
  test(`7. ${c.field}: empty falls back to its OWN wording, under its own header`, () => {
    const line = underHeader(promptFor({ [c.field]: '' }), c.header, c.offset);
    assert.equal(line, c.fallback,
      `${c.field} empty should put ${JSON.stringify(c.fallback)} under ${c.header} - ${c.why}. Got ${JSON.stringify(line)}`);
  });

  test(`7. CONTROL: ${c.field} non-empty passes through untouched`, () => {
    /* Without this, the cell above passes if the field is IGNORED rather than defaulted - the
       section would carry the fallback whatever was sent, and nothing would say so. */
    const line = underHeader(promptFor(), c.header, c.offset);
    assert.equal(line, c.real,
      `a real ${c.field} value did not reach the prompt - the cell above would then be passing because this field is dropped, not because the fallback works`);
    assert.notEqual(line, c.fallback, `a real ${c.field} value rendered as its own fallback`);
  });
}

test('7. CONTROL: the four fallbacks are four DIFFERENT strings, so no cell can pass on another\'s wording', () => {
  /* #1910 asked for "Not available" for all three. If they were ever unified, every cell above
     would still pass while the prompt lost the per-field wording each section's comment argues for
     - so the distinctness is the thing to pin, not an implementation detail. */
  const seen = CASES.map((c) => c.fallback);
  assert.equal(new Set(seen).size, seen.length,
    `two fallbacks are the same string (${seen.join(' | ')}), so a cell above could pass on the wrong field's wording`);

  /* And the empty-field prompts must differ from each other, which is the behavioural form of the
     same claim rather than a statement about this file's own table. */
  const prompts = CASES.map((c) => promptFor({ [c.field]: '' }));
  assert.equal(new Set(prompts).size, prompts.length,
    'emptying different fields produced identical prompts - the fallbacks are not per-field any more');
});
