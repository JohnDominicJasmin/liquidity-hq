/* QA: PR #2708, the Market Structure card reads its candles in the Arena's price unit (PM ruling A, 2026-11-20; QA on #2706: the card and the AI context line `marketStructure` quoted per-token swings (BOS $0.00000429, SH, SL) beside a per-1000 price $0.0037).
 *
 * THE WRITTEN RULE: every price the Arena shows or quotes is in ONE unit: the unit of the coin's primary venue symbol (lib/coins.ts arenaPriceUnit; 1 for ordinary coins, 1000 for 1000PEPE, 10000 for 10000SATS...). The Market Structure card's swings, break level and the line sent to the AI are prices, so they follow it on BOTH candle paths (Binance and Bybit). Volume is not a price.
 * WHAT RUNS: the REAL `load` body is cut out of components/MarketStructure.tsx, its types stripped, and run with the network, the setters and analyzeStructure stood in (analyzeStructure records the candles it was handed). Expected values come from the written rule and literal prices written here.
 *   M1  Bybit path (pepe, bonk): the candles handed to the analysis are in the exchange's 1000x unit: raw 3.8 stays 3.8 (not 0.0038 per token); high / low / open scale alike; volume untouched
 *   M2  Binance path, a 1000x symbol whose Arena unit equals its own denomination (floki): unchanged; and a coin the venues quote differently (sats: Binance 1000SATS, Bybit 10000SATS = the Arena unit): the Binance candles land in 10000x (raw 0.42 -> 4.2)
 *   M3  an ordinary coin on either path (btc, eth) is unchanged
 *   M4  the unit is applied once: pepe on Bybit is not scaled twice, and the same raw bar gives the same prices on the Bybit path and the Binance path for a coin both venues quote alike
 *   M5  the source still carries the factor at BOTH sites (a path left behind would be the original defect)
 * WHAT THIS CANNOT PROVE: the card on screen (the browser run after the next promotion). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { symbolDenominationFactor, arenaPriceUnit, binanceKlineSource, venueSymbols, BINANCE_SYMS } from '../lib/coins.ts';
import { fetchBybitKlinesRetry } from '../lib/bybitKlines.ts';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const src = readFileSync(new URL('../components/MarketStructure.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const OPEN = 'const load = useCallback(async () => {'; const CLOSE = '  }, [coin]);';
const a = src.indexOf(OPEN), z = src.indexOf(CLOSE, a); assert.ok(a > 0 && z > a, 'CONTROL: the load body was not found in components/MarketStructure.tsx');
const body = src.slice(a + OPEN.length, z);
const runner = new Function('coin', 'seen', 'net', 'setLoading', 'setErr', 'setData', 'cbRef', 'BINANCE_SYMS', 'venueSymbols', 'deadlineSignal', 'binanceKlineSource', 'fetchBybitKlinesRetry', 'analyzeStructure', 'symbolDenominationFactor', 'arenaPriceUnit', 'fetch', 'Error',
  `return async () => {${stripTypeScriptTypes(`async function _x() {${body}}`).replace(/^async function _x\(\) \{/, '').replace(/\}\s*$/, '')}};`);

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
const T0 = 1_700_000_000_000, H4 = 4 * 3_600_000;
/* the venues stood in: Bybit answers newest-first rows in ITS unit (exchange price), Binance answers oldest-first rows in ITS unit */
async function load(coin: string, o: { bybit?: number; binance?: number; bybitFail?: boolean; map?: Record<string, string> }) {
  const seen: { candles: Bar[] | null; err: string } = { candles: null, err: '' }; const net: string[] = [];
  const bars = (p: number, n = 5) => Array.from({ length: n }, (_, i) => [T0 + i * H4, p, p * 1.02, p * 0.98, p, 777]);
  const stubFetch = async (url: string) => { net.push(String(url).split('?')[1]?.slice(0, 60) ?? ''); return { ok: true, json: async () => bars(o.binance ?? 1) } as unknown as Response; };
  const stubBybit = async () => (o.bybitFail ? null : { result: { list: [...bars(o.bybit ?? 1)].reverse().map((r) => r.map(String)) } });
  await runner(coin, seen, net, () => undefined, (e: string) => { seen.err = e; }, () => undefined, { current: () => undefined }, o.map ?? BINANCE_SYMS, venueSymbols, () => undefined, binanceKlineSource, stubBybit as unknown as typeof fetchBybitKlinesRetry,
    (c: Bar[]) => { seen.candles = c; return null; }, symbolDenominationFactor, arenaPriceUnit, stubFetch, Error)();
  return { ...seen, net };
}
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

test('M1. Bybit path: 1000PEPE and 1000BONK candles are in the exchange unit, volume untouched', async () => {
  for (const [coin, px] of [['pepe', 3.8], ['bonk', 2.3]] as const) {
    assert.equal(BINANCE_SYMS[coin], undefined, `${coin} must be on the Bybit path (held out of the Binance map)`);
    const r = await load(coin, { bybit: px }); assert.equal(r.err, '', `${coin}: ${r.err}`); assert.ok(r.candles && r.candles.length === 5);
    for (const k of r.candles!) { assert.ok(near(k.c, px), `${coin} close ${k.c}`); assert.ok(near(k.o, px)); assert.ok(near(k.h, px * 1.02), `${coin} high ${k.h}`); assert.ok(near(k.l, px * 0.98)); assert.equal(k.v, 777, 'volume must not be scaled'); }
  }
});
test('M2. Binance path (the editorial map is stood in: today no mapped coin has a 1000x symbol, so the path is exercised through a stand-in map): floki unchanged; sats from Binance 1000SATS lands in the 10000SATS unit', async () => {
  const f = await load('floki', { binance: 0.07, map: { floki: '1000FLOKIUSDT' } }); assert.ok(f.candles!.every((k) => near(k.c, 0.07)), `floki ${f.candles![0].c}`); assert.equal(f.candles![0].v, 777);
  const s = await load('sats', { binance: 0.42, map: { sats: '1000SATSUSDT' } }); assert.ok(near(s.candles![0].c, 4.2), `sats (Binance 1000SATS 0.42 -> the 10000SATS unit): ${s.candles![0].c}`); assert.ok(near(s.candles![0].h, 4.2 * 1.02)); assert.equal(s.candles![0].v, 777, 'volume must not be scaled');
  const t = await load('tag', { binance: 0.0038, map: { tag: 'TAGUSDT' } }); assert.ok(near(t.candles![0].c, 3.8), `tag (Binance per token 0.0038 -> Bybit 1000TAG unit 3.8): ${t.candles![0].c}`);
});
test('M3. ordinary coins are unchanged on either path', async () => {
  const b = await load('btc', { binance: 71_234.5 }); assert.ok(near(b.candles![0].c, 71_234.5)); assert.ok(near(b.candles![0].h, 71_234.5 * 1.02));
  const e = await load('eth', { binance: 1_790.25 }); assert.ok(near(e.candles![0].c, 1_790.25));
});
test('M4. applied once: pepe on Bybit is not scaled twice, and a bar quoted alike on both paths gives the same prices', async () => {
  const bybitOnly = await load('pepe', { bybit: 3.8 }); assert.ok(near(bybitOnly.candles![0].c, 3.8), 'scaled twice or not at all');
  const viaBinance = await load('cat', { binance: 0.05, map: { cat: '1000CATUSDT' } }); const viaBybit = await load('cat', { bybit: 0.05 });
  assert.ok(near(viaBinance.candles![0].c, 0.05) && near(viaBybit.candles![0].c, 0.05), `cat: Binance path ${viaBinance.candles![0].c}, Bybit path ${viaBybit.candles![0].c} (both 1000CAT, unit 1000: unchanged)`);
});
test('M5. both candle paths carry the unit in the source', () => {
  assert.match(body, /const bf = symbolDenominationFactor\(binSym\) \* arenaPriceUnit\(coin\);[\s\S]*?\* bf/);
  assert.match(body, /const pf = symbolDenominationFactor\(bytSym\) \* arenaPriceUnit\(coin\);/);
  assert.equal((body.match(/arenaPriceUnit\(coin\)/g) ?? []).length, 2, 'one conversion per candle path');
});
