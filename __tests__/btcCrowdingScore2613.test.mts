import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/* #2613 THE BTC CROWDING SCORE WITH ITS FOURTH INPUT (the share of accounts long), RENDERED from the real component source with its hooks mocked. Expectations from the PR text, not from the code:
 *   four inputs of equal weight 25: Fear and Greed (value/100 x 25), daily RSI (clamp((rsi-30)/50) x 25), funding (positive only: clamp(rate/0.001) x 25), long accounts (clamp((long-0.5)/0.25) x 25: 50% adds nothing, 75% or more adds the full 25);
 *   the score = round(total / max possible x 100) over the inputs that EXIST; a missing ratio gives the three-input score and the "n of 4 inputs" notice; the real-data example of the PR (F&G 11, RSI 23.9, funding +0.0100%, 77.9% long) = 30.
 *   C1 the PR's real-data example   C2 the ratio's weight (50% = 0, 62.5% = 12.5, 75% and 90% = 25, below 50% = 0)   C3 a missing ratio = the old three-input score + the notice   C4 all four = no notice   C5 the row names the venue (Binance, else Bybit) and shows the percentage   C6 nothing at all = no score */
const here = path.dirname(fileURLToPath(import.meta.url)); const TREE = path.resolve(here, '..');
const req = createRequire(path.join(TREE, 'package.json')); const React = req('react'); const { renderToStaticMarkup } = req('react-dom/server');
const transpile = (rel: string) => ts.transpileModule(readFileSync(path.join(TREE, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
type Coin = Record<string, number | null | undefined>;
const world: { fng: number | null; btcDom: number | null; btc: Coin } = { fng: null, btcDom: null, btc: {} };
const ratioMod = (() => { const m = { exports: {} as never }; new Function('exports', 'module', 'require', transpile('lib/accountRatioVenue.ts'))(m.exports, m, req); return m.exports; })();
const mocks: Record<string, unknown> = {
  '@/lib/marketStore': { useMarket: () => ({ store: { fng: world.fng, btcDom: world.btcDom, coins: { btc: world.btc } } }) },
  '@/components/Tip': { __esModule: true, default: (p: { children: unknown }) => p.children },
  '@/lib/labels': { useLabels: () => ({ t: (k: string, v?: Record<string, unknown>) => (v ? `${k}|${JSON.stringify(v)}` : k) }) },
  '@/lib/color': { withAlpha: (c: string) => c },
  '@/lib/accountRatioVenue': ratioMod,
};
const Component: () => unknown = (() => { const m = { exports: {} as { default?: unknown } }; new Function('exports', 'module', 'require', transpile('components/BtcRiskLevel.tsx'))(m.exports, m, (id: string) => (id in mocks ? mocks[id] : req(id))); return m.exports.default as never; })();
const render = (w: Partial<typeof world>) => { world.fng = w.fng ?? null; world.btcDom = null; world.btc = w.btc ?? {}; return (renderToStaticMarkup(React.createElement(Component as never)) as string).replace(/&quot;/g, '"'); };
const score = (html: string) => { const m = /font-size:2\.25rem[^>]*>(-|\d+)<\/span>/.exec(html); assert.ok(m, 'no score element'); return m![1] === '-' ? null : Number(m![1]); };
const notice = (html: string) => /BTC_RISK_LEVEL_INPUTS_COUNT\|\{"n":(\d)\}/.exec(html)?.[1] ?? null;

test('C1. the PR real-data example: F&G 11, RSI 23.9, funding +0.0100%, 77.9% long = 30 (the old three-input score was 7)', () => {
  const h = render({ fng: 11, btc: { rsiDaily: 23.9, fundingRate: 0.0001, bnLongRatio: 0.779, bnShortRatio: 0.221 } });
  assert.equal(score(h), 30); assert.equal(notice(h), null, 'four inputs: no notice');
  const three = render({ fng: 11, btc: { rsiDaily: 23.9, fundingRate: 0.0001 } }); assert.equal(score(three), 7, 'the old three-input score');
});
test('C2. the ratio weight: 50% adds nothing, 62.5% adds 12.5, 75% and 90% add the full 25, below 50% adds nothing', () => {
  const base = { fng: 60, btc: { rsiDaily: 80, fundingRate: 0.001 } };          // 15 + 25 + 25 = 65 over three inputs
  const at = (long: number) => score(render({ ...base, btc: { ...base.btc, bnLongRatio: long, bnShortRatio: 1 - long } }));
  assert.equal(at(0.4), 65, 'below 50% adds nothing: 65 of 100'); assert.equal(at(0.5), 65, '50% adds nothing');
  assert.equal(at(0.625), Math.round(77.5), '12.5 of 100 added: 77.5 rounds to 78'); assert.equal(at(0.75), 90, '75% adds the full 25: 90'); assert.equal(at(0.9), 90, 'more than 75% adds no more');
});
test('C3. a missing ratio gives the three-input score (the old formula, rescaled over what exists) and the "3 of 4" notice', () => {
  const h = render({ fng: 60, btc: { rsiDaily: 80, fundingRate: 0.001 } });
  assert.equal(score(h), Math.round((65 / 75) * 100), '65 of 75 = 87'); assert.equal(notice(h), '3');
  const two = render({ fng: 60, btc: { rsiDaily: 80 } }); assert.equal(score(two), Math.round((40 / 50) * 100)); assert.equal(notice(two), '2');
});
test('C4. all four inputs: no "n of 4" notice', () => { assert.equal(notice(render({ fng: 60, btc: { rsiDaily: 80, fundingRate: 0.001, bnLongRatio: 0.7, bnShortRatio: 0.3 } })), null); });
test('C5. the row names the venue (Binance first, Bybit when Binance has none) and shows the long percentage', () => {
  const bn = render({ fng: 50, btc: { rsiDaily: 50, fundingRate: 0.0001, bnLongRatio: 0.7, bnShortRatio: 0.3, longRatio: 0.4, shortRatio: 0.6 } });
  assert.ok(bn.includes('BTC_RISK_LEVEL_RATIO_LABEL|{"venue":"Binance"}') && bn.includes('70.0%'), 'Binance figure expected');
  const by = render({ fng: 50, btc: { rsiDaily: 50, fundingRate: 0.0001, longRatio: 0.55, shortRatio: 0.45 } });
  assert.ok(by.includes('BTC_RISK_LEVEL_RATIO_LABEL|{"venue":"Bybit"}') && by.includes('55.0%'), 'Bybit fallback expected');
});
test('C6. no input at all: no score, never a number', () => { assert.equal(score(render({})), null); });
