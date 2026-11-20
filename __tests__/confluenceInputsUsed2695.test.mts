import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeRealYield } from '../lib/realYield.ts';
import { computeMacroRisk } from '../lib/confluence.ts';

/* #2695 (PM ruling C, 2026-11-20, after QA's note that the #340 disclosure conflicts with the zero-failure-text rule): the Confluence Score SAYS WHAT WAS USED instead of what failed. Written rule (PM + PR body): a perps reading that cannot be measured prints "Score uses {n} inputs for this coin, without perps vs spot." where n is the number of factors the score really used (the #340 owner rule that an unmeasured input is DISCLOSED stays); the macro-risk notes say what the macro risk EXCLUDES ("Macro risk excludes the event calendar, which is out of date." / "Macro risk excludes the 10Y real yield[, last updated N days ago]."); no failure wording (unavailable, cannot, could not, failed) in any of them; fresh readings and the AI prompt sentences are unchanged.
 *   C1 the perps line on a truth table (cut from components/ConfluenceScore.tsx)   C2 the real-yield notes (real function)   C3 the macro-risk reasons (real function)   C4 the label: registered, English in the defaults, the held migration equal for PROD/DEV in en/ko/zh/ru/ar
 * NOT covered (browser cells after deploy): the line on the real Arena page (perps-unknown-disclosure.spec.ts is re-anchored to the new sentence). */
const rd = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const FAILURE = /unavailable|cannot|could not|can not|failed|unable/i;

test('C1. the perps line: the explanation for perp/spot/normal, "Score uses n inputs…" for unknown with n = the factors used, nothing without a reading', () => {
  const src = rd('components/ConfluenceScore.tsx').replace(/\/\/[^\n]*/g, ''); const m = /const perpLine =\s*(perpSpot\?\.lean === 'perp'[\s\S]*?: perpSpot\?\.explanation \?\? null);/.exec(src); assert.ok(m, 'CONTROL: the perpLine expression was not found');
  const line = (perpSpot: { lean: string; explanation?: string } | null, factors: unknown[]) => new Function('perpSpot', 'factors', 't', `return (${m![1]});`)(perpSpot, factors, (k: string, v?: Record<string, unknown>) => (v ? `${k}|${JSON.stringify(v)}` : k));
  const f = (n: number) => Array.from({ length: n }, () => ({}));
  assert.equal(line({ lean: 'perp', explanation: 'Futures are leading.' }, f(5)), 'Futures are leading.'); assert.equal(line({ lean: 'spot', explanation: 'Spot is leading.' }, f(5)), 'Spot is leading.'); assert.equal(line({ lean: 'normal', explanation: 'A normal day.' }, f(5)), 'A normal day.');
  for (const n of [3, 4, 5, 6]) assert.equal(line({ lean: 'unknown', explanation: 'OLD FAILURE SENTENCE' }, f(n)), `CONFLUENCE_PERP_SPOT_NOT_USED|{"n":${n}}`, `unknown with ${n} factors`);
  assert.equal(line(null, f(5)), null, 'no reading yet: no line'); assert.equal(line({ lean: 'normal' }, f(5)), null, 'a reading with no explanation: no line');
  assert.equal(/could not be measured|does not account/i.test(rd('components/ConfluenceScore.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')), false, 'the old sentence is rendered again');
});
test('C2. the real-yield notes say what the macro risk excludes, with the age when it is old; fresh notes unchanged; no failure words', () => {
  const DAY = 86_400_000, NOW = Date.UTC(2026, 7, 12, 12, 0, 0);
  const none = computeRealYield([], NOW); assert.equal(none.note, 'Macro risk excludes the 10Y real yield.'); assert.equal(none.signal, 'unknown'); assert.equal(computeRealYield([[NOW - DAY, 1.8]], NOW).note, 'Macro risk excludes the 10Y real yield.', 'one observation is no reading');
  for (const [age, days] of [[6.2 * DAY, 6], [9 * DAY, 9], [5.01 * DAY, 5]] as const) { const r = computeRealYield([[NOW - age - DAY, 1.8], [NOW - age, 1.85]], NOW); assert.equal(r.stale, true); assert.equal(r.note, `Macro risk excludes the 10Y real yield, last updated ${days} days ago.`, `age ${age / DAY} days`); assert.equal(FAILURE.test(r.note), false, 'failure wording in a stale note'); }
  const up = computeRealYield([[NOW - 2 * DAY, 1.8], [NOW - DAY, 1.92]], NOW); assert.match(up.note, /^10Y real yield 1\.92% \(\+12bp\) - tighter conditions, headwind for risk$/, 'a fresh reading is unchanged'); assert.equal(up.stale, false);
  assert.match(computeRealYield([[NOW - 2 * DAY, 1.9], [NOW - DAY, 1.78]], NOW).note, /easier conditions, tailwind for risk$/); assert.match(computeRealYield([[NOW - 2 * DAY, 1.8], [NOW - DAY, 1.81]], NOW).note, /no meaningful move$/);
});
test('C3. the macro-risk reasons: the stale calendar and the stale yield say what is excluded, neither hides the other, no failure words', () => {
  const NOW = Date.UTC(2026, 7, 12, 12, 0, 0); const real = { value: null, changeBp: null, asOf: null, stale: true, signal: 'unknown', note: 'Macro risk excludes the 10Y real yield.' } as never;
  const r = computeMacroRisk([], null, NOW, true, real); assert.ok(r.reasons.includes('Macro risk excludes the event calendar, which is out of date.'), `reasons: ${JSON.stringify(r.reasons)}`); assert.ok(r.reasons.includes('Macro risk excludes the 10Y real yield.'), 'the yield note is carried'); for (const x of r.reasons) assert.equal(FAILURE.test(x), false, `failure wording in "${x}"`);
  const fresh = computeMacroRisk([], null, NOW, false, undefined); assert.equal(fresh.reasons.some((x) => /event calendar/i.test(x)), false, 'a fresh calendar says nothing about the calendar');
});
test('C4. the label: registered, English in the defaults, the held migration equal for PROD and DEV in five locales', () => {
  const defaults = JSON.parse(rd('lib/labelDefaults.en.json')) as Record<string, string>, keys = rd('lib/labelKeys.ts'), sql = rd('supabase/migrations/20261127a_labels_confluence_inputs_used.sql'); const k = 'CONFLUENCE_PERP_SPOT_NOT_USED';
  assert.equal(defaults[k], 'Score uses {n} inputs for this coin, without perps vs spot.'); assert.ok(keys.includes(`'${k}'`), `${k} not registered`); assert.equal(FAILURE.test(defaults[k]), false);
  const prod = sql.slice(sql.indexOf('===== PROD ====='), sql.indexOf('===== DEV =====')), dev = sql.slice(sql.indexOf('===== DEV ====='));
  for (const [name, block, table] of [['PROD', prod, 'lhq_labels'], ['DEV', dev, 'lhq_dev_labels']] as const) { assert.ok(block.includes(`insert into ${table} (key, locale, value) values`), `${name}: wrong table`); for (const loc of ['en', 'ko', 'zh', 'ru', 'ar']) { assert.ok(new RegExp(`\\('${k}','${loc}','[^']+'\\)`).test(block), `${name}: no ${loc} row`); const row = new RegExp(`\\('${k}','${loc}','([^']+)'\\)`).exec(block)![1]; assert.ok(row.includes('{n}'), `${name}/${loc}: the {n} placeholder is missing`); } assert.ok(block.includes(`('${k}','en','${defaults[k]}')`), `${name}: the en row differs from the defaults`); }
  assert.match(sql, /NOT YET APPLIED TO ANY DATABASE/); assert.equal((sql.match(/on conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/g) ?? []).length, 2);
});
