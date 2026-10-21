/* #1397 / #1634: the server's in-process caches are bounded by SIZE, and the [mem] log line reads the real tables.
 *
 * WHAT THIS PINS: lib/apiCache.ts keeps its stored values under a 48 MB byte budget (least recently used first), keeps a hot key, keeps one entry larger
 * than the whole budget alone (and lets it go at the next insert), counts bytes without drift when a key is rewritten, and still serves a cachedStale
 * entry that stands in for a dead upstream after other entries are evicted; both modules keep their state on globalThis, so a second compiled copy
 * (instrumentation vs routes) sees the same tables. lib/rateLimit.ts holds at most 20,000 live buckets plus a 1,000-key overflow, never evicts a bucket
 * that is blocking someone, and still counts and limits a new key when every old bucket is a blocker. lib/memWatch.ts's line carries the named fields
 * and the cache KEYS only, never a cached value, and starts one timer however often it is called.
 *
 * WHAT IT CANNOT PROVE: that these caches are what grew on production (#1397), the real heap cost of a value (the budget counts JSON text length),
 * or how a Next build splits modules (the globalThis check imports the same file twice under different URLs, the closest local stand-in). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cached, cachedStale, _cacheStats } from '../lib/apiCache.ts';

const MB = 1024 * 1024;
const BUDGET = 48 * MB;
const big = (mb: number, ch = 'x') => ch.repeat(Math.round(mb * MB));
const ours = (prefix: string) => _cacheStats(1000).biggest.filter((b) => b.key.startsWith(prefix));

test('C1. a flood of 1 MB values stays under the 48 MB budget, without evicting more than it has to', async () => {
  for (let i = 0; i < 100; i++) await cached(`c1:${i}`, 600_000, async () => big(1));
  const s = _cacheStats(1000);
  assert.ok(s.bytes <= BUDGET, `held ${(s.bytes / MB).toFixed(1)} MB, over the 48 MB budget`);
  assert.ok(s.bytes >= 40 * MB, `held only ${(s.bytes / MB).toFixed(1)} MB: evicting far more than the budget needs`);
  const kept = ours('c1:').length;
  assert.ok(kept >= 40 && kept <= 48, `kept ${kept} of 100 one-MB entries`);
  assert.ok(ours('c1:').every((b) => Number(b.key.split(':')[1]) >= 100 - kept), 'it was not the OLDEST entries that went (least recently used first)');
});

test('C2. a key read between inserts survives a flood that evicts everything around it (LRU, not insertion order)', async () => {
  let calls = 0; const hot = async () => { calls++; return big(1, 'h'); };
  await cached('c2:hot', 600_000, hot);
  for (let i = 0; i < 80; i++) { await cached(`c2:cold:${i}`, 600_000, async () => big(1)); await cached('c2:hot', 600_000, hot); }
  assert.equal(calls, 1, 'the hot key was evicted and fetched again');
  assert.ok(ours('c2:hot').length === 1);
});

test('C3. one value larger than the whole budget is kept alone, then goes at the next insert', async () => {
  await cached('c3:huge', 600_000, async () => big(60));
  let s = _cacheStats(1000);
  assert.equal(s.entries, 1, `expected the oversize value alone, found ${s.entries} entries`);
  assert.equal(s.biggest[0].key, 'c3:huge');
  await cached('c3:after', 600_000, async () => 'small');
  s = _cacheStats(1000);
  assert.equal(ours('c3:huge').length, 0, 'the oversize value outlived the next insert');
  assert.equal(ours('c3:after').length, 1);
  assert.ok(s.bytes < BUDGET);
});

test('C4. rewriting a key replaces its byte count instead of adding to it', async () => {
  await cached('c4:k', 0, async () => big(5));
  const a = _cacheStats(1000).bytes;
  await cached('c4:k', 0, async () => big(1));
  const b = _cacheStats(1000).bytes;
  assert.ok(Math.abs((a - b) - 4 * MB) < 64, `bytes went ${a} -> ${b}, expected a drop of 4 MB`);
  assert.equal(ours('c4:k').length, 1);
});

test('C5. a cachedStale entry serving for a dead upstream is promoted, so the entries stored after it go first', async () => {
  await cachedStale('c5:stale', 1, async () => 'last good');
  for (let i = 0; i < 30; i++) await cached(`c5:older:${i}`, 600_000, async () => big(1));
  await new Promise((r) => setTimeout(r, 15));
  const served = await cachedStale('c5:stale', 1, async () => { throw new Error('upstream down'); });
  assert.deepEqual([served.data, served.stale], ['last good', true]);
  for (let i = 0; i < 30; i++) await cached(`c5:fill:${i}`, 600_000, async () => big(1));
  assert.ok(ours('c5:older:').length < 30, 'precondition: the later inserts forced evictions');
  const again = await cachedStale('c5:stale', 1, async () => { throw new Error('still down'); });
  assert.deepEqual([again.data, again.stale], ['last good', true], 'the stale stand-in was evicted by the later inserts');
});

test('C6. a second compiled copy of the module sees the same cache (globalThis, the #1634 [mem] fix)', async () => {
  await cached('c6:shared', 600_000, async () => 'from copy one');
  const second = '../lib/apiCache.ts?copy=two'; // a variable, so tsc does not try to resolve the query-string URL as a module path
  const copy = await import(second) as typeof import('../lib/apiCache.ts');
  assert.ok(copy._cacheStats(1000).biggest.some((b) => b.key === 'c6:shared'), 'the second copy reads an empty or different store');
  assert.equal(await copy.cached('c6:shared', 600_000, async () => 'refetched'), 'from copy one');
});

/* Each rate-limit test gets an empty table: the module keeps it on globalThis, so the test clears that slot and imports a fresh copy. */
let gen = 0;
async function freshRateLimit() { delete (globalThis as { __lhqRateLimit?: unknown }).__lhqRateLimit; return await import(`../lib/rateLimit.ts?fresh=${++gen}`) as typeof import('../lib/rateLimit.ts'); }

test('R1. 25,000 distinct keys hold at most 20,000 live buckets plus the 1,000-key overflow', async () => {
  const { rateLimit, _bucketCount } = await freshRateLimit();
  for (let i = 0; i < 25_000; i++) rateLimit(`r1:${i}`, 100, 60_000);
  assert.ok(_bucketCount() <= 21_000, `${_bucketCount()} buckets`);
  assert.ok(_bucketCount() >= 20_000, `${_bucketCount()} buckets: dropped more than the cap needs`);
});

test('R2. a key at its limit stays limited through a flood of new keys', async () => {
  const { rateLimit } = await freshRateLimit();
  assert.equal(rateLimit('r2:abuser', 1, 60_000), true);
  assert.equal(rateLimit('r2:abuser', 1, 60_000), false);
  for (let i = 0; i < 25_000; i++) rateLimit(`r2:flood:${i}`, 100, 60_000);
  assert.equal(rateLimit('r2:abuser', 1, 60_000), false, 'the flood evicted the blocked key and reset its counter');
});

test('R3. with every bucket a blocker, a new key goes to the overflow table and is still counted and limited', async () => {
  const { rateLimit, _bucketCount } = await freshRateLimit();
  for (let i = 0; i < 20_000; i++) { rateLimit(`r3:blk:${i}`, 1, 60_000); }
  assert.equal(rateLimit('r3:blk:0', 1, 60_000), false, 'precondition: the oldest bucket is a blocker');
  assert.equal(rateLimit('r3:new', 1, 60_000), true, 'a new visitor was locked out because the table was full of blockers');
  assert.equal(rateLimit('r3:new', 1, 60_000), false, 'a new visitor during a flood of blockers got an unlimited rate');
  assert.equal(rateLimit('r3:blk:0', 1, 60_000), false, 'a parked blocker was evicted to make room');
  assert.equal(_bucketCount(), 20_001);
});

test('R4. a bucket under its limit is the one evicted when the table is full, and that errs toward allowing', async () => {
  const { rateLimit } = await freshRateLimit();
  assert.equal(rateLimit('r4:light', 5, 60_000), true);
  for (let i = 0; i < 19_999; i++) rateLimit(`r4:blk:${i}`, 1, 60_000);
  assert.equal(rateLimit('r4:newcomer', 1, 60_000), true);
  for (let k = 0; k < 5; k++) assert.equal(rateLimit('r4:light', 5, 60_000), true, `the evicted light user must start a fresh window (call ${k + 1})`);
});

test('R5. a second compiled copy of the module counts against the same buckets (globalThis)', async () => {
  const one = await freshRateLimit();
  assert.equal(one.rateLimit('r5:shared', 1, 60_000), true);
  const two = await import(`../lib/rateLimit.ts?copy=${++gen}`) as typeof import('../lib/rateLimit.ts');
  assert.equal(two.rateLimit('r5:shared', 1, 60_000), false, 'the second copy has its own table, so the limit is per copy, not per process');
});

test('M1. the [mem] line names rss, heap, external, arrayBuffers, the cache and the buckets, with cache KEYS but never a cached value', async () => {
  await cached('m1:key', 600_000, async () => 'SECRET-CACHED-VALUE-1640');
  const { memLine } = await import('../lib/memWatch.ts');
  const line = memLine();
  for (const f of ['[mem] ', 'rss=', 'heapUsed=', 'heapTotal=', 'external=', 'arrayBuffers=', 'apiCache=', 'rateBuckets=', 'biggest=']) assert.ok(line.includes(f), `missing ${f.trim()} in: ${line}`);
  assert.ok(/apiCache=\d+entries\/\d+\.\dMB/.test(line), line);
  assert.ok(!line.includes('SECRET-CACHED-VALUE-1640'), 'a cached VALUE reached the log line');
});

test('M2. startMemWatch starts one unref\'d 10-minute timer however often it is called', async () => {
  const real = globalThis.setInterval; const seen: number[] = []; let unrefd = 0;
  (globalThis as { setInterval: unknown }).setInterval = ((fn: () => void, ms: number) => { seen.push(ms); const t = real(fn, 1e9); const u = t.unref.bind(t); (t as { unref: () => unknown }).unref = () => { unrefd++; return u(); }; return t; }) as typeof setInterval;
  try {
    const freshCopy = '../lib/memWatch.ts?fresh=m2';
    const { startMemWatch } = await import(freshCopy) as typeof import('../lib/memWatch.ts');
    startMemWatch(); startMemWatch(); startMemWatch();
  } finally { globalThis.setInterval = real; }
  assert.deepEqual(seen, [600_000]);
  assert.equal(unrefd, 1, 'the timer was not unref\'d: it would keep a test or build process alive');
});
