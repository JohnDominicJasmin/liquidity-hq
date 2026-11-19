/* #2576 RENDERED MTF ALIGNMENT: a timeframe with no reading is hidden, never a dash / Unavailable / NaN.
 * The real component source is transpiled (typescript transpileModule, JSX) and server-rendered with its hooks mocked.
 *   D1  every timeframe has a reading -> 7 rows, no dash
 *   D2  some null / undefined / NaN / Infinity -> those rows are not rendered; no "-", "NaN", "Unavailable" in the markup
 *   D3  nothing has a reading (entitled) -> zero rows, verdict Loading (pending) or No data (failed), never a verdict
 *   D4  Free: the two Pro rows still render, blurred and aria-hidden; the readable rows follow the same rule
 *   D5  the verdict is computed over the timeframes that have a reading (three of three bullish reads Bullish, not Mixed)
 *   D6  a non-finite value is not a reading for the verdict either (NaN must not count as Neutral)
 * TREE=<dir> runs it against another checkout (dev control). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const TREE = process.env.TREE ? path.resolve(process.env.TREE) : path.resolve(here, '..');
const req = createRequire(path.join(TREE, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');

const transpile = (rel: string) => ts.transpileModule(readFileSync(process.env.COMP && rel.endsWith('MultiTFAlignment.tsx') ? process.env.COMP : path.join(TREE, rel), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

type World = { coins: Record<string, Record<string, number | null | undefined>>; pricesFailed: boolean; entitled: boolean };
const world: World = { coins: {}, pricesFailed: false, entitled: true };

const rsiMod: { formatRsi: (v: number | null | undefined) => string } = (() => {
  const m = { exports: {} as never }; new Function('exports', 'module', 'require', transpile('lib/rsi.ts'))(m.exports, m, req); return m.exports;
})();

const mocks: Record<string, unknown> = {
  '@/lib/marketStore': { useMarket: () => ({ store: { coins: world.coins, selectedCoin: 'btc', pricesFailed: world.pricesFailed } }) },
  '@/components/Tip': { __esModule: true, default: (p: { children: unknown }) => p.children },
  '@/lib/labels': { useLabels: () => ({ t: (k: string) => k }) },
  '@/components/AuthProvider': { useAuth: () => ({ entitlementStatus: world.entitled ? 'entitled' : 'not_entitled', loading: false }) },
  '@/lib/limits': { isGatedTf: (tf: string) => ['1m', '5m', '15m'].includes(tf) },
  '@/lib/rsi': rsiMod,
};
const Component: (p: { coin?: string }) => unknown = (() => {
  const m = { exports: {} as { default?: unknown } };
  const r = (id: string) => (id in mocks ? mocks[id] : req(id));
  new Function('exports', 'module', 'require', transpile('components/MultiTFAlignment.tsx'))(m.exports, m, r);
  return m.exports.default as never;
})();

const render = (rsi: Record<string, number | null | undefined>, opts: Partial<Pick<World, 'pricesFailed' | 'entitled'>> = {}) => {
  world.coins = { btc: rsi }; world.pricesFailed = opts.pricesFailed ?? false; world.entitled = opts.entitled ?? true;
  return renderToStaticMarkup(React.createElement(Component as never, { coin: 'btc' }));
};
const rows = (html: string) => [...html.matchAll(/font-weight:700;color:var\(--txt2\)">(5m|15m|1h|4h|1D|1W|1M)<\/span>/g)].map(m => m[1]);
const verdict = (html: string): string[] => (html.match(/MULTI_TF_ALIGNMENT_(?:VERDICT|FOOTER)_\w+|EMA_PHASE_LOADING/g) ?? []);
const ALL = { rsi5m: 50, rsi14: 50, rsi1h: 50, rsi4h: 50, rsiDaily: 50, rsiWeekly: 50, rsiMonthly: 50 };
const noDash = (html: string) => { assert.ok(!/>-<\/span>/.test(html), 'a bare dash is rendered'); assert.ok(!/NaN|undefined|Unavailable|Infinity/.test(html), 'NaN/undefined/Unavailable text rendered'); };

test('D1. all seven timeframes with readings: seven rows, no dash', () => {
  const h = render(ALL);
  assert.deepEqual(rows(h), ['5m', '15m', '1h', '4h', '1D', '1W', '1M']);
  noDash(h);
});

test('D2. timeframes with no reading (null, undefined, NaN, Infinity) are not rendered', () => {
  const h = render({ ...ALL, rsi5m: null, rsi14: undefined, rsiWeekly: NaN, rsiMonthly: Infinity });
  assert.deepEqual(rows(h), ['1h', '4h', '1D']);
  noDash(h);
  const one = render({ ...ALL, rsiMonthly: null });
  assert.deepEqual(rows(one), ['5m', '15m', '1h', '4h', '1D', '1W']);
  noDash(one);
});

test('D3. nothing has a reading: no rows, Loading while pending, No data once failed, never a verdict', () => {
  const none = { rsi5m: null, rsi14: null, rsi1h: null, rsi4h: null, rsiDaily: null, rsiWeekly: null, rsiMonthly: null };
  const pending = render(none);
  assert.deepEqual(rows(pending), []);
  assert.deepEqual(verdict(pending), ['EMA_PHASE_LOADING']);
  noDash(pending);
  const failed = render(none, { pricesFailed: true });
  assert.deepEqual(rows(failed), []);
  assert.deepEqual(verdict(failed), ['MULTI_TF_ALIGNMENT_VERDICT_NO_DATA', 'MULTI_TF_ALIGNMENT_FOOTER_NO_DATA']);
  noDash(failed);
  const empty = render({});
  assert.deepEqual(rows(empty), []);
  assert.deepEqual(verdict(empty), ['EMA_PHASE_LOADING']);
});

test('D4. Free: 5m and 15m stay as blurred, aria-hidden rows; readable rows follow the hide rule', () => {
  const h = render({ ...ALL, rsi5m: null, rsi14: null, rsi4h: null }, { entitled: false });
  assert.deepEqual(rows(h), ['5m', '15m', '1h', '1D', '1W', '1M']);
  const locked = h.split('font-weight:700;color:var(--txt2)">15m</span>')[1].split('font-weight:700;color:var(--txt2)">1h</span>')[0];
  assert.ok(/filter:blur\(5px\)/.test(locked) && /aria-hidden="true"/.test(locked), 'a locked row must be blurred and aria-hidden');
  /* the Free user's 4h row (null) is hidden, not a dash */
  const readable = h.split('font-weight:700;color:var(--txt2)">1h</span>')[1];
  assert.ok(!/>-<\/span>/.test(readable), 'a dash in the readable (unlocked) rows');
});

test('D5. the verdict is over the timeframes that have a reading: 3 of 3 bullish reads Bullish, not Mixed', () => {
  const h = render({ rsi5m: null, rsi14: null, rsi1h: 70, rsi4h: 70, rsiDaily: 70, rsiWeekly: null, rsiMonthly: null });
  assert.deepEqual(rows(h), ['1h', '4h', '1D']);
  assert.deepEqual(verdict(h).filter(v => v.includes('VERDICT')), ['MULTI_TF_ALIGNMENT_VERDICT_BULLISH'],
    'three visible rows all Bullish, yet the card verdict is: ' + verdict(h).join(','));
});

test('D6. a non-finite value is not a reading for the verdict (NaN must not count as Neutral)', () => {
  const h = render({ rsi5m: null, rsi14: null, rsi1h: NaN, rsi4h: NaN, rsiDaily: null, rsiWeekly: null, rsiMonthly: null });
  assert.deepEqual(rows(h), []);
  assert.ok(!verdict(h).includes('MULTI_TF_ALIGNMENT_VERDICT_MIXED'), 'a card with zero rows says Mixed Signals: ' + verdict(h).join(','));
});

test('D4b. (#2694) Free: the blurred Pro rows show the sharp timeframe and a blurred bar only: no dash, no "No reading", no value, no bias badge', () => {
  const h = render({ ...ALL }, { entitled: false });
  const seg = (tf: string, next: string) => h.split(`font-weight:700;color:var(--txt2)">${tf}</span>`)[1].split(`font-weight:700;color:var(--txt2)">${next}</span>`)[0];
  for (const [tf, next] of [['5m', '15m'], ['15m', '1h']] as const) {
    const part = seg(tf, next); assert.ok(/filter:blur\(5px\)/.test(part) && /aria-hidden="true"/.test(part), `${tf}: still blurred and aria-hidden`);
    const text = part.replace(/^[^<]*>/, '').replace(/<[^>]*$/, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();   /* the split points cut a tag in half at both ends */ assert.equal(text, '', `${tf}: the blurred row carries text "${text}" (a dash, a value or "No reading")`);
    assert.equal(/BIAS|BULL|BEAR|NEUTRAL|NO_READING/i.test(part), false, `${tf}: a bias badge or a no-reading label is rendered`);
  }
  const readable = h.split('font-weight:700;color:var(--txt2)">1h</span>')[1]; assert.ok(/\d/.test(readable.replace(/<[^>]*>/g, ' ')), 'CONTROL: the readable rows still carry their values');
  const pro = render({ ...ALL }, { entitled: true }); const proSeg = pro.split('font-weight:700;color:var(--txt2)">5m</span>')[1].split('font-weight:700;color:var(--txt2)">15m</span>')[0]; assert.ok(/\d/.test(proSeg.replace(/<[^>]*>/g, ' ')), 'a Pro account still sees the 5m value');
});
