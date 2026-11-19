import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2689 (QA indicators matrix #1263, D1 HIGH): CHOOSING TWO OR MORE OF SMA / SAR / BOLL MUST DRAW ALL OF THEM. Written rule: the chips drawn on the candle pane are STACKED on it; without stacking klinecharts removes the pane's earlier indicator when another is created, so only the LAST drew while every chip read pressed. Indicators with their own pane (MACD, ...) have a unique pane id and are not stacked by this rule.
 *   S1 klinecharts' own addIndicator (cut out of the installed library and run): stack false drops the pane's earlier indicator, stack true keeps both, a second indicator of the same name is refused   S2 the app creates every candle-pane indicator with isStack: true and every own-pane indicator in its own pane
 * S1 is the dependency contract: if a klinecharts upgrade changes what isStack means, this goes red BEFORE the chart starts lying again. */
const lib = readFileSync(new URL('../node_modules/klinecharts/dist/index.esm.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const chart = readFileSync(new URL('../components/KLineProChart.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const must = (s: string, re: RegExp, what: string) => { const m = re.exec(s); assert.ok(m, `CONTROL: ${what} not found`); return m![1]; };

function makeStore() {
  const body = must(lib, /StoreImp\.prototype\.addIndicator = function \(create, isStack\) \{([\s\S]*?)\n    \};\n/, 'klinecharts addIndicator');
  const store: Record<string, unknown> = { _indicators: new Map<string, Array<{ name: string }>>(), _calc: [] as string[] };
  store.getIndicatorsByPaneId = function (this: typeof store, paneId: string) { return (this._indicators as Map<string, Array<{ name: string }>>).get(paneId) ?? []; };
  store.getIndicatorsByFilter = function (this: typeof store, f: { paneId?: string; name?: string }) { return (this.getIndicatorsByPaneId as (p: string) => Array<{ name: string }>)(f.paneId as string).filter((i) => !f.name || i.name === f.name); };
  store.removeIndicator = function (this: typeof store, f: { paneId: string }) { (this._indicators as Map<string, unknown>).set(f.paneId, []); };
  store._synchronizeIndicatorSeriesPrecision = () => undefined; store._sortIndicators = () => undefined; store._calcIndicator = function (this: typeof store, i: { name: string }) { (this._calc as string[]).push(i.name); };
  const add = new Function('getIndicatorClass', 'isValid', 'create', 'isStack', body.replace(/var IndicatorClazz = getIndicatorClass\(name\);\n\s*var indicator = new IndicatorClazz\(\);/, 'var indicator = new (getIndicatorClass(name))();'));
  const classOf = (name: string) => class { name = name; override(c: { name: string }) { this.name = c.name; } };
  return { store, add: (create: { name: string; paneId: string }, stack: boolean) => (add as (...a: unknown[]) => boolean).call(store, classOf, (v: unknown) => v !== undefined && v !== null, create, stack), names: (pane: string) => (store.getIndicatorsByPaneId as (p: string) => Array<{ name: string }>).call(store, pane).map((i) => i.name) };
}
test('S1. klinecharts addIndicator: not stacked = the pane keeps only the LAST; stacked = all; the same name twice is refused', () => {
  let s = makeStore(); s.add({ name: 'SMA', paneId: 'candle_pane' }, false); s.add({ name: 'SAR', paneId: 'candle_pane' }, false); s.add({ name: 'BOLL', paneId: 'candle_pane' }, false); assert.deepEqual(s.names('candle_pane'), ['BOLL'], 'the CONTROL: without stacking only the last survives (the defect)');
  s = makeStore(); assert.equal(s.add({ name: 'SMA', paneId: 'candle_pane' }, true), true); s.add({ name: 'SAR', paneId: 'candle_pane' }, true); s.add({ name: 'BOLL', paneId: 'candle_pane' }, true); assert.deepEqual(s.names('candle_pane'), ['SMA', 'SAR', 'BOLL'], 'stacked: all three stay');
  assert.equal(s.add({ name: 'SMA', paneId: 'candle_pane' }, true), false, 'the same indicator twice is refused, not duplicated'); assert.deepEqual(s.names('candle_pane'), ['SMA', 'SAR', 'BOLL']);
  s.add({ name: 'MACD', paneId: 'strat_macd' }, false); assert.deepEqual(s.names('candle_pane'), ['SMA', 'SAR', 'BOLL'], 'an own-pane indicator never touches the candle pane'); assert.deepEqual(s.names('strat_macd'), ['MACD']);
});
test('S2. the app stacks every candle-pane indicator and gives every own-pane indicator its own pane', () => {
  const call = must(chart, /(chart\.createIndicator\(\s*\{ name: entry\.id, calcParams \},[\s\S]*?\n\s*\);)/, 'the strategy chip createIndicator call'); const code = call.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(code, /entry\.pane === 'own'\s*\?\s*\{ pane: \{ id: `strat_\$\{key\.toLowerCase\(\)\}`, height: 90, minHeight: 30 \} \}\s*:\s*\{ isStack: true, pane: \{ id: 'candle_pane' \} \}/, 'a candle-pane chip is not created stacked, or an own-pane chip lost its own pane');
  for (const m of chart.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/createIndicator\(([\s\S]*?)\);/g)) { if (/candle_pane/.test(m[1])) assert.match(m[1], /isStack:\s*true/, `a candle-pane createIndicator is not stacked: ${m[1].slice(0, 80)}`); }
});
