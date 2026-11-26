/* PR #2578 - /funding: the Bybit-only coins' history (PEPE, BONK, XAU) is requested beside the Binance batch, not after it.
 * The effect body is SLICED from components/FundingTerminal.tsx and run with controlled stand-ins for the two fetchers and the three setters, so the
 * order of requests and of state writes is observable. REAL maps (BINANCE_SYMS / BYBIT_SYMS) are used so "which coins are Bybit-only" is not assumed.
 *
 * PROVES: (1) the Bybit-only requests are all SENT before the Binance batch answers; (2) each is sent exactly once; (3) each answer lands on its OWN
 * coin; (4) state is written only AFTER the batch (setHistory(first) first, merges on top, bybitCoins tagged only for a coin that has points);
 * (5) an empty/failed Bybit answer writes nothing and tags nothing; (6) unmount before the batch answers or before a request answers writes nothing;
 * (7) a coin Binance lists but returned nothing for is fetched from Bybit once, after the batch, never early.
 * DOES NOT PROVE: the network timing on a phone (a measurement), or what the sparkline renders. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
const fund = readFileSync(new URL('../components/FundingTerminal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const { COINS, BINANCE_SYMS, BYBIT_SYMS } = await import('../lib/marketStore.ts') as { COINS: string[]; BINANCE_SYMS: Record<string, string>; BYBIT_SYMS: Record<string, string> };

const startAt = fund.lastIndexOf('let cancelled = false;', fund.indexOf('THE TABLE PAINTS FROM THE MARKET SNAPSHOT'));
const endMark = 'return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };';
const endAt = fund.indexOf(endMark, startAt);
assert.ok(startAt > 0 && endAt > startAt, 'CONTROL: the funding history effect was not found');
const HEAD = 'function effect() {', TAIL = '\n}';
const stripped = stripTypeScriptTypes(HEAD + fund.slice(startAt, endAt + endMark.length) + TAIL);
const body = stripped.slice(stripped.indexOf(HEAD) + HEAD.length, stripped.lastIndexOf('}'));
type Pt = { rate: number; ts: number };
type Setters = { setHistory: (u: unknown) => void; setBybitCoins: (u: unknown) => void; setLoading: (v: boolean) => void };
/* #2680: the effect now retries while no coin has history; its timers are stand-ins here (the retry schedule is pinned in marketsFailureText2680), so nothing is left pending */
const FR_RETRY_MS = [5_000, 15_000, 45_000, 120_000];
const timers: Array<{ ms: number; fn: () => void }> = [];
const fakeSetTimeout = (fn: () => void, ms: number) => { timers.push({ ms, fn }); return timers.length; };
const fakeClearTimeout = () => undefined;
const make0 = new Function('COINS', 'BINANCE_SYMS', 'BYBIT_SYMS', 'fetchBybitFR', 'fetchAllBinanceFR', 'setHistory', 'setBybitCoins', 'setLoading', 'FR_RETRY_MS', 'setTimeout', 'clearTimeout', body) as unknown as
  (...a: unknown[]) => () => void;
const make = (...a: unknown[]) => make0(...a, FR_RETRY_MS, fakeSetTimeout, fakeClearTimeout);

const ALL_BINANCE: Record<string, { rate: number; ts: number }[]> = Object.fromEntries(Object.values(BINANCE_SYMS).map(sym => [sym, [{ rate: 0.0001, ts: 1 }, { rate: 0.0002, ts: 2 }]]));
const BYBIT_ONLY = COINS.filter(id => !BINANCE_SYMS[id] && BYBIT_SYMS[id]);
const tick = () => new Promise<void>(r => setImmediate(r));
const pts = (n: number): Pt[] => Array.from({ length: 3 }, (_, i) => ({ rate: n + i / 1000, ts: 1000 + i }));

function rig(opts: { binance?: Record<string, Pt[]>; via?: string[] } = {}) {
  const log: string[] = [];
  const sent: string[] = [];
  const bybit = new Map<string, { resolve: (p: Pt[]) => void }>();
  let releaseBatch!: () => void;
  const batchGate = new Promise<void>(r => { releaseBatch = r; });
  let history: Record<string, Pt[]> = {};
  let tags: string[] = [];
  const apply = <T,>(prev: T, u: unknown): T => (typeof u === 'function' ? (u as (p: T) => T)(prev) : (u as T));
  const setters: Setters = {
    setHistory: u => { history = apply(history, u); log.push('setHistory:' + Object.keys(history).sort().join(',')); },
    setBybitCoins: u => { tags = apply(tags, u); log.push('setBybitCoins:' + tags.join(',')); },
    setLoading: v => { log.push('setLoading:' + v); },
  };
  const fetchBybitFR = (sym: string) => new Promise<Pt[]>(resolve => { sent.push(sym); log.push('bybit-sent:' + sym); bybit.set(sym, { resolve }); });
  const fetchAllBinanceFR = async () => { log.push('batch-sent'); await batchGate; log.push('batch-answered'); return { out: opts.binance ?? {}, via: opts.via ?? [] }; };
  const cleanup = make(COINS, BINANCE_SYMS, BYBIT_SYMS, fetchBybitFR, fetchAllBinanceFR, setters.setHistory, setters.setBybitCoins, setters.setLoading);
  return { log, sent, bybit, releaseBatch, cleanup, get history() { return history; }, get tags() { return tags; } };
}

test('harness check: the real Bybit-only coins are PEPE, BONK, XAU', () => {
  assert.deepEqual([...BYBIT_ONLY].sort(), ['bonk', 'pepe', 'xau']);
});

test('(1)(2) all three Bybit-only requests are sent before the Binance batch answers, once each', async () => {
  const r = rig({ binance: ALL_BINANCE });
  await tick();
  const sentSyms = BYBIT_ONLY.map(id => BYBIT_SYMS[id]).sort();
  assert.deepEqual([...r.sent].sort(), sentSyms, `requests sent before the batch answered: ${r.log.join(' | ')}`);
  assert.ok(r.log.indexOf('batch-answered') === -1, 'harness check: the batch must still be pending');
  r.releaseBatch(); await tick(); await tick();
  assert.deepEqual([...r.sent].sort(), sentSyms, 'a Bybit-only coin was requested a second time after the batch');
  r.cleanup();
});

test('(3)(4)(5) each answer lands on its own coin; state is written only after the batch; an empty answer writes and tags nothing', async () => {
  const r = rig({ binance: { BTCUSDT: pts(1) } });
  await tick();
  for (const id of ['pepe', 'bonk']) r.bybit.get(BYBIT_SYMS[id])!.resolve(pts(id === 'pepe' ? 5 : 7));   // answers arrive BEFORE the batch
  r.bybit.get(BYBIT_SYMS['xau'])!.resolve([]);
  await tick(); await tick();
  assert.deepEqual(r.log.filter(l => l.startsWith('setHistory') || l.startsWith('setBybitCoins') || l === 'setLoading:false'), [], 'state was written before the batch answered');
  r.releaseBatch(); await tick(); await tick(); await tick();
  const firstWrite = r.log.findIndex(l => l.startsWith('setHistory'));
  assert.ok(firstWrite > r.log.indexOf('batch-answered'), 'setHistory ran before the batch');
  assert.ok(r.history['btc'], 'the Binance batch rows must be applied');
  assert.equal(r.history['pepe']?.[0].rate, 5, 'PEPE got another coin\'s history');
  assert.equal(r.history['bonk']?.[0].rate, 7, 'BONK got another coin\'s history');
  assert.equal(r.history['xau'], undefined, 'an empty Bybit answer must write no history');
  assert.deepEqual([...r.tags].sort(), ['bonk', 'btc', 'pepe'], 'bybitCoins must hold the coins whose Bybit points arrived: the batch row (Bybit since #2812) and the two early ones; XAU came back empty');
  assert.ok(r.history['btc'], 'the batch rows must survive the merges (a merge must not clobber `first`)');
  r.cleanup();
});

test('(5) a batch coin named in `via` is from Binance and is not tagged; the other batch coin is, and a late Bybit-only coin is added, not replacing it', async () => {
  const r = rig({ binance: { ETHUSDT: pts(2), SOLUSDT: pts(4) }, via: ['ETHUSDT'] });
  await tick(); r.releaseBatch(); await tick(); await tick();
  r.bybit.get(BYBIT_SYMS['pepe'])!.resolve(pts(9)); await tick(); await tick();
  assert.deepEqual([...r.tags].sort(), ['pepe', 'sol']);
  r.cleanup();
});

test('(6) unmount before the batch answers: nothing is written, nothing throws', async () => {
  const r = rig();
  await tick(); r.cleanup();
  r.releaseBatch(); for (const s of r.sent) r.bybit.get(s)!.resolve(pts(3));
  await tick(); await tick(); await tick();
  assert.deepEqual(r.log.filter(l => l.startsWith('set')), []);
});

test('(6) unmount after the batch, before the Bybit answers: nothing more is written', async () => {
  const r = rig({ binance: { BTCUSDT: pts(1) } });
  await tick(); r.releaseBatch(); await tick(); await tick();
  const before = r.log.filter(l => l.startsWith('set')).length;
  r.cleanup();
  for (const s of r.sent) r.bybit.get(s)!.resolve(pts(3));
  await tick(); await tick();
  assert.equal(r.log.filter(l => l.startsWith('set')).length, before, 'a Bybit answer wrote state after unmount');
});

test('(7) a coin Binance LISTS but returned nothing for is fetched from Bybit once, after the batch (not early)', async () => {
  const r = rig({ binance: { BTCUSDT: pts(1) } });          // ETH, SOL ... listed on Binance but absent from the answer -> fall back to Bybit
  await tick();
  const earlySyms = r.sent.slice();
  assert.deepEqual([...earlySyms].sort(), BYBIT_ONLY.map(id => BYBIT_SYMS[id]).sort(), 'only Bybit-only coins may be requested before the batch');
  r.releaseBatch(); await tick(); await tick(); await tick();
  const wanted = COINS.filter(id => id !== 'btc' && BYBIT_SYMS[id]).map(id => BYBIT_SYMS[id]);
  assert.deepEqual([...new Set(r.sent)].sort(), [...new Set(wanted)].sort(), 'every coin with no Binance history must be asked of Bybit');
  assert.equal(r.sent.length, new Set(r.sent).size, 'a coin was requested twice');
  r.cleanup();
});
