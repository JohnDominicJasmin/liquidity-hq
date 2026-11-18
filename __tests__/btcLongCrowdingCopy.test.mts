/* #2418: the /research "BTC Risk Level / LOW RISK" card becomes "BTC Long Crowding": the score blends Fear & Greed, BTC daily RSI and positive funding, so it describes how crowded longs are, not dump risk.
 *   B1  the title and the four bands say "crowding" and no longer say "risk"; the tooltip names the three inputs, says only positive funding adds to it, and says it is positioning, not a forecast
 *   B2  the component shows "n of 3 inputs" only when the score is built from fewer than three inputs (it is rescaled over what exists), with the count from the real signals list
 *   B3  the component still draws its band from the shipped band keys (no hard-coded "Risk" left in the component)
 * The migration agreeing with these defaults is labelMigrationsHeld.test.mts. The card rendering with a feed blocked ("2 of 3 inputs") is a browser cell. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const en = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
const comp = readFileSync(new URL('../components/BtcRiskLevel.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('B1. the title and bands say crowding, not risk; the tooltip names the three inputs and says it is not a forecast', () => {
  assert.equal(en.BTC_RISK_LEVEL_TITLE, 'BTC crowding');   /* #2521: the card blends sentiment and funding, so it no longer says Long */
  for (const k of ['BTC_RISK_LEVEL_LOW', 'BTC_RISK_LEVEL_MODERATE', 'BTC_RISK_LEVEL_HIGH', 'BTC_RISK_LEVEL_EXTREME']) { assert.match(en[k], /crowding/i, `${k} does not say crowding`); assert.doesNotMatch(en[k], /risk/i, `${k} still claims risk: "${en[k]}"`); }
  const tip = en.BTC_RISK_LEVEL_TOOLTIP;
  assert.match(tip, /Fear & Greed/); assert.match(tip, /daily RSI/); assert.match(tip, /funding/); assert.match(tip, /positive funding/); /* #2545 cut the tooltip to rule 22: it still names the three inputs (Fear & Greed, daily RSI, positive funding) */ assert.match(tip, /not a forecast/i);
  assert.doesNotMatch(tip, /dump|downside|pullback is more likely/i, 'the tooltip still claims something about a drop');
});
test('B2. "n of 3 inputs" appears only when fewer than three inputs built the score', () => {
  assert.equal(en.BTC_RISK_LEVEL_INPUTS_COUNT, '{n} of 3 inputs');
  assert.ok(comp.includes('{score != null && signals.length < 3 && ('), 'the count is not tied to a score built from fewer than three inputs');
  assert.ok(comp.includes("t('BTC_RISK_LEVEL_INPUTS_COUNT', { n: signals.length })"), 'the count is not the real number of inputs');
  assert.ok(comp.includes('data-testid="btc-crowding-inputs"'), 'the test id is gone');
});
test('B3. the component takes its band names from the keys, with no hard-coded risk wording', () => {
  for (const k of ['BTC_RISK_LEVEL_LOW', 'BTC_RISK_LEVEL_MODERATE', 'BTC_RISK_LEVEL_HIGH', 'BTC_RISK_LEVEL_EXTREME']) assert.ok(comp.includes(k), `${k} is not read by the component`);
  assert.equal(/Low Risk|High Risk|Extreme Risk/.test(comp), false, 'a hard-coded risk band name is in the component');
});
