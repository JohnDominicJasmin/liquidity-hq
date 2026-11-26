/* QA: PR #2839 (#1651 owner item 95), RSI for every listed coin. The real fan-out runs against stand-in venues that answer every candle request.
 *   R1 every listed coin comes back with all six timeframes; only HYPE and the coins with no Binance spot symbol (PEPE, BONK, XAU) are asked at Bybit, each on all six, and the 1000x contracts by their own symbol
 *   R2 a coin the venue refuses leaves the others as they were
 *   R3 the Scanner shows "No data" for a missing 1h or 4h value only once the RSI read has landed */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BINANCE_SYMS, BYBIT_SYMS, COINS } from '../lib/coins.ts';
import { rsiGroups, mergeRsiGroups } from '../lib/marketRsi.ts';

const FIELDS = ['rsi5m', 'rsi1h', 'rsi4h', 'rsiDaily', 'rsiWeekly', 'rsiMonthly'];
const world = { refuse: '', bybit: [] as Array<{ symbol: string; interval: string }> };
const closes = (i: number) => 100 + (i % 7) + i / 50;
const realFetch = globalThis.fetch, realNow = Date.now;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.pathname.endsWith('/ping')) return ok({});
  const symbol = url.searchParams.get('symbol') ?? '', n = Number(url.searchParams.get('limit') ?? 120);
  const start = Date.now() - 400 * 86_400_000;
  if (url.host === 'api.bybit.com') {
    world.bybit.push({ symbol, interval: url.searchParams.get('interval') ?? '' });
    if (symbol === world.refuse) return ok({ retCode: 10001, retMsg: 'refused', result: {} });
    return ok({ retCode: 0, result: { list: Array.from({ length: n }, (_, i) => [String(start + i * 60_000), '1', '1', '1', String(closes(i)), '1', '1']).reverse() } });
  }
  if (url.host.includes('binance')) return ok(Array.from({ length: n }, (_, i) => [start + i * 60_000, '1', '1', '1', String(closes(i)), '1', start + i * 60_000 + 59_999, '1', 1, '1', '1', '0']));
  return new Response('stand-in: no such host', { status: 500 });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; Date.now = realNow; });
const read = async () => { const m = mergeRsiGroups(await rsiGroups(), true); assert.ok(m.ok, 'the merge failed'); return (m as { rsi: Record<string, Record<string, number>> }).rsi; };
const noSpot = COINS.filter((c) => !(BINANCE_SYMS as Record<string, string | undefined>)[c]);

test('R1. every coin answers, and only those without a Binance spot symbol (and HYPE) are asked at Bybit', async () => {
  for (const c of ['pepe', 'bonk', 'xau'] as const) assert.ok(noSpot.includes(c), `CONTROL: ${c} has no Binance spot symbol`);
  const rsi = await read();
  for (const coin of COINS) for (const f of FIELDS) assert.ok(Number.isFinite(rsi[coin]?.[f]), `${coin} ${f} is missing`);
  const want = [...new Set([...noSpot, 'hype' as const])].map((c) => BYBIT_SYMS[c]!).sort();
  assert.deepEqual([...new Set(world.bybit.map((r) => r.symbol))].sort(), want);
  for (const s of want) assert.deepEqual(world.bybit.filter((r) => r.symbol === s).map((r) => r.interval).sort(), ['240', '5', '60', 'D', 'M', 'W'], s);
  assert.equal(BYBIT_SYMS.pepe, '1000PEPEUSDT'); assert.equal(BYBIT_SYMS.bonk, '1000BONKUSDT');
});

test('R2. a refused coin leaves the others', async () => {
  world.refuse = BYBIT_SYMS.xau!; Date.now = () => realNow() + 40 * 86_400_000;
  const rsi = await read();
  assert.equal(rsi.xau?.rsi1h, undefined, 'a refused coin still shows a value');
  for (const coin of COINS.filter((c) => c !== 'xau')) assert.ok(Number.isFinite(rsi[coin]?.rsi1h), coin);
});

test('R3. "No data" only after the read has landed', () => {
  const s = readFileSync(new URL('../components/SetupScanner.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(s.includes('const rsiAnswered = COINS.some(id => store.coins[id]?.rsi1h != null);'));
  for (const f of ['rsi1h', 'rsi4h']) assert.ok(s.includes(`{(cd.${f} != null || rsiAnswered) && <div className="scan-stat">`) && s.includes(`{cd.${f} != null ? fmtRSI(cd.${f}) : t('ARENA_SCANNER_UNAVAILABLE_NARROW')}`), f);
  assert.equal(s.split('<CoinCard ').length - 1, s.split('rsiAnswered={rsiAnswered}').length - 1);
});
