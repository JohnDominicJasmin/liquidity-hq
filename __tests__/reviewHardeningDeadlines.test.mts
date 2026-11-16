/* #2415 (PM review pass) non-collector items; the collector watchdog is test/pins-2470 (liqCollectorWatchdog).
 *   S1-S5  REAL lib/supabase.fetchWithDeadline under a mocked clock: no answer within 15 s aborts (TimeoutError); an answer at 14 s keeps the body alive past 15 s and cuts it at 60 s from the START; the caller's own signal still aborts (before and after the answer); a write is never given a deadline (no signal added)
 *   G1-G2  grok deadlines: the SERVER's deadline is under the CLIENT's for both modes (80 < 90, 180 < 200), lib/grok re-exports the same numbers, and the route puts ONE signal (client disconnect + the server deadline) on BOTH upstream calls, so an abort lands in the existing refund path
 *   A1     AuthProvider: while the plan read is unknown, 'online' and tab-visible run one fresh read sequence, listeners only in that state and removed on cleanup
 *   C1     the chart strategy overlay effect reruns when history bars arrive (barsTick in its deps and bumped on delivery)
 * WHAT IT CANNOT PROVE: a real slow-3G load, a real 80 s Quick read being refunded (route is not importable by the unit runner; the refund path is covered by the group-run API cell), the arrow on a throttled network (browser cell). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GROK_QUICK_TIMEOUT_MS, GROK_DEEP_TIMEOUT_MS, GROK_SERVER_QUICK_MS, GROK_SERVER_DEEP_MS } from '../lib/grokDeadlines.ts';

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon';
const { fetchWithDeadline, SUPABASE_FETCH_TIMEOUT_MS, SUPABASE_BODY_TIMEOUT_MS } = await import('../lib/supabase.ts');
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const realFetch = globalThis.fetch; const tick = () => new Promise<void>((r) => setImmediate(r));

function stubFetch(seen: { signal?: AbortSignal | null }[], answerAfterMs: number | null, tickClock: (ms: number) => void) {
  globalThis.fetch = ((_i: RequestInfo | URL, init?: RequestInit) => { seen.push({ signal: init?.signal }); return new Promise<Response>((res, rej) => { if (init?.signal?.aborted) { rej(init.signal.reason); return; } init?.signal?.addEventListener('abort', () => rej(init.signal!.reason), { once: true }); if (answerAfterMs !== null) setTimeout(() => res(new Response('{}')), answerAfterMs); }); }) as typeof fetch;
  void tickClock;
}

test('S1. no answer within 15 s aborts the read as a TimeoutError', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_950_000_000_000 }); const seen: { signal?: AbortSignal | null }[] = []; stubFetch(seen, null, () => {});
  try {
    assert.equal(SUPABASE_FETCH_TIMEOUT_MS, 15000); const p = fetchWithDeadline('https://x/rest/v1/t'); const out = p.then(() => 'answered', (e) => (e as Error).name);
    t.mock.timers.tick(SUPABASE_FETCH_TIMEOUT_MS - 1); await tick(); assert.equal(seen[0].signal?.aborted, false, 'aborted early');
    t.mock.timers.tick(2); await tick(); assert.equal(await out, 'TimeoutError', 'a read that never answers was not abandoned at 15 s');
  } finally { globalThis.fetch = realFetch; }
});
test('S2. THE FIX: an answer at 14 s keeps the body alive past 15 s and cuts it at 60 s from the start, not before and not never', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_950_000_000_000 }); const seen: { signal?: AbortSignal | null }[] = []; stubFetch(seen, 14_000, () => {});
  try {
    const p = fetchWithDeadline('https://x/rest/v1/t'); t.mock.timers.tick(14_000); await tick(); const res = await p; assert.ok(res instanceof Response, 'the answer at 14 s was lost');
    t.mock.timers.tick(30_000); assert.equal(seen[0].signal?.aborted, false, 'a body still arriving was cut at the old 15 s (a big read on a slow phone fails with a false error)');
    assert.equal(SUPABASE_BODY_TIMEOUT_MS, 60000); t.mock.timers.tick(60_000 - 44_000 - 1); assert.equal(seen[0].signal?.aborted, false, 'cut before 60 s');
    t.mock.timers.tick(2); assert.equal(seen[0].signal?.aborted, true, 'the body has no finite cap: nothing waits forever (OWNER-RULES 21)');
    assert.equal((seen[0].signal?.reason as Error)?.name, 'TimeoutError');
  } finally { globalThis.fetch = realFetch; }
});
test('S3. the first timer is cleared once the answer starts (it must not abort at 15 s after a 1 s answer)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_950_000_000_000 }); const seen: { signal?: AbortSignal | null }[] = []; stubFetch(seen, 1_000, () => {});
  try { const p = fetchWithDeadline('https://x/rest/v1/t'); t.mock.timers.tick(1_000); await tick(); await p; t.mock.timers.tick(20_000); assert.equal(seen[0].signal?.aborted, false, 'the 15 s timer survived the answer'); } finally { globalThis.fetch = realFetch; }
});
test('S4. the caller\'s own signal aborts the read, whether it fired before the call or after the answer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_950_000_000_000 });
  try {
    const seenA: { signal?: AbortSignal | null }[] = []; stubFetch(seenA, 1_000, () => {}); const pre = new AbortController(); pre.abort(new Error('gone'));
    const pa = fetchWithDeadline('https://x/rest/v1/t', { signal: pre.signal }); const ea = pa.then(() => 'answered', (e) => (e as Error).message); await tick(); assert.equal(seenA[0].signal?.aborted, true, 'an already-aborted caller signal was ignored'); assert.equal(await ea, 'gone');
    const seenB: { signal?: AbortSignal | null }[] = []; stubFetch(seenB, 1_000, () => {}); const own = new AbortController();
    const pb = fetchWithDeadline('https://x/rest/v1/t', { signal: own.signal }); t.mock.timers.tick(1_000); await tick(); await pb; own.abort(new Error('user left')); assert.equal(seenB[0].signal?.aborted, true, 'the caller cannot cancel after the answer started');
  } finally { globalThis.fetch = realFetch; }
});
test('S5. a write (POST/PATCH/DELETE) is never given a deadline: the call goes through untouched', async () => {
  const seen: { signal?: AbortSignal | null }[] = []; globalThis.fetch = ((_i: RequestInfo | URL, init?: RequestInit) => { seen.push({ signal: init?.signal }); return Promise.resolve(new Response('{}')); }) as typeof fetch;
  try { for (const method of ['POST', 'PATCH', 'DELETE']) await fetchWithDeadline('https://x/rest/v1/t', { method }); assert.deepEqual(seen.map((s) => s.signal ?? null), [null, null, null], 'a write was given a signal: a slow-to-answer write would be reported failed and retried twice'); } finally { globalThis.fetch = realFetch; }
});

test('G1. the server deadline is under the client deadline in both modes, and lib/grok shares the numbers', () => {
  assert.deepEqual([GROK_QUICK_TIMEOUT_MS, GROK_DEEP_TIMEOUT_MS, GROK_SERVER_QUICK_MS, GROK_SERVER_DEEP_MS], [90_000, 200_000, 80_000, 180_000]);
  assert.ok(GROK_SERVER_QUICK_MS < GROK_QUICK_TIMEOUT_MS && GROK_SERVER_DEEP_MS < GROK_DEEP_TIMEOUT_MS, 'the client gives up before the server: a slow read shows "took too long" while still billed');
  const g = read('lib/grok.ts'); assert.ok(g.includes("export { GROK_QUICK_TIMEOUT_MS, GROK_DEEP_TIMEOUT_MS } from './grokDeadlines.ts';") && g.includes("import { GROK_QUICK_TIMEOUT_MS, GROK_DEEP_TIMEOUT_MS } from './grokDeadlines.ts';"), 'lib/grok no longer takes the client numbers from the shared file');
  assert.equal(/export const GROK_(QUICK|DEEP)_TIMEOUT_MS\s*=/.test(g), false, 'a second definition of the client deadline is back');
});
test('G2. the route uses ONE signal (client disconnect + server deadline per mode) on both upstream calls', () => {
  const r = read('app/api/grok/route.ts'); assert.ok(r.includes("AbortSignal.any([req.signal, AbortSignal.timeout(type === 'deep' ? GROK_SERVER_DEEP_MS : GROK_SERVER_QUICK_MS)])"), 'the read signal is not client-disconnect + the per-mode server deadline');
  assert.equal((r.match(/signal: readSignal,/g) ?? []).length, 2, 'not both upstream calls carry the read signal'); assert.equal(/signal:\s*AbortSignal\.timeout\(/.test(r.replace(/AbortSignal\.any\(\[[^\]]*\]\)/g, '')), false, 'an upstream call still has its own, longer, timeout');
});
test('A1. the unknown-plan self-heal listens only in that state and cleans up', () => {
  const a = read('components/AuthProvider.tsx'); assert.ok(a.includes('if (!userId || !entitlementsError || entitlementsLoading) return;'), 'the listeners are attached on a healthy page');
  assert.ok(a.includes("window.addEventListener('online', again);") && a.includes("document.addEventListener('visibilitychange', again);"), 'a trigger is gone'); assert.ok(a.includes("window.removeEventListener('online', again); document.removeEventListener('visibilitychange', again);"), 'listeners leak');
  assert.ok(a.includes("if (document.visibilityState === 'visible') setEntitlementsRetryNonce(n => n + 1);"), 'the retry runs for a hidden tab or does not bump the retry nonce');
});
test('C1. the strategy overlay effect reruns when history bars arrive', () => {
  const c = read('components/KLineProChart.tsx'); assert.ok(c.includes('const [barsTick, setBarsTick] = useState(0);') && c.includes('setBarsTick(n => n + 1);'), 'barsTick is not bumped on delivery');
  assert.ok(c.includes('}, [strategyOverlay, chartReady, themeInk, ovLabelProbe, barsTick]);'), 'barsTick is not a dependency of the overlay effect: the arrow is missing when the signal lands first');
});
