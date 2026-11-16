/* #2449: Bybit's fundingRate is per the contract's OWN funding interval (1, 4 or 8 hours) but every threshold (squeeze score, classifyFunding, the sidebar, the alert cron) is calibrated for 8 hours, so a 4-hour contract's rate
 * was read as half its real pressure (BONK -0.021% per 4 h = -0.042% per 8 h).
 *   F1-F3  fundingScaleTo8h, the REAL function SLICED from both files that carry it (MarketProvider, the Telegram alert route) and run: 8 -> 1, 4 -> 2, 1 -> 8, missing / invalid / zero / negative -> 1 (left as is); the two copies agree
 *   F4     both call sites multiply the parsed rate by the factor (the Bybit ticker fill and fetchAllFR); the interval field is read from the ticker
 *   F5     the scope that is NOT scaled stays as stated (the Binance premiumIndex fallback, the Funding page history): no factor is applied there, so nobody reads this PR as covering them
 * WHAT IT CANNOT PROVE: that the live ticker really carries fundingIntervalHour (the PR measured it on 2026-11-16; a changed exchange payload would only show in the funding health row).
 * The slices are OUR OWN checked-in source, never input. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

/* Cast rather than a named import: stripTypeScriptTypes is experimental and this repo's @types/node does not declare it (TS2305), though it exists at runtime (same pattern as libStrippable.test.mts). */
const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MP = read('components/MarketProvider.tsx'), AL = read('app/api/telegram/alert/route.ts');
function slice(src: string, where: string) {
  const a = src.indexOf('function fundingScaleTo8h('); assert.ok(a > 0, `CONTROL: fundingScaleTo8h not found in ${where}`);
  const fn = src.slice(a, src.indexOf('\n}\n', a) + 3);
  return new Function(`return (${stripTypeScriptTypes(fn).replace(/^function fundingScaleTo8h/, 'function')});`)() as (h: string | undefined) => number;
}
const scale = { MarketProvider: slice(MP, 'MarketProvider'), alert: slice(AL, 'the alert route') };

for (const [name, fn] of Object.entries(scale)) {
  test(`F1. ${name}: an 8 hour contract is unchanged, a 4 hour one is doubled, a 1 hour one is x8`, () => {
    assert.equal(fn('8'), 1); assert.equal(fn('4'), 2); assert.equal(fn('1'), 8); assert.equal(fn('2'), 4);
    assert.equal(-0.00021 * fn('4'), -0.00042, 'BONK: -0.021% per 4 h reads -0.042% per 8 h');
  });
  test(`F2. ${name}: a missing, empty, invalid, zero or negative interval is left as it is (factor 1), never NaN or Infinity`, () => {
    for (const v of [undefined, '', 'abc', '0', '-4', 'NaN', ' ']) assert.equal(fn(v as never), 1, `interval ${JSON.stringify(v)}`);
  });
}
test('F3. the two copies agree on every interval (the page and the alert cron must read the same funding)', () => {
  for (const v of [undefined, '', '1', '2', '4', '8', '12', 'x', '0', '-1']) assert.equal(scale.MarketProvider(v as never), scale.alert(v as never), `interval ${JSON.stringify(v)}`);
});
test('F4. both call sites multiply the rate by the factor and read the interval from the ticker', () => {
  assert.ok(MP.includes('parseFloat(item.fundingRate as string) * fundingScaleTo8h(item.fundingIntervalHour)'), 'the Bybit ticker fill no longer scales the funding rate');
  assert.ok(AL.includes('result[coin] = parseFloat(item.fundingRate) * fundingScaleTo8h(item.fundingIntervalHour);'), 'the alert cron (fetchAllFR) no longer scales the funding rate');
  assert.ok(AL.includes('interface BBTicker  { symbol: string; fundingRate: string; fundingIntervalHour?: string }'), 'the alert route no longer types the interval field');
});
test('F5. the paths the PR says it does NOT scale have no factor (so the scope statement stays true until someone changes it on purpose)', () => {
  assert.equal(/premiumIndex[^\n]*fundingScaleTo8h|fundingScaleTo8h[^\n]*premiumIndex/.test(MP + AL), false, 'the Binance premiumIndex path is scaled: update the PR text and the Funding page together');
  const fr = read('app/api/market/funding-rate/route.ts'); assert.equal(fr.includes('fundingScaleTo8h'), false, 'the funding-rate history endpoint is scaled: the Funding page would mix bases');
});
