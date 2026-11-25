/* QA: PR #2816 (#1651 owner item 28), slow exchange calls have a time limit. The REAL symbolFanout runs against a stand-in that never answers until its signal aborts; real timers, the scenarios run side by side (about 20 s in all). Unknown hosts, so no exchange breaker is involved.
 *   F1 a hung primary with a working second venue: one call gets at most 8 s, the first pass stops at 14 s and every symbol is then asked of the second venue
 *   F2 both hung: the run ends by about 20 s with an error, never later
 *   F3 a hung primary with no second venue ends by about 20 s
 *   F4 a healthy run is unchanged: every symbol, first venue, at once
 *   P1 every read in the browser's market provider carries a signal, and one that brings its own keeps it */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { symbolFanout, FANOUT_CALL_MS, FANOUT_PRIMARY_MS, FANOUT_DEADLINE_MS } from '../lib/bybitFanout.ts';

const SYMS = Array.from({ length: 24 }, (_, i) => `S${i}`);
type Hit = { at: number; ended?: number };
const hits = new Map<string, Hit[]>();
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: unknown, init?: { signal?: AbortSignal }) => {
  const url = new URL(String(input)); const list = hits.get(url.host) ?? []; hits.set(url.host, list);
  const hit: Hit = { at: Date.now() }; list.push(hit);
  if (url.host.startsWith('ok')) return Promise.resolve(new Response('{"v":1}', { status: 200 }));
  return new Promise<Response>((_resolve, reject) => {
    assert.ok(init?.signal, `${url.host}: a call carried no signal`);
    const end = () => { hit.ended = Date.now(); reject(new DOMException('timed out', 'TimeoutError')); };
    if (init.signal.aborted) end(); else init.signal.addEventListener('abort', end, { once: true });
  });
}) as typeof fetch;
test.after(() => { globalThis.fetch = realFetch; });
const to = (host: string) => (s: string) => `http://${host}.invalid/${s}`;
const pick = (b: unknown) => (b as { v?: number }).v ?? null;
const timed = async <T,>(p: Promise<T>) => { const from = Date.now(); try { return { value: await p, ms: Date.now() - from, from, error: null as Error | null }; } catch (e) { return { value: null as T | null, ms: Date.now() - from, from, error: e as Error }; } };

test('F1 to F4. every run ends inside its limits', { timeout: 60_000 }, async () => {
  assert.deepEqual([FANOUT_CALL_MS, FANOUT_PRIMARY_MS, FANOUT_DEADLINE_MS], [8_000, 14_000, 20_000]);
  const [f1, f2, f3, f4] = await Promise.all([
    timed(symbolFanout(SYMS, 'qa:f1', 60_000, to('hang1'), pick, { buildUrl: to('ok1'), pick })),
    timed(symbolFanout(SYMS, 'qa:f2', 60_000, to('hang2a'), pick, { buildUrl: to('hang2b'), pick })),
    timed(symbolFanout(SYMS, 'qa:f3', 60_000, to('hang3'), pick)),
    timed(symbolFanout(SYMS, 'qa:f4', 60_000, to('ok4'), pick)),
  ]);
  /* F1 */
  assert.equal(f1.error, null, String(f1.error)); assert.equal(f1.value!.ok, SYMS.length); assert.equal(f1.value!.viaFallback?.length, SYMS.length);
  assert.ok(f1.ms >= 13_000 && f1.ms < 17_000, `F1 took ${f1.ms} ms`);
  for (const h of hits.get('hang1.invalid')!) assert.ok(h.ended! - h.at <= FANOUT_CALL_MS + 800, `a call hung ${h.ended! - h.at} ms`);
  assert.ok(Math.max(...hits.get('hang1.invalid')!.map((h) => h.ended!)) - f1.from <= FANOUT_PRIMARY_MS + 800, 'the first pass ran past 14 s');
  /* F2 and F3 */
  for (const [name, r] of [['F2', f2], ['F3', f3]] as const) { assert.ok(r.error, `${name}: nothing answered and it did not fail`); assert.ok(r.ms >= 13_000 && r.ms <= FANOUT_DEADLINE_MS + 1_500, `${name} took ${r.ms} ms`); }
  /* F4 */
  assert.equal(f4.error, null); assert.equal(f4.value!.ok, SYMS.length); assert.equal(f4.value!.viaFallback, undefined); assert.ok(f4.ms < 5_000, `F4 took ${f4.ms} ms`);
});

test('P1. the market provider\'s reads carry a 25 s signal unless they bring their own', async () => {
  const s = readFileSync(new URL('../components/MarketProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const a = s.indexOf('function fetch(input: string, init?: RequestInit)'); assert.ok(a > 0, 'the local fetch is gone');
  assert.match(s, /const PROVIDER_FETCH_TIMEOUT_MS = 25_000;/);
  const strip = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
  /* the slice is OUR OWN checked-in source, never input */
  const body = strip(s.slice(a, s.indexOf('\n}\n', a) + 3)).replace(/^function fetch/, 'function');
  const seen: Array<{ signal?: unknown; cache?: string }> = []; const made: number[] = [];
  const wrapped = new Function('globalThis', 'deadlineSignal', 'PROVIDER_FETCH_TIMEOUT_MS', `return (${body});`)({ fetch: (_u: string, i: { signal?: unknown }) => { seen.push(i); return Promise.resolve(null); } }, (ms: number) => { made.push(ms); return 'deadline'; }, 25_000) as (u: string, i?: Record<string, unknown>) => Promise<unknown>;
  await wrapped('/api/a'); await wrapped('/api/b', { cache: 'no-store' }); await wrapped('/api/c', { signal: 'own' });
  assert.deepEqual(seen, [{ signal: 'deadline' }, { cache: 'no-store', signal: 'deadline' }, { signal: 'own' }]); assert.deepEqual(made, [25_000, 25_000]);
  assert.equal(/(globalThis|window)\.fetch\(/g.exec(s.slice(a + 200)), null, 'a read bypasses the local fetch');
});
