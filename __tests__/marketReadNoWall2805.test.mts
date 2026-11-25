/* QA: PR #2805 (#1651 owner item 7), the Market Read drops the Order wall tile and its 30 points. Expected numbers are written out from the scoring rules, at a fixed clock (Wednesday 12:00 UTC: session 10, weekday 10).
 *   N1 order walls change nothing: the same read with no walls, tight walls, far walls and empty lists
 *   N2 four factors (Fear & Greed, day, funding, smart money), three when funding is left out; none is a wall
 *   N3 the score is session + day + Fear & Greed + funding over 100, or over 70 when funding is left out
 *   N4 the ten wall label keys are gone from the registry and the shipped defaults, and no source reads them (their database rows stay)
 *   N5 the factor row has four columns; the tip no longer names order walls */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { computeMarketRead } from '../lib/marketRead.ts';
import { defaultStore, type CoinData, type MarketStore } from '../lib/marketStore.ts';
import { LABEL_KEYS } from '../lib/labelKeys.ts';

const root = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8').replace(/\r\n/g, '\n');
const WED_NOON_UTC = Date.UTC(2026, 8, 30, 12, 0, 0);
const pinClock = (t: TestContext) => t.mock.timers.enable({ apis: ['Date'], now: WED_NOON_UTC });
const coin = (o: Partial<CoinData>): CoinData => ({ ...(Object.fromEntries(['price', 'change', 'high', 'low', 'fundingRate', 'oi', 'vol24', 'volRatio', 'longRatio', 'shortRatio', 'rsi14', 'ma20', 'perpPrice', 'cvd', 'cvdDivergence', 'orderBidWalls', 'orderAskWalls', 'oiTrend', 'takerBuyRatio'].map((k) => [k, null])) as unknown as CoinData), price: 100, ...o });
const store = (fng: number, o: Partial<CoinData>): MarketStore => ({ ...defaultStore, selectedCoin: 'btc', fng, coins: { btc: coin(o) } });
const walls = (bid: number | null, ask: number | null) => ({ orderBidWalls: (bid === null ? [] : [{ price: bid, size: 1_000 }]) as never, orderAskWalls: (ask === null ? [] : [{ price: ask, size: 1_000 }]) as never });
const RETIRED = ['ORDER_WALL', 'TIGHT', 'NEARBY', 'FAR', 'NO_WALLS', 'WALL_TIGHT', 'WALL_CLOSE', 'WALL_AWAY', 'WALL_FAR', 'WALL_TOO_FAR'].map((k) => `MARKET_READ_TXT_${k}`);

test('N1. order walls change nothing in the read', (t) => {
  pinClock(t);
  for (const [fng, fr] of [[10, 0.001], [50, 0], [75, -0.001]] as const) {
    const base = computeMarketRead(store(fng, { fundingRate: fr }));
    for (const w of [walls(99.9, 100.1), walls(90, 110), walls(null, null)]) assert.deepEqual(computeMarketRead(store(fng, { fundingRate: fr, ...w })), base, `fng ${fng} funding ${fr}`);
  }
});

test('N2. four factors, three without funding, and none of them is a wall', (t) => {
  pinClock(t);
  const full = computeMarketRead(store(50, { fundingRate: 0, ...walls(99.9, 100.1) }));
  assert.deepEqual(full.factors.map((f) => f.key), ['fng', 'day', 'fund', 'sm']);
  const partial = computeMarketRead(store(50, { fundingRate: null, ...walls(99.9, 100.1) }), null, { partial: true });
  assert.deepEqual(partial.factors.map((f) => f.key), ['fng', 'day', 'sm']);
  assert.equal([...full.factors, ...partial.factors].some((f) => /wall/i.test(`${f.label} ${f.value} ${f.sub ?? ''}`)), false);
});

test('N3. the score is the four inputs over their own maximum', (t) => {
  pinClock(t);
  assert.equal(computeMarketRead(store(50, { fundingRate: 0 })).score, 40, '10 + 10 + 12 + 8 of 100');
  assert.equal(computeMarketRead(store(10, { fundingRate: 0.001 })).score, 75, '10 + 10 + 25 + 30 of 100');
  assert.equal(computeMarketRead(store(10, { fundingRate: 0 })).score, 53, '10 + 10 + 25 + 8 of 100');
  assert.equal(computeMarketRead(store(10, { fundingRate: null }), null, { partial: true }).score, 64, '10 + 10 + 25 of 70');
});

test('N4. the retired wall keys are not registered, not shipped and not read anywhere', () => {
  const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  const critical = JSON.parse(read('lib/labelDefaults.critical.json')) as Record<string, string>;
  for (const k of RETIRED) { assert.ok(!(LABEL_KEYS as readonly string[]).includes(k), `${k} is still registered`); assert.ok(!(k in defaults) && !(k in critical), `${k} is still shipped`); }
  const files: string[] = [];
  const walk = (dir: string) => { for (const e of readdirSync(new URL(`${dir}/`, root), { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
  for (const d of ['app', 'components', 'lib']) walk(d);
  assert.ok(files.length > 200, `CONTROL: only ${files.length} source files walked`);
  const hits = files.filter((f) => { const s = read(f); return RETIRED.some((k) => new RegExp(`${k}(?![A-Z0-9_])`).test(s)); });
  assert.deepEqual(hits, [], 'a retired key is still read');
});

test('N5. four columns, and the tip no longer names order walls', () => {
  assert.match(read('app/globals.css'), /\.mr-factors \{ display: grid; grid-template-columns: repeat\(4, 1fr\);/);
  const tip = (JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>).MARKET_READ_TIP;
  assert.ok(tip.includes('funding') && !/wall/i.test(tip), tip);
});
