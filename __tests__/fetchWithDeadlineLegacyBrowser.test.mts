/* fetchWithDeadline on a browser WITHOUT AbortSignal.timeout / AbortSignal.any (Safari before 16, older WebViews).
 *
 * THE DEFECT (code review of #2408): lib/supabase.ts called `AbortSignal.timeout(ms)` unguarded, so on a browser that does not have it every Supabase READ threw a TypeError before it was sent:
 * the app would be unable to read a single row. Chromium has the API, so no browser test can show it; this file REMOVES the API from the global before each case and calls the real function.
 *
 * What must hold with the API missing:
 *   L1. a read is still SENT (the stand-in fetch is called once), with no TypeError;
 *   L2. a read that never answers is abandoned after the deadline, as an abort (the deadline still works without the API);
 *   L3. the caller's own signal still aborts the read (before and after the deadline would fire);
 *   L4. a WRITE is never given a deadline and still goes through untouched (no signal added);
 *   L5. the same four cases pass with AbortSignal.timeout present and AbortSignal.any absent (a half-modern browser).
 * Expectations are written from the contract above, not from the code under test. */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon';
const { fetchWithDeadline } = await import('../lib/supabase.ts');

const realFetch = globalThis.fetch;
const AS = AbortSignal as unknown as { timeout?: unknown; any?: unknown };
const realTimeout = AS.timeout; const realAny = AS.any;

type Seen = { url: string; method: string; signal: AbortSignal | null | undefined };
function stub(seen: Seen[], mode: 'answer' | 'hang') {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase(), signal: init?.signal });
    if (mode === 'answer') return Promise.resolve(new Response('{}', { status: 200 }));
    return new Promise<Response>((_res, rej) => {
      const s = init?.signal;
      if (s?.aborted) return rej(new DOMException('aborted', 'AbortError'));
      s?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')), { once: true });
    });
  }) as typeof fetch;
}
function restore() { globalThis.fetch = realFetch; AS.timeout = realTimeout; AS.any = realAny; }
const remove = (which: Array<'timeout' | 'any'>) => { for (const k of which) Object.defineProperty(AbortSignal, k, { value: undefined, configurable: true, writable: true }); };

for (const [label, gone] of [['L (no timeout, no any)', ['timeout', 'any']], ['L5 (timeout present, no any)', ['any']]] as const) {
  test(`${label}: a read is still sent, and does not throw`, async () => {
    const seen: Seen[] = []; stub(seen, 'answer'); remove([...gone]);
    try {
      const r = await fetchWithDeadline('https://example.supabase.co/rest/v1/t?select=*', { method: 'GET' }, 50);
      assert.equal(r.status, 200); assert.equal(seen.length, 1, 'the read was never sent');
    } finally { restore(); }
  });

  test(`${label}: a read that never answers is abandoned after the deadline, as an abort`, async () => {
    const seen: Seen[] = []; stub(seen, 'hang'); remove([...gone]);
    try {
      const t0 = Date.now();
      await assert.rejects(fetchWithDeadline('https://example.supabase.co/rest/v1/t', { method: 'GET' }, 80), (e: unknown) => (e as Error).name === 'AbortError' || /abort/i.test(String((e as Error).message)));
      const dt = Date.now() - t0; assert.ok(dt >= 60 && dt < 2000, `abandoned after ${dt} ms; the deadline was 80 ms`);
    } finally { restore(); }
  });

  test(`${label}: the caller's own signal still aborts the read, before the deadline`, async () => {
    const seen: Seen[] = []; stub(seen, 'hang'); remove([...gone]);
    try {
      const c = new AbortController();
      const p = fetchWithDeadline('https://example.supabase.co/rest/v1/t', { method: 'GET', signal: c.signal }, 5000);
      setTimeout(() => c.abort(), 30);
      const t0 = Date.now();
      await assert.rejects(p, (e: unknown) => (e as Error).name === 'AbortError' || /abort/i.test(String((e as Error).message)));
      assert.ok(Date.now() - t0 < 1500, 'the caller abort waited for the deadline instead of acting at once');
      const c2 = new AbortController(); c2.abort();
      await assert.rejects(fetchWithDeadline('https://example.supabase.co/rest/v1/t', { method: 'GET', signal: c2.signal }, 5000), 'an already-aborted caller signal must reject');
    } finally { restore(); }
  });

  test(`${label}: a WRITE gets no deadline and is sent untouched`, async () => {
    const seen: Seen[] = []; stub(seen, 'answer'); remove([...gone]);
    try {
      const own = new AbortController();
      await fetchWithDeadline('https://example.supabase.co/rest/v1/t', { method: 'POST', body: '{}', signal: own.signal }, 20);
      assert.equal(seen.length, 1); assert.equal(seen[0].method, 'POST');
      assert.equal(seen[0].signal, own.signal, 'a write was given a different signal: it must be exactly the caller\'s own, never a deadline');
      await fetchWithDeadline('https://example.supabase.co/rest/v1/t', { method: 'PATCH', body: '{}' }, 20);
      assert.equal(seen[1].signal ?? null, null, 'a write with no signal of its own was given one');
    } finally { restore(); }
  });
}
