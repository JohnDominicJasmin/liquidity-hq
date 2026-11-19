import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { symbolDenominationFactor } from '../lib/coins.ts';

/* #2697 (QA drawings audit #1263, PEPE: 0 of ~190 cells had an overlay in view): THE STRATEGY OVERLAYS ARE DRAWN IN THE CHART'S PRICE UNIT. Written rule (Dev's cause + PR body): a 1000x contract (1000PEPE, 1000BONK, 10000SATS...) is charted on the exchange's own scaled series on purpose; the strategy reads candles per token (divided by the denomination), so every price handed to the chart (zone edges, line points, level prices, the label price text) is multiplied by 1 / symbolDenominationFactor of the symbol the chart actually drew (the Bybit symbol when the history came from Bybit, else Binance); an ordinary coin is multiplied by 1; markers use the chart's own bars and are not scaled.
 *   U1 symbolDenominationFactor on a table (the factor the unit comes from)   U2 the REAL conversion block cut from components/KLineProChart.tsx, run with a recording chart: zones, lines, levels (price, rank prices, label text), the unit follows the history venue, ordinary coins are unchanged, a non-finite price draws nothing
 * NOT covered (browser cells after deploy): that PEPE / BONK / FLOKI / MOG overlays are in view on the real chart. */
const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
const src = readFileSync(new URL('../components/KLineProChart.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('U1. symbolDenominationFactor: 1000x, 10000x and 1000000x contracts are 1/n, ordinary symbols and non-power-of-ten prefixes are 1', () => {
  for (const [sym, want] of [['1000PEPEUSDT', 0.001], ['1000BONKUSDT', 0.001], ['10000SATSUSDT', 0.0001], ['1000000MOGUSDT', 0.000001], ['BTCUSDT', 1], ['SOLUSDT', 1], ['1INCHUSDT', 1], ['100XYZUSDT', 1], ['2000FOOUSDT', 1], ['', 1]] as const) assert.equal(symbolDenominationFactor(sym), want, sym);
});

const start = src.indexOf('const vs = venueSymbols(coinRef.current);'); assert.ok(start > 0, 'CONTROL: the unit computation was not found');
const endMark = 'text: `${tl(l.labelKey, l.labelParams)} ${px}${fmtPx(l.price * unit)}` }));'; const endAt = src.indexOf(endMark, start); assert.ok(endAt > start, 'CONTROL: the end of the conversion block was not found');
const block = src.slice(start, endAt + endMark.length);
const HEAD = 'function conv() {', TAIL = '\n}';
const stripped = stripTypeScriptTypes(HEAD + block + TAIL); const body = stripped.slice(stripped.indexOf(HEAD) + HEAD.length, stripped.lastIndexOf('}'));
type Created = { name: string; points: Array<{ timestamp: number; value: number }>; extendData: Record<string, unknown> };
const run = (opts: { coin: string; hist: 'bybit' | 'binance'; venue: { binance?: string; bybit?: string }; ov: unknown }) => {
  const created: Created[] = []; const chart = { createOverlay: (o: Created) => { created.push(o); return `id${created.length}`; } };
  const fn = new Function('coinRef', 'histSourceRef', 'venueSymbols', 'symbolDenominationFactor', 'ov', 'tl', 'px', 'fmtPx', 'chart', 'strategyOverlayIds', 'Number', body.replace('as OverlayCreate', ''));
  fn({ current: opts.coin }, { current: opts.hist }, () => opts.venue, symbolDenominationFactor, opts.ov, (k: string) => k, '$', (v: number) => String(Number(v.toPrecision(7))), chart, { current: [] as string[] }, Number);
  return created;
};
const OV = { zones: [{ top: 0.0000040, bottom: 0.0000038, fromTs: 1, toTs: 2, kind: 'supply', labelKey: 'Z' }], lines: [{ points: [{ ts: 1, price: 0.0000036 }, { ts: 2, price: 0.0000037 }], role: 'watch', labelKey: 'L' }], levels: [{ price: 0.0000042, fromTs: 1, role: 'watch', labelKey: 'HI' }, { price: 0.0000035, fromTs: 1, role: 'watch', labelKey: 'LO' }], marker: null };
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));

test('U2. every price handed to the chart is in the chart\'s unit: PEPE x1000 on Bybit, the venue of the history decides, ordinary coins x1, bad prices draw nothing', () => {
  const pepe = run({ coin: 'pepe', hist: 'bybit', venue: { binance: '1000PEPEUSDT', bybit: '1000PEPEUSDT' }, ov: OV });
  const zone = pepe.find((c) => c.name === 'strategyZone')!; assert.ok(near(zone.points[0].value, 0.0040) && near(zone.points[1].value, 0.0038), `zone edges: ${JSON.stringify(zone.points)}`); assert.equal(zone.extendData.priceText, '$0.0039', 'the zone label price is in the chart unit too');
  const line = pepe.find((c) => c.name === 'strategyPolyline')!; assert.ok(near(line.points[0].value, 0.0036) && near(line.points[1].value, 0.0037), `line points: ${JSON.stringify(line.points)}`);
  const lvls = pepe.filter((c) => c.name === 'strategyLevelLine'); assert.equal(lvls.length, 2); const hi = lvls.find((c) => String(c.extendData.text).startsWith('HI'))!, lo = lvls.find((c) => String(c.extendData.text).startsWith('LO'))!;
  assert.ok(near(hi.points[0].value, 0.0042) && near(lo.points[0].value, 0.0035), 'level prices'); assert.equal(hi.extendData.text, 'HI $0.0042', 'the level label price is in the chart unit'); assert.equal(lo.extendData.text, 'LO $0.0035');
  assert.deepEqual(hi.extendData.prices, [0.0035, 0.0042].map((p) => (hi.extendData.prices as number[]).find((q) => near(q, p))), 'the rank prices are in the chart unit'); assert.equal(hi.extendData.rank, 1); assert.equal(lo.extendData.rank, 0);
  /* a coin whose venues disagree on the denomination: the venue the history came from decides the unit */
  const venue = { binance: '1000SATSUSDT', bybit: '10000SATSUSDT' };
  const onBybit = run({ coin: 'sats', hist: 'bybit', venue, ov: { ...OV, zones: [], lines: [], levels: [OV.levels[0]] } })[0].points[0].value, onBinance = run({ coin: 'sats', hist: 'binance', venue, ov: { ...OV, zones: [], lines: [], levels: [OV.levels[0]] } })[0].points[0].value;
  assert.ok(near(onBybit, 0.0000042 * 10000), `history from Bybit uses the Bybit symbol: ${onBybit}`); assert.ok(near(onBinance, 0.0000042 * 1000), `history from Binance uses the Binance symbol: ${onBinance}`);
  /* only one venue symbol: the other history source falls back to it */
  assert.ok(near(run({ coin: 'pepe', hist: 'binance', venue: { bybit: '1000PEPEUSDT' }, ov: { ...OV, zones: [], lines: [], levels: [OV.levels[0]] } })[0].points[0].value, 0.0042), 'no Binance symbol: the Bybit one is used');
  /* an ordinary coin and an unknown symbol are unchanged */
  const btc = run({ coin: 'btc', hist: 'bybit', venue: { binance: 'BTCUSDT', bybit: 'BTCUSDT' }, ov: { zones: [{ top: 71_500, bottom: 71_000, fromTs: 1, toTs: 2, kind: 'supply', labelKey: 'Z' }], lines: [], levels: [{ price: 70_000, fromTs: 1, role: 'watch', labelKey: 'HI' }], marker: null } });
  assert.deepEqual(btc.find((c) => c.name === 'strategyZone')!.points.map((p) => p.value), [71_500, 71_000]); assert.equal(btc.find((c) => c.name === 'strategyLevelLine')!.points[0].value, 70_000); assert.equal(run({ coin: 'zzz', hist: 'bybit', venue: {}, ov: { ...OV, zones: [], lines: [], levels: [OV.levels[0]] } })[0].points[0].value, 0.0000042, 'no symbol at all: unchanged');
  assert.equal(run({ coin: 'pepe', hist: 'bybit', venue: { binance: '1000PEPEUSDT' }, ov: { ...OV, zones: [], lines: [{ points: [{ ts: 1, price: NaN }, { ts: 2, price: 1 }], role: 'watch', labelKey: 'L' }], levels: [] } }).length, 0, 'a non-finite price draws nothing');
});
