import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { MIN_CANDLES as CROSS_MIN } from '../lib/strategies/emaCross.ts';
import { MIN_CANDLES as STACK_MIN } from '../lib/strategies/emaStack.ts';
import { dropForming } from '../lib/candles.ts';
import { LABEL_KEYS } from '../lib/labelKeys.ts';

/* #2610 A STRATEGY WITH TOO FEW CANDLES SAYS HOW MANY IT NEEDS AND HOW MANY THE COIN HAS (PM item 4 after the audit). Expectations from the PR text:
 *   when the CLOSED candles are fewer than the strategy's minCandles the state is `unavailable` with reason STRAT_NA_TOO_FEW ("Needs {need} {tf} candles; {coin} has {have}."), NOT the generic error with a Retry button;
 *   `have` counts CLOSED candles (the forming one is not counted), `need` is the strategy's own minimum, the coin is upper-cased; a coin with enough candles is unchanged; a failed fetch is still the generic error; the label exists in all 5 locales with all four placeholders.
 *   N1 the hook's too-few branch   N2 the text for the audit's own examples (ema_cross 601 on 1d: aapl 226, nvda 237)   N3 the label in every locale   N4 the arithmetic of "closed"   N5 the failed fetch stays an error */
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const hook = read('lib/useStrategySignal.ts');
const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? String(vars[k]) : whole));

test('N1. the too-few branch sets an `unavailable` state with STRAT_NA_TOO_FEW and the four variables, not the generic error', () => {
  const at = hook.indexOf('if (closed.length < def.minCandles)'); assert.ok(at > 0, 'CONTROL: the too-few branch is not in the hook');
  const end = hook.indexOf('\n', at), line = hook.slice(at, end);
  assert.ok(/error: false/.test(line) && !/error: true/.test(line), `the too-few state is still an error: ${line.slice(0, 200)}`);
  assert.ok(/unavailable: \{ reasonKey: 'STRAT_NA_TOO_FEW'/.test(line), 'the reason key is not STRAT_NA_TOO_FEW');
  for (const v of ['need: String(def.minCandles)', 'coin: coin.toUpperCase()', 'have: String(closed.length)']) assert.ok(line.includes(v), `variable missing or wrong: ${v}`); assert.ok(/\btf\b[,\s}]/.test(line.replace(/need: String\(def\.minCandles\)/, '')), 'variable tf missing');
  /* RE-PINNED 2026-11-20 for #2732 (PM option A, "retries first, the word only after them"): N5 used to say a failed fetch is `error: true` within 120 characters of `} catch {`. That expectation is older than the change: a FIRST failed read with no earlier call now keeps the LOADING skeleton
   * (`loading: true, error: false`), and the generic error (`error: true`) shows only after the SECOND failed read in a row (`fails >= 2`, the 45 s retry between them). A failed fetch is STILL the generic error, and still never "too few candles"; the pin now names both halves of the gate
   * (the error at two, the skeleton below it) over the whole catch body, so neither the error nor the gate can be dropped. The kept-call branch is pinned by __tests__/staleSignalKept2678.test.mts T1 and the sequence by __tests__/retriesFirst2732.test.mts. */
  const catchAt = hook.indexOf('} catch {'); const catchBody = hook.slice(catchAt, hook.indexOf('failed = true;', catchAt)); assert.ok(catchAt > at && catchBody.length > 20, 'CONTROL: the catch body was not found');
  assert.ok(/fails >= 2 \? \{ result: null, loading: false, error: true \} : \{ result: null, loading: true, error: false \}/.test(catchBody), 'N5: a failed fetch must still be the generic error, but only from the SECOND failed read in a row; the first one keeps the loading skeleton');
  assert.ok(!/STRAT_NA_TOO_FEW/.test(catchBody), 'the failure path must not claim too few candles');
});
test('N2. the sentence for the audit examples: ema_cross needs 601 1d candles (aapl has 226, nvda 237); ema_stack needs 230', () => {
  assert.equal(CROSS_MIN, 601); assert.equal(STACK_MIN, 230);
  const en = (JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>).STRAT_NA_TOO_FEW;
  assert.equal(fill(en, { need: String(CROSS_MIN), tf: '1d', coin: 'AAPL', have: '226' }), 'Needs 601 1d candles; AAPL has 226.');
  assert.equal(fill(en, { need: String(CROSS_MIN), tf: '1d', coin: 'NVDA', have: '237' }), 'Needs 601 1d candles; NVDA has 237.');
  assert.equal(fill(en, { need: String(STACK_MIN), tf: '1d', coin: 'AAPL', have: '226' }), 'Needs 230 1d candles; AAPL has 226.');
});
test('N3. the label is registered and exists in en, ko, zh, ru, ar with all four placeholders (a locale that dropped one would print a raw {have})', () => {
  assert.ok((LABEL_KEYS as readonly string[]).includes('STRAT_NA_TOO_FEW'), 'not registered in labelKeys');
  const dir = new URL('../supabase/migrations/', import.meta.url); const f = readdirSync(dir).find((n) => n.includes('labels_needs_candles')); assert.ok(f, 'the held migration is missing');
  const sql = read(`supabase/migrations/${f}`); const rows = [...sql.matchAll(/\('STRAT_NA_TOO_FEW','(\w+)','([^']*)'\)/g)];
  const byTable = sql.split('lhq_dev_labels'); const prod = [...byTable[0].matchAll(/\('STRAT_NA_TOO_FEW','(\w+)','([^']*)'\)/g)], dev = [...(byTable[1] ?? '').matchAll(/\('STRAT_NA_TOO_FEW','(\w+)','([^']*)'\)/g)];
  assert.equal(rows.length, 10, 'expected 5 locales x (prod + dev)'); for (const [name, set] of [['prod', prod], ['dev', dev]] as const) { assert.deepEqual(set.map((m) => m[1]).sort(), ['ar', 'en', 'ko', 'ru', 'zh'], `${name} locales`); for (const m of set) for (const ph of ['{need}', '{tf}', '{coin}', '{have}']) assert.ok(m[2].includes(ph), `${name} ${m[1]} lost ${ph}: ${m[2]}`); }
  const en = (JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>).STRAT_NA_TOO_FEW; for (const m of prod) if (m[1] === 'en') assert.equal(m[2], en, 'the en row must equal the shipped default');
  for (const m of prod) assert.equal(fill(m[2], { need: '601', tf: '1d', coin: 'AAPL', have: '226' }).includes('{'), false, `${m[1]}: a placeholder is left unfilled`);
});
test('N4. "closed" arithmetic the hook relies on: the forming candle is not counted, so a coin with exactly the minimum plus a forming candle is NOT too few, and one short is', () => {
  const tf = 86_400_000, now = Date.UTC(2026, 10, 19, 12, 0); const mk = (n: number, formingLast: boolean) => Array.from({ length: n }, (_, i) => ({ time: (formingLast ? Math.floor(now / tf) * tf - (n - 1 - i) * tf : Math.floor(now / tf) * tf - (n - i) * tf) }));
  assert.equal(dropForming(mk(601, true), tf, now).length, 600, 'the forming day is not a closed candle'); assert.equal(dropForming(mk(601, false), tf, now).length, 601);
  assert.ok(dropForming(mk(601, true), tf, now).length < CROSS_MIN, '601 candles whose last is still forming is one short of the 601 needed');
});
