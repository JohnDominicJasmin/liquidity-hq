/* QA pins for PR #2571: the exchange breaker's cooldown survives a restart (lib/exchangeGuard.ts + lib/exchangeBreakerStore.ts).
 *
 * WHAT RUNS: the REAL guard and the REAL pure helpers (parseBreakerSnapshot, mergeBreakerState). The database is a fake in-memory store
 * installed with _setExchangeBreakerStore, so NOTHING touches a database or the network: fetch is a counting stand-in and the clock is
 * Node's mocked Date. "A restart" is _resetExchangeGuard() (memory forgotten, saved row kept) or, for X-tests, a second copy of the guard
 * module loaded with the globals cleared. Expected numbers are written out (10 min = 600_000, 6 h = 21_600_000), never read from a constant.
 *
 *   S1-S4  restart survival      M1-M6  merge rules (pure + through the guard)      W1-W6  write discipline / failing store
 *   C1-C2  corrupt rows          D1     row content                                 X1-X3  two instances */
import test, { afterEach, beforeEach, mock } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);
mock.timers.enable({ apis: ['Date'], now: T0 });
const tick = (ms: number) => mock.timers.tick(ms);
const MIN = 60_000, H = 60 * MIN;

const guard = await import('../lib/exchangeGuard.ts');
const bstore = await import('../lib/exchangeBreakerStore.ts');
const g = globalThis as Record<string, unknown>;

/* ── stand-in network ─────────────────────────────────────────────────── */
type Answer = { status: number; retryAfter?: string; delay?: number };
const net = { binance: 0, bybit: 0, other: 0, answer: { status: 200 } as Answer, script: null as null | ((host: string, n: number) => Answer) };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const host = url.host.includes('binance') ? 'binance' : url.host.includes('bybit') ? 'bybit' : 'other';
  const n = ++net[host];
  const a = net.script ? net.script(host, n) : net.answer;
  for (let i = 0; i < (a.delay ?? 0); i++) await new Promise((r) => setImmediate(r));
  return new Response('SECRET-BODY-TEXT {"code":-1003,"msg":"Too many requests; request weight"}', { status: a.status, headers: a.retryAfter != null ? { 'retry-after': a.retryAfter } : {} });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });

/* ── fake store ───────────────────────────────────────────────────────── */
function fake(row?: unknown) {
  const s = {
    row, loads: 0, saves: 0, writes: [] as unknown[], failLoads: 0, loadMode: 'ok' as 'ok' | 'throw' | 'hang', saveMode: 'ok' as 'ok' | 'throw' | 'hang', saveDelay: 2,
    async load() {
      s.loads++;
      if (s.loadMode === 'hang') return new Promise<never>(() => {});
      if (s.loadMode === 'throw' || s.failLoads-- > 0) throw new Error('db down');
      await new Promise((r) => setImmediate(r));
      return bstore.parseBreakerSnapshot(s.row);
    },
    async save(snap: unknown) {
      s.saves++;
      if (s.saveMode === 'hang') return new Promise<never>(() => {});
      for (let i = 0; i < s.saveDelay; i++) await new Promise((r) => setImmediate(r));
      if (s.saveMode === 'throw') throw new Error('db write refused');
      s.row = JSON.parse(JSON.stringify(snap)); s.writes.push(s.row);
    },
  };
  return s;
}
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
let store = fake();
const use = (s: ReturnType<typeof fake>) => { store = s; guard._setExchangeBreakerStore(s as never); return s; };
beforeEach(() => { mock.timers.setTime(T0); });
afterEach(() => { guard._resetExchangeGuard(); guard._setExchangeBreakerStore(undefined); net.binance = net.bybit = net.other = 0; net.answer = { status: 200 }; net.script = null; });

const BN = 'https://api.binance.com/api/v3/ticker/24hr', BB = 'https://api.bybit.com/v5/market/tickers';
const coolMs = (ex: 'binance' | 'bybit' = 'binance') => { const c = guard.exchangeCoolingDown(ex); return c ? c.until - Date.now() : 0; };
const call = (url: string) => guard.exchangeFetch(url).then((r: Response) => `ok${r.status}`, (e: Error) => e.message);

/* ── S: restart survival ──────────────────────────────────────────────── */
test('S1. a Binance 418 (no Retry-After) is saved; after a restart the first Binance call is refused with NO network call; Bybit is unaffected; calls resume when the saved stop passes', async () => {
  use(fake());
  net.answer = { status: 418 };
  assert.equal(await call(BN), 'ok418'); await flush();
  assert.equal(net.binance, 1);
  assert.equal(store.saves >= 1, true, 'the trip was not saved');
  assert.deepEqual(store.row, { binance: { openUntil: T0 + 600_000, strikes: 1, lastTripAt: T0 } });

  guard._resetExchangeGuard(); net.binance = 0; net.answer = { status: 200 };           // the restart
  assert.equal(coolMs(), 0, 'memory was not actually forgotten (the test is not simulating a restart)');
  assert.equal(await call(BN), 'binance: cooling down'); assert.equal(net.binance, 0, 'the first call after the restart reached Binance');
  assert.equal(coolMs(), 600_000);
  assert.equal(await call(BB), 'ok200'); assert.equal(net.bybit, 1, 'Bybit was held by a Binance ban');
  tick(599_999); assert.equal(await call(BN), 'binance: cooling down'); assert.equal(net.binance, 0);
  tick(1); assert.equal(await call(BN), 'ok200'); assert.equal(net.binance, 1, 'calls did not resume when the saved stop passed');
});

test('S2. a 429 WITHOUT Retry-After is saved the same way', async () => {
  use(fake()); net.answer = { status: 429 };
  await call(BN); await flush();
  assert.deepEqual(store.row, { binance: { openUntil: T0 + 600_000, strikes: 1, lastTripAt: T0 } });
});

test('S3. a REAL fresh process: a second copy of the guard module with every global cleared still honours the saved ban', async () => {
  use(fake()); net.answer = { status: 418 }; await call(BN); await flush();
  delete g.__lhqExchangeGuard; delete g.__lhqExchangeBreakerSync;                       // a new process has neither
  const fresh = await import(`../lib/exchangeGuard.ts?fresh=${'s3'}`);
  assert.equal(fresh.exchangeCoolingDown('binance'), null, 'fresh instance should start with nothing in memory');
  net.binance = 0; net.answer = { status: 200 };
  await assert.rejects(() => fresh.exchangeFetch(BN), /cooling down/); assert.equal(net.binance, 0);
  assert.equal(fresh.exchangeCoolingDown('binance')!.until, T0 + 600_000);
});

test('S4. a saved ban longer than the first one (strikes 2 in the hour = 20 min) restores to the exact stop, and the strike count is restored', async () => {
  use(fake()); net.answer = { status: 418 };
  await call(BN); await flush(); tick(600_000); await call(BN); await flush();          // second trip inside an hour: 20 min
  assert.deepEqual(store.row, { binance: { openUntil: T0 + 600_000 + 1_200_000, strikes: 2, lastTripAt: T0 + 600_000 } });
  guard._resetExchangeGuard(); net.answer = { status: 200 }; net.binance = 0;
  assert.equal(await call(BN), 'binance: cooling down');
  assert.equal(coolMs(), 1_200_000);
  const st = guard._exchangeGuardStats() as Record<string, { strikes: number }>; assert.equal(st.binance.strikes, 2);
});

/* ── M: merge rules ───────────────────────────────────────────────────── */
const E = (openUntil: number, strikes = 1, lastTripAt = 0) => ({ openUntil, strikes, lastTripAt });
test('M1. (pure) a saved stop that already passed, or is exactly now, is dropped', () => {
  assert.deepEqual(bstore.mergeBreakerState({}, { binance: E(T0 - 1) }, T0), {});
  assert.deepEqual(bstore.mergeBreakerState({}, { binance: E(T0) }, T0), {});
  assert.deepEqual(bstore.mergeBreakerState({}, { binance: E(T0 + 1) }, T0), { binance: E(T0 + 1, 1, 0) });
});
test('M2. (pure) a saved stop 10 h away is capped to exactly 6 h from now; exactly 6 h and 5 h 59 min are kept as they are', () => {
  assert.equal(bstore.mergeBreakerState({}, { binance: E(T0 + 10 * H) }, T0).binance!.openUntil, T0 + 21_600_000);
  assert.equal(bstore.mergeBreakerState({}, { binance: E(T0 + 6 * H) }, T0).binance!.openUntil, T0 + 21_600_000);
  assert.equal(bstore.mergeBreakerState({}, { binance: E(T0 + 6 * H - MIN) }, T0).binance!.openUntil, T0 + 21_600_000 - 60_000);
});
test('M3. (pure) the LATER of memory and saved wins, both ways round; strikes and lastTripAt take the higher value; an expired side is ignored', () => {
  assert.equal(bstore.mergeBreakerState({ binance: E(T0 + 5 * MIN, 1, 10) }, { binance: E(T0 + 30 * MIN, 3, 5) }, T0).binance!.openUntil, T0 + 30 * MIN);
  const m = bstore.mergeBreakerState({ binance: E(T0 + 30 * MIN, 1, 10) }, { binance: E(T0 + 5 * MIN, 3, 5) }, T0).binance!;
  assert.deepEqual(m, E(T0 + 30 * MIN, 3, 10));
  assert.equal(bstore.mergeBreakerState({ binance: E(T0 - 5, 9, 99) }, { binance: E(T0 + 7 * MIN, 1, 1) }, T0).binance!.strikes, 1, 'an expired side leaked its strikes');
  assert.deepEqual(bstore.mergeBreakerState({ bybit: E(T0 + MIN) }, { binance: E(T0 + 2 * MIN) }, T0), { bybit: E(T0 + MIN, 1, 0), binance: E(T0 + 2 * MIN, 1, 0) });
});
test('M4. through the guard: a saved 10 h stop is refused and capped at 6 h from now; a saved expired stop lets the call through', async () => {
  use(fake({ binance: { openUntil: T0 + 10 * H, strikes: 1, lastTripAt: T0 } }));
  assert.equal(await call(BN), 'binance: cooling down'); assert.equal(net.binance, 0); assert.equal(coolMs(), 21_600_000);
  guard._resetExchangeGuard(); use(fake({ binance: { openUntil: T0 - 1, strikes: 1, lastTripAt: T0 - 600_000 } }));
  assert.equal(await call(BN), 'ok200'); assert.equal(net.binance, 1); assert.equal(coolMs(), 0);
});
test('M5. a trip while a LATER stop is saved (another instance) adopts the later one and keeps it saved; a trip while an EARLIER one is saved saves the later', async () => {
  use(fake()); net.answer = { status: 200 };
  await call(BN); await flush();                                                    // hydrated, nothing banned
  store.row = { binance: E(T0 + 30 * MIN, 2, T0) };                                  // another instance banned for 30 min meanwhile
  net.answer = { status: 429 }; await call(BN); await flush();                        // our own 10-min trip
  assert.equal(coolMs(), 30 * MIN, 'memory kept its own shorter stop instead of the later saved one');
  assert.equal((store.row as { binance: { openUntil: number } }).binance.openUntil, T0 + 30 * MIN, 'the saved later stop was overwritten by the shorter');
  guard._resetExchangeGuard(); use(fake());
  net.answer = { status: 200 }; await call(BN); await flush(); store.row = { binance: E(T0 + 5 * MIN, 1, T0) };
  net.answer = { status: 418 }; await call(BN); await flush();
  assert.equal((store.row as { binance: { openUntil: number } }).binance.openUntil, T0 + 600_000, 'the later in-memory stop was not saved');
});
test('M6. a short Retry-After 429 (5 s, 7 s, 10 s) after a SAVED 10-minute ban does not shorten it (saved row unreadable at first, then readable)', async () => {
  for (const ra of ['5', '7', '10']) {
    guard._resetExchangeGuard(); net.binance = 0;
    const s = use(fake({ binance: { openUntil: T0 + 600_000, strikes: 1, lastTripAt: T0 } })); s.failLoads = 1;   // the boot read fails, so the call goes through
    net.answer = { status: 429, retryAfter: ra };
    assert.equal(await call(BN), 'ok429'); await flush();
    assert.equal(net.binance, 1);
    assert.equal(coolMs(), 600_000, `Retry-After ${ra} shortened the saved ban to ${coolMs()} ms`);
    assert.equal((s.row as { binance: { openUntil: number } }).binance.openUntil, T0 + 600_000, 'the saved ban was shortened in the row');
  }
});
test('M6b. a short Retry-After 429 that comes back AFTER a 10-minute 418 (either order, in flight together) does not shorten the in-memory stop', async () => {
  for (const order of ['418-first', '429-first']) {
    guard._resetExchangeGuard(); net.binance = 0; use(fake());
    net.script = (_h, n) => (order === '418-first' ? (n === 1 ? { status: 418, delay: 1 } : { status: 429, retryAfter: '7', delay: 6 }) : (n === 1 ? { status: 418, delay: 6 } : { status: 429, retryAfter: '7', delay: 1 }));
    await Promise.all([call(BN), call(BN)]); await flush();
    assert.equal(net.binance, 2);
    /* 418-first: one trip, 10 min. 429-first: the 7 s trip counts as strike 1, so the 418 behind it is strike 2 = 20 min (the pre-existing strike rule, same on dev). Either way the stop is NEVER shorter than the 10-minute ban. */
    assert.equal(coolMs(), order === '418-first' ? 600_000 : 1_200_000, order);
  }
});

/* ── W: write discipline and a failing store ──────────────────────────── */
test('W1. a burst of 20 concurrent refusals (same 418) writes at most 2 times', async () => {
  use(fake()); net.answer = { status: 418, delay: 1 };
  const r = await Promise.all(Array.from({ length: 20 }, () => call(BN))); await flush();
  assert.equal(r.filter((x) => x === 'ok418').length + r.filter((x) => x === 'binance: cooling down').length, 20);
  assert.equal(store.saves <= 2, true, `writes: ${store.saves}`); assert.equal(store.saves >= 1, true);
});
test('W2. a burst that arrives together and where each answer LENGTHENS the stop (8 different Retry-Afters) is coalesced to at most 2 writes', async () => {
  use(fake()); net.script = (_h, n) => ({ status: 429, retryAfter: String(10 * n), delay: 1 });
  await Promise.all(Array.from({ length: 8 }, () => call(BN))); await flush(60);
  assert.equal(coolMs() > 0, true);
  assert.equal(store.saves <= 2, true, `writes: ${store.saves}`);
  assert.equal((store.row as { binance: { openUntil: number } }).binance.openUntil, T0 + 80_000, 'the last (longest) stop was not what ended up saved');
});
test('W3. a store whose save THROWS never throws out of exchangeFetch, and the next trip saves again', async () => {
  use(fake()); store.saveMode = 'throw'; net.answer = { status: 418 };
  assert.equal(await call(BN), 'ok418'); await flush(); assert.equal(store.saves, 1); assert.equal(coolMs(), 600_000);
  store.saveMode = 'ok'; tick(600_000); assert.equal(await call(BN), 'ok418'); await flush();   // strike 2 (20 min)
  assert.equal(store.saves, 2); assert.equal((store.row as { binance: { openUntil: number } }).binance.openUntil, T0 + 600_000 + 1_200_000);
});
test('W4. a store whose LOAD throws: the first call is not blocked or thrown, the call goes through, and a later call (60 s on) retries the read in the background', async () => {
  const s = use(fake({ binance: { openUntil: T0 + 600_000, strikes: 1, lastTripAt: T0 } })); s.loadMode = 'throw';
  assert.equal(await call(BN), 'ok200'); assert.equal(net.binance, 1); assert.equal(s.loads, 1);
  assert.equal(await call(BN), 'ok200'); assert.equal(s.loads, 1, 'retried before the 60 s retry interval');
  s.loadMode = 'ok'; tick(60_000); assert.equal(await call(BN), 'ok200'); await flush();          // this call is not blocked; the read happens behind it
  assert.equal(s.loads, 2, 'no background retry after 60 s');
  assert.equal(await call(BN), 'binance: cooling down', 'the retried read did not apply the saved ban');
});
test('W5. a store whose LOAD HANGS FOREVER: the first call waits at most ~2 s (real), proceeds to the network, never throws', async () => {
  const s = use(fake()); s.loadMode = 'hang';
  const t = process.hrtime.bigint(); const out = await call(BN); const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.equal(out, 'ok200'); assert.equal(net.binance, 1);
  assert.equal(ms >= 1_900 && ms < 3_000, true, `waited ${ms} ms`);
});
test('W5b. after the 2 s wait, further calls are NOT held again (mocked clock moved on)', async () => {
  const s = use(fake()); s.loadMode = 'hang';
  await call(BN); tick(2_000);
  const t = process.hrtime.bigint(); assert.equal(await call(BN), 'ok200'); assert.equal(Number(process.hrtime.bigint() - t) / 1e6 < 500, true);
});
test('W6. a hung LOAD is retried later (once the hung read is abandoned a new one is started after 60 s)', async () => {
  const s = use(fake({ binance: { openUntil: T0 + 600_000, strikes: 1, lastTripAt: T0 } })); s.loadMode = 'hang';
  await call(BN); tick(2_000); s.loadMode = 'ok'; tick(60_000);
  await call(BN); await flush();
  assert.equal(s.loads >= 2, true, `loads: ${s.loads} (a hung read blocks every later read for the life of the process)`);
});

test('W2b. DOCUMENTS the limit: answers that each lengthen the stop but arrive SPREAD OVER several saves cost one write per save in flight, not 2 per burst (8 answers -> fewer writes than answers, final row = the longest)', async () => {
  use(fake()); net.script = (_h, n) => ({ status: 429, retryAfter: String(10 * n), delay: n });
  await Promise.all(Array.from({ length: 8 }, () => call(BN))); await flush(60);
  assert.equal(store.saves < 8, true, `writes: ${store.saves}`); assert.equal((store.row as { binance: { openUntil: number } }).binance.openUntil, T0 + 80_000);
  console.log('W2b spread burst writes =', store.saves);
});
test('W7. a save that HANGS forever does not block calls, but must not stop later trips from ever saving again', async () => {
  const s = use(fake()); s.saveMode = 'hang'; net.answer = { status: 418 };
  assert.equal(await call(BN), 'ok418'); await flush(); assert.equal(s.saves, 1);
  s.saveMode = 'ok'; tick(600_000); await call(BN); await flush();
  assert.equal(s.saves >= 2, true, `saves: ${s.saves} (the hung write holds the saving flag for the life of the process)`);
});

/* ── C: corrupt rows ──────────────────────────────────────────────────── */
const BAD: Array<[string, unknown]> = [
  ['null', null], ['a string', 'binance'], ['a number', 42], ['an array', [1, 2]], ['undefined', undefined], ['true', true],
  ['entry null', { binance: null }], ['entry a string', { binance: 'x' }], ['entry empty object', { binance: {} }],
  ['negative openUntil', { binance: { openUntil: -5, strikes: 1, lastTripAt: 1 } }], ['zero openUntil', { binance: { openUntil: 0 } }],
  ['NaN openUntil', { binance: { openUntil: NaN } }], ['Infinity openUntil', { binance: { openUntil: Infinity } }],
  ['string openUntil', { binance: { openUntil: String(T0 + 600_000) } }], ['object openUntil', { binance: { openUntil: { a: 1 } } }],
  ['unknown exchange', { kraken: { openUntil: T0 + 600_000 }, 'api.binance.com': { openUntil: T0 + 600_000 } }],
  ['__proto__ key', JSON.parse('{"__proto__":{"openUntil":' + (T0 + 600_000) + '},"binance":{"openUntil":-1}}')],
  ['expired', { binance: { openUntil: T0 - 1 } }],
];
test('C1. a corrupt or irrelevant row is ignored: no throw, no refusal, the call reaches the network, no breaker opens', async () => {
  for (const [name, row] of BAD) {
    guard._resetExchangeGuard(); net.binance = 0; net.bybit = 0; use(fake(row));
    assert.equal(await call(BN), 'ok200', name); assert.equal(net.binance, 1, name); assert.equal(await call(BB), 'ok200', name);
    for (const ex of ['binance', 'bybit', 'okx', 'hyperliquid'] as const) assert.equal(guard.exchangeCoolingDown(ex), null, `${name}: ${ex} breaker opened`);
  }
});
test('C2. a valid entry with extra keys / bad strikes keeps the ban but never takes the bad value: strikes -> 0, bad lastTripAt -> 0, extras dropped; a huge openUntil is capped at 6 h', async () => {
  assert.deepEqual(bstore.parseBreakerSnapshot({ binance: { openUntil: T0 + 600_000, strikes: 'many', lastTripAt: -1, secret: 'x' }, bybit: { openUntil: 5.5, strikes: 2.9 } }),
    { binance: { openUntil: T0 + 600_000, strikes: 0, lastTripAt: 0 }, bybit: { openUntil: 5.5, strikes: 2, lastTripAt: 0 } });
  use(fake({ binance: { openUntil: 1e18, strikes: 1, lastTripAt: T0 } }));
  assert.equal(await call(BN), 'binance: cooling down'); assert.equal(coolMs(), 21_600_000);
});
test('C3. lastTripAt far in the future (a hand-edited row) never throws out of exchangeFetch', async () => {
  use(fake({ binance: { openUntil: T0 + 600_000, strikes: 1, lastTripAt: 1e17 } }));
  assert.equal(await call(BN), 'binance: cooling down'); await flush(); assert.equal(coolMs(), 600_000);
});

test('C4. a row that makes the restore throw internally (lastTripAt 1e17) is not re-read every minute forever', async () => {
  const s = use(fake({ binance: { openUntil: T0 + 600_000, strikes: 1, lastTripAt: 1e17 } }));
  await call(BN); await flush(); tick(60_000); await call(BN); await flush(); tick(60_000); await call(BN); await flush();
  assert.equal(s.loads, 1, `loads: ${s.loads}`);
});

/* ── D: what the row holds ────────────────────────────────────────────── */
test('D1. the saved row has only exchange names and { openUntil, strikes, lastTripAt } numbers: no body text, headers or URL', async () => {
  use(fake()); net.answer = { status: 418, retryAfter: '120' }; await call(BN); await flush();
  net.answer = { status: 429 }; await call(BB); await flush();
  const row = store.row as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(row).sort(), ['binance', 'bybit']);
  for (const e of Object.values(row)) { assert.deepEqual(Object.keys(e).sort(), ['lastTripAt', 'openUntil', 'strikes']); for (const v of Object.values(e)) assert.equal(typeof v, 'number'); }
  assert.equal(/SECRET|1003|retry|https?:|api\./i.test(JSON.stringify(row)), false, JSON.stringify(row));
});
test('D2. (source) the store is written with the SERVICE client only: no anon client, no deadline on the write, key is exchange_breaker', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../lib/exchangeBreakerStore.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(src, /getSupabaseAdmin/); assert.doesNotMatch(src, /getSupabase\(|supabase\.ts|NEXT_PUBLIC_SUPABASE_ANON/);
  assert.equal(bstore.BREAKER_CONFIG_KEY, 'exchange_breaker');
  assert.equal((src.match(/getSupabaseAdmin\(\)\.from/g) || []).length, 1, 'the save uses getSupabaseAdmin() (no deadline) once');
});

test('C5. (pure) parseBreakerSnapshot itself drops NaN, Infinity, negative, zero and non-number openUntil (not only the merge afterwards)', () => {
  for (const v of [NaN, Infinity, -Infinity, -5, 0, '600000', null, {}, [5]]) assert.deepEqual(bstore.parseBreakerSnapshot({ binance: { openUntil: v, strikes: 1, lastTripAt: 1 } }), {}, String(v));
});
test('D3. an expired cooldown is not carried into the next write: Binance tripped, 11 minutes later Bybit trips; the row holds Bybit only', async () => {
  use(fake()); net.answer = { status: 418 }; await call(BN); await flush(); tick(11 * MIN);
  net.answer = { status: 429 }; await call(BB); await flush();
  assert.deepEqual(Object.keys(store.row as object), ['bybit']);
});

/* ── X: two instances ─────────────────────────────────────────────────── */
async function instance(tag: string) { delete g.__lhqExchangeGuard; delete g.__lhqExchangeBreakerSync; return await import(`../lib/exchangeGuard.ts?inst=${tag}`); }
test('X1. two instances: B (booted before A tripped) does NOT see A\'s ban until B trips itself; B\'s own later trip then wins and is saved; a restarted A reads the later stop', async () => {
  use(fake());
  const A = await instance('x1a'); const B = await instance('x1b');
  net.answer = { status: 200 }; await B.exchangeFetch(BN); await flush();                 // B booted, hydrated against an empty row
  net.answer = { status: 418 }; await A.exchangeFetch(BN).catch(() => 0); await flush();   // A trips at T0 -> saved T0+10m
  assert.equal(A.exchangeCoolingDown('binance')!.until, T0 + 600_000);
  assert.equal(B.exchangeCoolingDown('binance'), null, 'B should have no live view of the row (documenting current behaviour)');
  tick(5 * MIN); net.binance = 0;
  await B.exchangeFetch(BN).catch(() => 0); await flush();                              // B still calls Binance, gets its own 418
  assert.equal(net.binance, 1, 'B did not call the exchange');
  assert.equal(B.exchangeCoolingDown('binance')!.until, T0 + 5 * MIN + 600_000);
  assert.equal((store.row as { binance: { openUntil: number } }).binance.openUntil, T0 + 5 * MIN + 600_000, 'the later stop was not what got saved');
  const A2 = await instance('x1c'); net.binance = 0; net.answer = { status: 200 };         // A restarts
  await assert.rejects(() => A2.exchangeFetch(BN), /cooling down/); assert.equal(net.binance, 0);
  assert.equal(A2.exchangeCoolingDown('binance')!.until, T0 + 5 * MIN + 600_000);
});
test('X2. a short Retry-After 429 on instance B while A saved a 10-minute ban: B adopts the 10 minutes (no flapping to 7 s)', async () => {
  use(fake());
  const A = await instance('x2a'); const B = await instance('x2b');
  net.answer = { status: 200 }; await B.exchangeFetch(BN); await flush();
  net.answer = { status: 418 }; await A.exchangeFetch(BN).catch(() => 0); await flush();
  net.answer = { status: 429, retryAfter: '7' }; await B.exchangeFetch(BN).catch(() => 0); await flush();
  assert.equal(B.exchangeCoolingDown('binance')!.until, T0 + 600_000);
  assert.equal((store.row as { binance: { openUntil: number } }).binance.openUntil, T0 + 600_000);
});

/* E1 / E2 (QA review of #2571, fixed on the PR): the saved breaker row is scoped per SERVICE (dev, qa and staging share one database), and EXCHANGE_BREAKER_IGNORE_SAVED=1 is the way out of a wrongly-open saved breaker. */
test('E1. the saved row key differs per service: qa and staging (both APP_ENV=dev) get different keys, prod another; the name is sanitised and bounded', async () => {
  const { breakerConfigKey } = await import('../lib/exchangeBreakerStore.ts');
  const qa = breakerConfigKey({ RENDER_SERVICE_NAME: 'liquidity-hq-qa', NEXT_PUBLIC_APP_ENV: 'dev' }), stg = breakerConfigKey({ RENDER_SERVICE_NAME: 'liquidity-hq-staging', NEXT_PUBLIC_APP_ENV: 'dev' }), prod = breakerConfigKey({ RENDER_SERVICE_NAME: 'liquidity-hq-prod', NEXT_PUBLIC_APP_ENV: 'prod' });
  assert.equal(qa, 'exchange_breaker:liquidity-hq-qa'); assert.equal(stg, 'exchange_breaker:liquidity-hq-staging'); assert.equal(prod, 'exchange_breaker:liquidity-hq-prod'); assert.equal(new Set([qa, stg, prod]).size, 3);
  assert.equal(breakerConfigKey({ NEXT_PUBLIC_SENTRY_ENV: 'Staging' }), 'exchange_breaker:staging', 'falls back to the error-tracker label, lower-cased');
  assert.equal(breakerConfigKey({ NEXT_PUBLIC_APP_ENV: 'dev' }), 'exchange_breaker:dev'); assert.equal(breakerConfigKey({}), 'exchange_breaker:local');
  assert.match(breakerConfigKey({ RENDER_SERVICE_NAME: "a b/c';drop" }), /^exchange_breaker:[a-z0-9_-]+$/, 'only safe characters reach the key'); assert.ok(breakerConfigKey({ RENDER_SERVICE_NAME: 'x'.repeat(500) }).length <= 'exchange_breaker:'.length + 64);
});
test('E2. only the exact value "1" switches the saved row off (not "true", "0", "yes", empty)', async () => {
  const { ignoreSavedBreaker } = await import('../lib/exchangeBreakerStore.ts');
  assert.equal(ignoreSavedBreaker({ EXCHANGE_BREAKER_IGNORE_SAVED: '1' }), true);
  for (const v of ['true', '0', 'yes', '', ' 1', '11', undefined]) assert.equal(ignoreSavedBreaker({ EXCHANGE_BREAKER_IGNORE_SAVED: v }), false, `"${String(v)}"`);
});
