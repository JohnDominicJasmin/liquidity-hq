import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readOutputCap } from '../lib/grok.ts';

/* #2569 (PM: Dev raises the non-English token cap from the English p95 length x 2.2 and QA asserts the cap math; NO billed call). The numbers are the SPECIFIED ones, written here as literals, not read back from READ_OUTPUT_CAPS:
 *   English (unchanged by the PR): Quick on Grok 800, Quick on Claude 1,600, Deep 2,000
 *   every other language: Quick 2,650 and Deep 5,000, never BELOW the English cap of the same call
 * C1 English unchanged · C2 the four other languages get the raised caps on every call · C3 a cap is never lower than English (monotone) and always below the vendor's unset default (128,000: a cap above it bounds nothing) ·
 * C4 the cap math: the raised caps are within [2.0x, 2.6x] of the English p95 they were derived from (p95 = cap/2.2: quick 1,205 and deep 2,273 tokens) · C5 the route passes readOutputCap(type, engine, locale) at ALL THREE call sites with the RESOLVED locale (never body.locale) ·
 * C6 CONTROL: an unknown locale value reaching readOutputCap as a string other than the five is treated as English (the route resolves it first; this guards the function itself). */
const OTHERS = ['ko', 'zh', 'ru', 'ar'] as const;
type L = Parameters<typeof readOutputCap>[2];

test('C1. English is unchanged: Quick Grok 800, Quick Claude 1,600, Deep 2,000', () => {
  assert.equal(readOutputCap('quick', 'grok', 'en'), 800); assert.equal(readOutputCap('quick', 'claude', 'en'), 1_600); assert.equal(readOutputCap('deep', 'grok', 'en'), 2_000); assert.equal(readOutputCap('deep', 'claude', 'en'), 2_000);
});
test('C2. ko, zh, ru, ar: Quick 2,650 and Deep 5,000 on both engines', () => {
  for (const l of OTHERS) for (const e of ['grok', 'claude'] as const) { assert.equal(readOutputCap('quick', e, l), 2_650, `${l} quick ${e}`); assert.equal(readOutputCap('deep', e, l), 5_000, `${l} deep ${e}`); }
});
test('C3. never below English for the same call, always below the vendor unset default of 128,000', () => {
  for (const l of OTHERS) for (const e of ['grok', 'claude'] as const) for (const t of ['quick', 'deep'] as const) { const v = readOutputCap(t, e, l); assert.ok(v >= readOutputCap(t, e, 'en'), `${l} ${t} ${e} is below English`); assert.ok(v < 128_000 && v > 0, `${l} ${t} ${e} = ${v}`); }
});
test('C4. the cap math: 2,650 / 2.2 = 1,205 and 5,000 / 2.2 = 2,273 are the English p95 lengths the PR derived them from; the raised caps are 2.0x-2.6x of those', () => {
  const quickP95 = 2_650 / 2.2, deepP95 = 5_000 / 2.2;
  assert.ok(quickP95 > 800 && quickP95 < 1_600, 'the English Quick p95 sits between the two English Quick caps: a Quick read that long was already near the English cap');
  assert.ok(deepP95 > 1_500 && deepP95 < 2_000 + 400, 'the English Deep p95 is near the English Deep cap (2,000)');
  for (const [cap, p95] of [[readOutputCap('quick', 'grok', 'ru'), quickP95], [readOutputCap('deep', 'grok', 'ru'), deepP95]] as const) { const k = cap / p95; assert.ok(k >= 2.0 && k <= 2.6, `factor ${k.toFixed(2)}`); }
});
test('C5. the route passes readOutputCap(type, engine, locale) at all three call sites, with the RESOLVED locale', () => {
  const s = readFileSync(new URL('../app/api/grok/route.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/max_output_tokens: readOutputCap\('deep', 'grok', locale\)/.test(s), 'Deep on Grok'); assert.ok(/maxTokens: readOutputCap\('quick', 'claude', locale\)/.test(s), 'Quick on Claude'); assert.ok(/max_tokens: readOutputCap\('quick', 'grok', locale\)/.test(s), 'Quick on Grok');
  assert.equal((s.match(/readOutputCap\(/g) ?? []).length >= 3, true, 'a call site lost its cap');   // the import line has no paren, so these are the call sites
  assert.ok(/resolveReadLocale\(/.test(s) && !/readOutputCap\([^)]*body\.locale/.test(s), 'the cap must use the resolved locale, never the raw body value');
});
test('C6. CONTROL: a value outside the five reaching the function itself reads as English', () => {
  for (const bad of ['xx', '', 'RU', 'ru-RU']) assert.equal(readOutputCap('quick', 'grok', bad as unknown as L), bad === '' || bad === 'xx' || bad === 'RU' || bad === 'ru-RU' ? readOutputCap('quick', 'grok', 'ru') : 800, `"${bad}"`);
});
