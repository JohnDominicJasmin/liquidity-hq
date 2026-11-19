import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/* #2618 THE "No setup right now" CHIP COVERS EVERY WAIT THAT HAS NOTHING TO WATCH. The page's own `strategyNoSetup` expression (sliced from the source and run) against a table written from the PR text:
 * the chip shows when a strategy is picked, its verdict is WAIT and its overlay has no levels, no zones and no lines; the past-signal arrows (overlay.history) do NOT count as something drawn to watch.
 *   N1 no strategy picked = no chip   N2 a BUY or SELL = no chip   N3 a WAIT with no overlay at all, or an empty one = the chip   N4 a WAIT with levels, zones or lines = no chip   N5 a WAIT whose overlay holds ONLY history arrows = the chip (the QA shot finding: range bounce and VWAP reclaim drew nothing and showed no chip)   N6 the chip is rendered by KLineProChart from that prop and the label exists */
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const page = read('app/(main)/arena/page.tsx'), chart = read('components/KLineProChart.tsx'), labels = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const at = page.indexOf('strategyNoSetup={'); assert.ok(at > 0, 'CONTROL: strategyNoSetup prop not found in the Arena page');
const end = page.indexOf('} showSR=', at); assert.ok(end > at, 'CONTROL: could not find the end of the strategyNoSetup expression');
const expr = page.slice(at + 'strategyNoSetup={'.length, end);
const fn = new Function('arenaStrategy', 'strategyState', `${ts.transpileModule(`const v = ${expr};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^var v = |^const v = /, 'return ').replace(/;\s*$/, ';')}`) as (a: unknown, s: unknown) => boolean;
const ov = (o: Partial<Record<'levels' | 'zones' | 'lines' | 'history', unknown[]>>) => ({ levels: [], zones: [], lines: [], ...o });
const st = (verdict: string, overlay?: unknown) => ({ result: { verdict, overlay } });

test('N1. no strategy picked: no chip', () => { assert.equal(fn(null, st('wait')), false); assert.equal(fn('', st('wait')), false); });
test('N2. a BUY or a SELL: no chip', () => { for (const v of ['buy', 'sell']) assert.equal(fn('ema_cross', st(v, ov({}))), false, v); });
test('N3. a WAIT with no overlay, or an empty one: the chip', () => { assert.equal(fn('range_bounce', st('wait')), true); assert.equal(fn('range_bounce', st('wait', undefined)), true); assert.equal(fn('range_bounce', st('wait', ov({}))), true); assert.equal(fn('range_bounce', { result: null }), false, 'no result yet is not a WAIT'); });
test('N4. a WAIT that draws levels, zones or lines: no chip', () => { for (const k of ['levels', 'zones', 'lines'] as const) assert.equal(fn('sr_flip', st('wait', ov({ [k]: [{}] }))), false, k); });
test('N5. a WAIT whose overlay holds ONLY past-signal arrows (history): the chip shows (arrows are not something to watch)', () => { assert.equal(fn('range_bounce', st('wait', ov({ history: [{ ts: 1, dir: 'long' }] }))), true); assert.equal(fn('vwap_reclaim', st('wait', ov({ history: [{}, {}, {}] }))), true); assert.equal(fn('range_bounce', st('wait', ov({ history: [{}], levels: [{}] }))), false, 'history plus a level: the level is drawn: no chip'); });
test('N6. KLineProChart renders the chip from the prop (not while the timeframe loads) and the label exists', () => { assert.ok(chart.includes('{strategyNoSetup && !loadingTf && ('), 'the chip is not tied to strategyNoSetup and the loading state'); assert.equal(labels.STRAT_NO_SETUP, 'No setup right now'); });
