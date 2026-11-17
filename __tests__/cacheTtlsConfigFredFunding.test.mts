/* #2479: three cache changes, each with a claim that must stay true.
 *   K1  /api/config: concurrent MISSES share ONE database read (the real route, a stand-in network that counts reads); every caller gets the same answer
 *   K2  /api/config: the 15 s life is unchanged (these are the maintenance switch and the kill switches): no read inside 15 s, exactly one after; a FAILED read answers the safe default and does not wedge the next read
 *   F1  FRED: the release TTL is 10 minutes, the default stays 12 hours, and /api/econ-calendar picks the short one only for an event with no actual that is within 6 h ahead or 36 h behind (the line is evaluated, not re-typed)
 *   G1  /api/funding: reads through cachedRefresh with 2 min fresh + 5 min stale, nothing else reads the old 20 s; the funding consumers only DISPLAY it (source pin: alerts and the squeeze score never fetch it)
 * WHAT IT CANNOT PROVE: FRED's real publication time, or that a stale funding rate is acceptable for a person trading on the Arena card (a product call recorded in the PR). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const net = { reads: 0, mode: 'ok' as 'ok' | 'throw', delayMs: 20 };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.host !== 'supabase.invalid') throw new Error(`stray request ${url.host}`);
  net.reads++;
  if (net.mode === 'throw') throw new Error('stand-in: network down');
  await new Promise((r) => setTimeout(r, net.delayMs));
  return json(200, [{ key: 'feature_flags', value: { grok: false, telegram: true } }]);
}) as typeof fetch;

const { GET } = await import('../app/api/config/route.ts');
const get = async () => (await GET()).json() as Promise<{ maintenanceMode: boolean; featureFlags: { grok: boolean; telegram: boolean } }>;

test('K1. five concurrent cold requests make ONE database read and all get the same answer', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  net.reads = 0; net.mode = 'ok';
  const all = await Promise.all([get(), get(), get(), get(), get()]);
  assert.equal(net.reads, 1, `${net.reads} reads for 5 concurrent misses: the misses are not sharing one`);
  for (const b of all) assert.deepEqual(b, all[0]);
  assert.equal(all[0].featureFlags.grok, false, 'the read answer must reach every caller');
});

test('K2. 15 s life unchanged: no read at 14.9 s, exactly one at 15.1 s; a failed read gives the safe default and the NEXT miss reads again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 2_000_000 });
  net.reads = 0; net.mode = 'ok';
  await get(); assert.equal(net.reads, 1);   // the previous test left an entry that has already aged out (time moved forward)
  t.mock.timers.tick(14_900); await get(); assert.equal(net.reads, 1, 'a read inside the 15 s life');
  t.mock.timers.tick(200); await get(); assert.equal(net.reads, 2, 'no fresh read after 15 s: the switches would be stale');
  net.mode = 'throw'; t.mock.timers.tick(15_100);
  const failed = await get(); assert.equal(failed.maintenanceMode, false); assert.deepEqual(failed.featureFlags, { grok: true, telegram: true }, 'a failed read must answer the safe default');
  const readsAfterFail = net.reads; net.mode = 'ok'; t.mock.timers.tick(15_100);
  const healed = await get(); assert.equal(net.reads, readsAfterFail + 1, 'a failed read wedged the single-flight: the next miss did not read');
  assert.equal(healed.featureFlags.grok, false);
});

test('F1. the FRED release TTL and the "around a release" window', async () => {
  const { FRED_TTL_DEFAULT, FRED_TTL_RELEASE } = await import('../lib/fred.ts');
  assert.equal(FRED_TTL_RELEASE, 10 * 60_000); assert.equal(FRED_TTL_DEFAULT, 12 * 3600_000, 'the default TTL must stay 12 hours away from a release');
  const src = readFileSync(new URL('../app/api/econ-calendar/route.ts', import.meta.url), 'utf8');
  const line = /const aroundRelease = (past\.some\(.*\));/.exec(src)?.[1]; assert.ok(line, 'the aroundRelease expression moved');
  const around = (now: number, eventAt: number) => new Function('past', 'now', `return ${line}`)([{ isoDate: new Date(eventAt).toISOString() }], new Date(now)) as boolean;
  const h = 3600_000, now = Date.UTC(2026, 10, 17, 12);
  assert.equal(around(now, now + 5 * h), true, '5 h ahead is around a release'); assert.equal(around(now, now + 7 * h), false, '7 h ahead is not');
  assert.equal(around(now, now - 35 * h), true, '35 h behind is still around'); assert.equal(around(now, now - 37 * h), false, '37 h behind is not');
  assert.match(src, /fetchFredRows\(id, fredTtl\)/, 'the chosen TTL must reach fetchFredRows');
});

test('G1. /api/funding: fresh 2 min + stale 5 min through cachedRefresh; only the Arena card fetches it', () => {
  const src = readFileSync(new URL('../app/api/funding/route.ts', import.meta.url), 'utf8');
  assert.match(src, /const CACHE_TTL = 120_000;/); assert.match(src, /const CACHE_MAX_STALE = 300_000;/);
  assert.match(src, /cachedRefresh\('funding', CACHE_TTL, CACHE_MAX_STALE,/, 'the route must read through the stale-while-refresh cache');
  assert.doesNotMatch(src, /\bcached\('funding'/, 'the old 20 s cache is still in use');
  for (const f of ['../app/api/telegram/alert/route.ts', '../lib/squeezeScore.ts', '../lib/signalPlan.ts']) {
    let s = ''; try { s = readFileSync(new URL(f, import.meta.url), 'utf8'); } catch { continue; }
    assert.doesNotMatch(s, /\/api\/funding/, `${f} reads /api/funding, which is now up to 7 minutes old: a decision would use stale funding`);
  }
});
