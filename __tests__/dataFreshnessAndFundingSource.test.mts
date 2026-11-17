/* #2421: two honesty fixes. (1) The snapshot and funding-rate responses carry the DATA's fetch time, not the request time. (2) The funding page says when a coin's history is Bybit's because Binance could not supply it.
 *   T1-T3  lib/apiCache.cachedAt (REAL code, mocked clock): null when nothing is cached, the fetch time of the entry, not moved by a cache hit, moved by a refresh
 *   T4     lib/marketSnapshotData: the response's fetchedAt is the OLDEST of the fulfilled sections' cache times (anchor), null when none read
 *   T5     the two routes send ts = the data's age, falling back to now only when nothing is cached
 *   V1-V3  FundingTerminal: reads the route's viaFallback, marks a coin Bybit-sourced both when the route fell back and when the page's own Bybit fallback supplied it, shows the note only after loading with at least one such coin
 *   K1     the key has English text with {coins}
 * The note's rendering with Binance blocked is a browser cell. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cached, cachedAt } from '../lib/apiCache.ts';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (rel: string) => strip(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));

test('T1-T3. cachedAt is the FETCH time of the cached value: null before, unmoved by a hit, moved by a refresh', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_900_000_000_000 });
  assert.equal(cachedAt('qa:fresh:k1'), null, 'T1: a key nothing cached reads a time');
  await cached('qa:fresh:k1', 60_000, async () => 'v1');
  const t0 = cachedAt('qa:fresh:k1'); assert.equal(t0, 1_900_000_000_000, 'T2: not the fetch time');
  t.mock.timers.tick(30_000); await cached('qa:fresh:k1', 60_000, async () => 'v2');
  assert.equal(cachedAt('qa:fresh:k1'), t0, 'T2: a cache HIT moved the data time forward (3-minute-old numbers would look fresh)');
  t.mock.timers.tick(40_000); await cached('qa:fresh:k1', 60_000, async () => 'v3');
  assert.equal(cachedAt('qa:fresh:k1'), 1_900_000_000_000 + 70_000, 'T3: a refresh did not move the data time');
});

const SNAP = read('lib/marketSnapshotData.ts');
test('T4. fetchedAt is the OLDEST fulfilled section\'s cache time, and null when none was read', () => {
  assert.ok(SNAP.includes("['mkt:ticker', t], ['mkt:klines', k], ['mkt:lsr', l]"), 'CONTROL: the three sections moved');
  assert.ok(SNAP.includes(".filter(([, r]) => (r as PromiseSettledResult<unknown>).status === 'fulfilled')"), 'a failed section contributes a time');
  assert.ok(SNAP.includes('const fetchedAt = ages.length ? Math.min(...ages) : null;'), 'the response is not as old as its oldest part');
  assert.ok(SNAP.includes('data: { ticker, klines, lsr, partial, viaFallback, fetchedAt }'), 'fetchedAt is not returned');
});
test('T5. /api/market/snapshot and /api/market/funding-rate send the data\'s age and fall back to now only when nothing is cached', () => {
  assert.ok(read('app/api/market/snapshot/route.ts').includes('ts: fetchedAt ?? Date.now(),'), 'snapshot ts is the request time again');
  assert.ok(read('app/api/market/funding-rate/route.ts').includes('ts: cachedAt(`binance:funding-rate:${limit}`) ?? Date.now(),'), 'funding-rate ts is the request time again');
});

const FUND = read('components/FundingTerminal.tsx');
test('V1. the page reads the route\'s viaFallback and returns it with the series', () => {
  assert.ok(FUND.includes('const { data, viaFallback } = await res.json() as {') && FUND.includes('return { out, via: viaFallback ?? [] };'), 'viaFallback is not read');
  assert.ok(FUND.includes('if (!res.ok) return { out: {}, via: [] };') && FUND.includes('} catch { return { out: {}, via: [] }; }'), 'the failure paths lost their shape');
});
test('V2. a coin is marked Bybit-sourced when the route fell back to Bybit for its Binance symbol AND when the page\'s own Bybit fallback supplied it; a coin with no data is not marked', () => {
  /* progressive paint (#2471): the Binance batch is marked in the loop, each Bybit fallback coin is marked as it arrives */
  assert.ok(FUND.includes('if (pts.length) { first[id] = pts; if (binSym && via.includes(binSym)) fromBybit.add(id); }'), 'the route-fallback case is not marked (or an empty result is)');
  assert.ok(FUND.includes('if (!cancelled && pts.length) { setHistory(prev => ({ ...prev, [id]: pts })); setBybitCoins(prev => (prev.includes(id) ? prev : [...prev, id])); }'), 'the page-fallback case is not marked, marked twice, or an empty result is');
  assert.ok(FUND.includes('setBybitCoins([...fromBybit]);'), 'the marked coins are not kept');
});
test('V3. the note shows only after loading, only with at least one such coin, names the coins, and never blanks the data', () => {
  assert.ok(FUND.includes('{!loading && bybitCoins.length > 0 && ('), 'the note is not limited to a loaded page with Bybit coins');
  assert.ok(FUND.includes("t('FUNDING_VIA_BYBIT_NOTE', { coins: bybitCoins.map(c => COIN_LABELS[c] ?? c.toUpperCase()).join(', ') })"), 'the note does not name the coins');
  assert.ok(FUND.includes('data-testid="funding-via-bybit"'), 'the test id is gone');
});
test('K1. FUNDING_VIA_BYBIT_NOTE has English text with {coins} and says it is Bybit\'s', () => {
  const en = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
  assert.match(en.FUNDING_VIA_BYBIT_NOTE ?? '', /\{coins\}/); assert.match(en.FUNDING_VIA_BYBIT_NOTE, /Bybit/);
});
