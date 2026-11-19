/* #2417: /research states facts, not instructions or predictions (PM-approved wording, 2026-11-16).
 *   C1  the three volatility-regime hints are statements about volatility: no imperative (build / reduce / hedge), no prediction (likely, expect, will), no sizing advice
 *   C2  the Stablecoin tooltip and the third-line label carry no outlook wording (bullish, bearish, "fresh capital", watch), and the tooltip says the text below is an AI summary of figures
 *   C3  the dry-powder PROMPT asks only for the supply change: it forbids predictions / advice / bullish-bearish / "dry powder" framing / things to watch, and its three answer lines ask for the 30-day reason, the 30/90-day change and the two supply figures, with no "next 2-4 weeks" outlook and no "traders should watch"
 * The held label migration agreeing with these defaults is labelMigrationsHeld.test.mts (M1-M4). The model's actual answer is not tested here (no billed call). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const en = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
import { buildDryPowderPrompt } from '../lib/dryPowderAnalysis.ts';   // the prompt moved here from the route (#2628)
const OUTLOOK = /\b(bullish|bearish|likely|expect(ed|s)?|will\b|should|outlook|forecast|predict(s|ed|ion)?|fresh capital|build positions|reduce exposure|hedge|position sizing)\b/i;

test('C1. the volatility-regime hints are statements, not instructions or predictions', () => {
  for (const k of ['VOLATILITY_REGIME_HINT_LOW', 'VOLATILITY_REGIME_HINT_NEUTRAL', 'VOLATILITY_REGIME_HINT_HIGH']) {
    assert.ok((en[k] ?? '').length > 10, `CONTROL: ${k} has no text`);
    assert.doesNotMatch(en[k], OUTLOOK, `${k} reads as advice or a prediction: "${en[k]}"`);
    assert.match(en[k], /volatility/i, `${k} does not say what it describes`);
  }
});
test('C2. the Stablecoin tooltip and label are factual, and the tooltip says the text is an AI summary of the figures', () => {
  assert.doesNotMatch(en.DRY_POWDER_TOOLTIP, OUTLOOK, 'the tooltip still carries outlook wording: ' + en.DRY_POWDER_TOOLTIP);
  assert.match(en.DRY_POWDER_TOOLTIP, /30 and 90 days/); assert.match(en.DRY_POWDER_TOOLTIP, /AI summary/i);
  assert.equal(en.DRY_POWDER_WATCH_LABEL, 'Supply: ', 'the third line is not the supply line (it used to be "Watch: ")');
  assert.doesNotMatch(en.DRY_POWDER_WATCH_LABEL, /watch/i);
});
test('C3. the prompt forbids outlook and asks only for the supply change', () => {
  const prompt = buildDryPowderPrompt(200e9, 190e9, 180e9); assert.ok(prompt.length > 200, 'CONTROL: the prompt builder returned nothing');
  assert.match(prompt, /write a short factual summary/);
  assert.match(prompt, /No price predictions, no advice, no words like bullish or bearish, no "dry powder" framing, no things to watch\./);
  assert.match(prompt, /stating the 30-day change/); assert.match(prompt, /how total stablecoin supply changed over the last 30 and 90 days/); assert.match(prompt, /dollar figures only/);
  for (const old of ['next 2-4 weeks', 'traders should watch', '(bullish dry powder)', 'what this trend means for crypto prices']) assert.equal(prompt.includes(old), false, `the prompt still asks for: ${old}`);
});
