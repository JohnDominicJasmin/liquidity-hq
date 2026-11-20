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

/* RE-PINNED FOR #2706 (PM ruling A, 2026-11-20: one price unit on the Arena). The strategy's prices are now in the unit of the PRIMARY venue's series (Bybit's when it lists the coin, else Binance's), not per-token, so the conversion to the chart is
   primary-unit -> chart-unit = factor(primary symbol) / factor(chart symbol): 1 when the chart drew the primary series (the normal case, even for 1000PEPE), and a real conversion only when the chart fell back to the OTHER venue and the two quote different denominations. */
const OV1000 = { zones: [{ top: 0.0040, bottom: 0.0038, fromTs: 1, toTs: 2, kind: 'supply', labelKey: 'Z' }], lines: [{ points: [{ ts: 1, price: 0.0036 }, { ts: 2, price: 0.0037 }], role: 'watch', labelKey: 'L' }], levels: [{ price: 0.0042, fromTs: 1, role: 'watch', labelKey: 'HI' }, { price: 0.0035, fromTs: 1, role: 'watch', labelKey: 'LO' }], marker: null };
const oneLevel = (price: number) => ({ zones: [], lines: [], levels: [{ price, fromTs: 1, role: 'watch', labelKey: 'HI' }], marker: null });

test('U2. strategy prices are already in the primary venue\'s unit: handed to the chart unchanged when it drew that series, converted only when the chart fell back to a venue with another denomination', () => {
  /* 1000PEPE: Bybit primary, the chart drew Bybit: unit 1, every price, zone label and rank price unchanged (they were x1000 BEFORE #2706 and are not now) */
  const pepe = run({ coin: 'pepe', hist: 'bybit', venue: { binance: '1000PEPEUSDT', bybit: '1000PEPEUSDT' }, ov: OV1000 });
  const zone = pepe.find((c) => c.name === 'strategyZone')!; assert.ok(near(zone.points[0].value, 0.0040) && near(zone.points[1].value, 0.0038), `zone edges: ${JSON.stringify(zone.points)}`); assert.equal(zone.extendData.priceText, '$0.0039', 'the zone label price');
  const line = pepe.find((c) => c.name === 'strategyPolyline')!; assert.ok(near(line.points[0].value, 0.0036) && near(line.points[1].value, 0.0037), `line points: ${JSON.stringify(line.points)}`);
  const lvls = pepe.filter((c) => c.name === 'strategyLevelLine'); assert.equal(lvls.length, 2); const hi = lvls.find((c) => String(c.extendData.text).startsWith('HI'))!, lo = lvls.find((c) => String(c.extendData.text).startsWith('LO'))!;
  assert.ok(near(hi.points[0].value, 0.0042) && near(lo.points[0].value, 0.0035), 'level prices'); assert.equal(hi.extendData.text, 'HI $0.0042'); assert.equal(lo.extendData.text, 'LO $0.0035');
  assert.deepEqual(hi.extendData.prices, [0.0035, 0.0042].map((p) => (hi.extendData.prices as number[]).find((q) => near(q, p))), 'the rank prices are unchanged'); assert.equal(hi.extendData.rank, 1); assert.equal(lo.extendData.rank, 0);
  /* a coin whose venues disagree on the denomination (sats: 10000SATS on Bybit = primary, 1000SATS on Binance): strategy prices are in the 10000x unit */
  const venue = { binance: '1000SATSUSDT', bybit: '10000SATSUSDT' };
  const onBybit = run({ coin: 'sats', hist: 'bybit', venue, ov: oneLevel(4.2) })[0].points[0].value, onBinance = run({ coin: 'sats', hist: 'binance', venue, ov: oneLevel(4.2) })[0].points[0].value;
  assert.ok(near(onBybit, 4.2), `chart on the primary (Bybit) series: no conversion: ${onBybit}`); assert.ok(near(onBinance, 0.42), `chart fell back to Binance's 1000SATS: 10000x -> 1000x divides by 10: ${onBinance}`);
  /* the venues disagree the OTHER way (tag: 1000TAG on Bybit = primary, TAGUSDT per token on Binance): a fallback chart is per-token, the strategy's 3.8 becomes 0.0038 */
  const tag = { binance: 'TAGUSDT', bybit: '1000TAGUSDT' };
  assert.ok(near(run({ coin: 'tag', hist: 'binance', venue: tag, ov: oneLevel(3.8) })[0].points[0].value, 0.0038), 'Binance per-token chart under a 1000x primary'); assert.ok(near(run({ coin: 'tag', hist: 'bybit', venue: tag, ov: oneLevel(3.8) })[0].points[0].value, 3.8));
  /* only one venue symbol: the primary is that symbol and so is the chart's: unit 1 */
  assert.ok(near(run({ coin: 'pepe', hist: 'binance', venue: { bybit: '1000PEPEUSDT' }, ov: oneLevel(4.2) })[0].points[0].value, 4.2), 'no Binance symbol: the Bybit series is both');
  assert.ok(near(run({ coin: 'bonk', hist: 'bybit', venue: { binance: '1000BONKUSDT' }, ov: oneLevel(0.0123) })[0].points[0].value, 0.0123), 'no Bybit symbol: the Binance series is both');
  /* an ordinary coin and an unknown symbol are unchanged, and a non-finite price still draws nothing */
  const btc = run({ coin: 'btc', hist: 'bybit', venue: { binance: 'BTCUSDT', bybit: 'BTCUSDT' }, ov: { zones: [{ top: 71_500, bottom: 71_000, fromTs: 1, toTs: 2, kind: 'supply', labelKey: 'Z' }], lines: [], levels: [{ price: 70_000, fromTs: 1, role: 'watch', labelKey: 'HI' }], marker: null } });
  assert.deepEqual(btc.find((c) => c.name === 'strategyZone')!.points.map((p) => p.value), [71_500, 71_000]); assert.equal(btc.find((c) => c.name === 'strategyLevelLine')!.points[0].value, 70_000);
  assert.equal(run({ coin: 'zzz', hist: 'bybit', venue: {}, ov: oneLevel(1.5) })[0].points[0].value, 1.5, 'an unknown symbol is unchanged');
  assert.equal(run({ coin: 'pepe', hist: 'bybit', venue: { binance: '1000PEPEUSDT' }, ov: { zones: [], lines: [{ points: [{ ts: 1, price: NaN }, { ts: 2, price: 1 }], role: 'watch', labelKey: 'L' }], levels: [], marker: null } }).length, 0, 'a non-finite price draws nothing');
});
