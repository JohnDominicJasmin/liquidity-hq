/* #1594: `GET /api/health` answers whether the site AND its database are responding, for an outside monitor (cron-job.org, every 5 min, alert
 * after 2 failures). The owner's ask after the 2026-10-21 qa slowness: "if this happens we should receive an alert".
 *
 * WRITTEN AHEAD OF THE BUILD, from PM's spec on #1594 (2026-10-21 ~19:20 UTC), never from the implementation:
 *   - 200 `{ ok: true, db_ms, checked_at }` when one trivial Supabase read answers within 3 s;
 *   - 503 `{ ok: false, reason: 'db_slow' }` when the read takes longer than 3 s;
 *   - 503 `{ ok: false, reason: 'db_error' }` when the read fails;
 *   - `Cache-Control: no-store` (the CDN must never serve an old answer), and no secret, env value or env name in the body;
 *   - the result is cached in-process for 30 s, so N calls inside 30 s make ONE database read;
 *   - no auth: a bare request with no cookie or header gets the real answer.
 *
 * THE REAL ROUTE RUNS HERE: `GET` from app/api/health/route.ts. Only the network is a stand-in: every request to the Supabase host is answered
 * by the stub below, which can be told to answer fast, answer after 3.5 s, return a PostgREST error, or fail the connection. Any other host
 * fails the test instead of leaving the machine. NO REAL DATABASE AND NO REAL CREDENTIALS: the URL is a `.invalid` host.
 *
 * SHAPE ASSUMPTIONS, to re-check against Dev's build (the spec does not name them):
 *   - the read goes through supabase-js, so it reaches `fetch` (any table, any method counts as "the read");
 *   - the 30 s cache is timed with `Date.now()`. Each test moves the clock a minute on and imports a fresh copy of the route, so a cache
 *     held in the route or in a lib module cannot leak between tests.
 *
 * WHAT IT CANNOT PROVE: real Supabase latency, the cron-job.org monitor actually alerting, or Render's edge honouring no-store. */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const SUPABASE = 'http://supabase.invalid';
const SERVICE_KEY = 'qa_fixture_service_role_key_not_real';
const ANON_KEY = 'qa_fixture_anon_key_not_real';
const CRON = 'qa_fixture_cron_secret_not_real';
const LEAK = 'QA_LEAK_SENTINEL';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
process.env.CRON_SECRET = CRON;

type Mode = 'fast' | 'slow' | 'pgError' | 'netError';
const net = { mode: 'fast' as Mode, reads: 0 };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'content-range': '0-0/1' } });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  if (new URL(req.url).origin !== SUPABASE) throw new Error(`stray request ${req.method} ${req.url}`);
  net.reads++;
  const signal = init?.signal ?? req.signal;
  if (net.mode === 'netError') throw new TypeError(`fetch failed ${LEAK}`);
  if (net.mode === 'pgError') return json(500, { code: 'XX000', message: `${LEAK} relation does not exist`, details: LEAK, hint: null });
  if (net.mode === 'slow') {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 3500);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
    });
  }
  return json(200, [{ id: 1 }]);
}) as typeof fetch;

/* The clock moves a minute on per test, so any 30 s cache from an earlier test has expired whatever module holds it. */
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
after(() => { globalThis.fetch = realFetch; Date.now = realNow; });

let copy = 0;
beforeEach(() => { net.mode = 'fast'; net.reads = 0; offset += 60_000; copy++; });

/* THE STAND-IN MUST STILL BE INSTALLED WHEN A TEST RUNS, said out loud (#1683). With the real `fetch` back, the database read here would
   reach a real network, fail, and the route would answer its designed 503 db_error - so a broken instrument would read as H1 finding a
   product defect. This file imports the route inside each test, so it cannot hit the registration race that stranded arenaCoinLadder and
   priceAlertCron; the assertion covers any other way the stand-in could go missing. H4b swaps in its own stub deliberately and restores
   this one, which is why the check names the ORIGINAL stand-in rather than "not the real fetch". */
const standInFetch = globalThis.fetch;

/** A fresh copy of the route per test, so a module-level cache starts empty. */
async function route() {
  assert.equal(globalThis.fetch, standInFetch,
    'the Supabase stand-in is not installed: this run would reach the real network, so it measures nothing about the route - see #1683');
  const mod = await import(`../app/api/health/route.ts?qa=${copy}`);
  return mod.GET as (req: NextRequest) => Promise<Response>;
}
/** A bare request: no cookie, no Authorization, no secret (the monitor sends none). */
const bare = () => new NextRequest('http://localhost/api/health');

async function call(GET: (req: NextRequest) => Promise<Response>) {
  const res = await GET(bare());
  const text = await res.text();
  return { res, text, body: JSON.parse(text) as Record<string, unknown> };
}

/** No secret, connection detail, raw error text or env-variable name in what an unauthenticated caller reads. */
function assertNothingSensitive(text: string) {
  for (const secret of [SERVICE_KEY, ANON_KEY, CRON, LEAK, 'supabase.invalid']) assert.ok(!text.includes(secret), `body leaks ${secret}: ${text}`);
  assert.doesNotMatch(text, /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, `body names an env variable: ${text}`);
}

function assertNoStore(res: Response) {
  assert.match(res.headers.get('cache-control') ?? '', /\bno-store\b/, `Cache-Control was "${res.headers.get('cache-control')}"`);
}

test('H1: database answers in time -> 200 { ok: true, db_ms, checked_at }, no auth needed', async () => {
  const GET = await route();
  const { res, body, text } = await call(GET);
  assert.equal(res.status, 200, text);
  assert.equal(body.ok, true);
  assert.equal(typeof body.db_ms, 'number');
  assert.ok(Number.isFinite(body.db_ms) && (body.db_ms as number) >= 0 && (body.db_ms as number) < 3000, `db_ms = ${body.db_ms}`);
  assert.equal(typeof body.checked_at, 'string');
  assert.ok(!Number.isNaN(Date.parse(body.checked_at as string)), `checked_at = ${body.checked_at}`);
  assert.ok(net.reads >= 1, 'the database was never read, so "ok" measured nothing');
  assertNoStore(res);
  assertNothingSensitive(text);
});

test('H2: database read takes over 3 s -> 503 { ok: false, reason: "db_slow" }, answered by the 3 s budget', async () => {
  const GET = await route();
  net.mode = 'slow';
  const t0 = performance.now();
  const { res, body, text } = await call(GET);
  const took = performance.now() - t0;
  assert.equal(res.status, 503, text);
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'db_slow');
  // The monitor needs the answer at ~3 s, not whenever the database finally replies (3.5 s here, or never in a real stall).
  assert.ok(took < 3400, `answered after ${Math.round(took)} ms; the stubbed read took 3500`);
  assertNoStore(res);
  assertNothingSensitive(text);
});

test('H3: database returns an error -> 503 { ok: false, reason: "db_error" }, the error text stays server-side', async () => {
  const GET = await route();
  net.mode = 'pgError';
  const { res, body, text } = await call(GET);
  assert.equal(res.status, 503, text);
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'db_error');
  assertNoStore(res);
  assertNothingSensitive(text);
});

test('H4: database connection fails -> 503 { ok: false, reason: "db_error" } at once, never a thrown 500', async () => {
  const GET = await route();
  net.mode = 'netError';
  const t0 = performance.now();
  const { res, body, text } = await call(GET);
  assert.ok(performance.now() - t0 < 1000, `took ${Math.round(performance.now() - t0)} ms: the client retried the failed read`);
  assert.equal(res.status, 503, text);
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'db_error');
  assertNoStore(res);
  assertNothingSensitive(text);
});

/* supabase-js 2.106 RETRIES a GET on a network failure and on 503/520, waiting 1 s, 2 s, then 4 s. Left on, a failed read outlives the 3 s
 * budget and is reported as "db_slow"; the read needs `.retry(false)`. PGRST002 (schema cache not loaded, answered as 503) is exactly what
 * the dev database returned during the 2026-10-21 16:36 qa incident. */
test('H4b: PostgREST 503 PGRST002 (the 2026-10-21 incident) -> 503 "db_error" at once, not retried into "db_slow"', async () => {
  const GET = await route();
  net.mode = 'pgError';
  const realStub = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    await realStub(input, init).catch(() => null);
    return json(503, { code: 'PGRST002', message: `${LEAK} Could not query the database for the schema cache. Retrying.`, details: null, hint: null });
  }) as typeof fetch;
  try {
    const t0 = performance.now();
    const { res, body, text } = await call(GET);
    assert.equal(res.status, 503, text);
    assert.equal(body.reason, 'db_error');
    assert.ok(performance.now() - t0 < 1000, `took ${Math.round(performance.now() - t0)} ms: the client retried the failed read`);
    assertNothingSensitive(text);
  } finally {
    globalThis.fetch = realStub;
  }
});

/* supabase-js hands a failed connection back as `{ error }` rather than throwing, so H4 never reaches a throw. A client that cannot even be
 * built (settings missing on a host) is the throw: it must still read as a failed check, not a crash and never "ok". */
test('H9: database settings missing on the host -> 503 "db_error", not a thrown 500', async () => {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, service: process.env.SUPABASE_SERVICE_ROLE_KEY, anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    const GET = await route();
    const { res, body, text } = await call(GET);
    assert.equal(res.status, 503, text);
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'db_error');
    assertNoStore(res);
    assertNothingSensitive(text);
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url; process.env.SUPABASE_SERVICE_ROLE_KEY = saved.service; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.anon;
  }
});

test('H5: N calls inside 30 s make ONE database read and return the same check', async () => {
  const GET = await route();
  const first = await call(GET);
  const readsAfterFirst = net.reads;
  assert.ok(readsAfterFirst >= 1);
  offset += 29_000;
  for (let i = 0; i < 4; i++) {
    const again = await call(GET);
    assert.equal(again.res.status, 200);
    assert.equal(again.body.checked_at, first.body.checked_at, 'a call inside 30 s ran a new check');
    assertNoStore(again.res);
  }
  assert.equal(net.reads, readsAfterFirst, `5 calls inside 30 s made ${net.reads} reads`);
});

test('H6: calls arriving together while the first read is in flight still make ONE read', async () => {
  const GET = await route();
  const all = await Promise.all(Array.from({ length: 5 }, () => call(GET)));
  for (const r of all) assert.equal(r.res.status, 200, r.text);
  const reads = net.reads;
  const single = await (async () => { net.reads = 0; offset += 60_000; await call(await route()); return net.reads; })();
  assert.equal(reads, single, `5 simultaneous calls made ${reads} reads; one call makes ${single}`);
});

test('H7: after 30 s the next call reads the database again', async () => {
  const GET = await route();
  await call(GET);
  const readsAfterFirst = net.reads;
  offset += 31_000;
  const again = await call(GET);
  assert.equal(again.res.status, 200);
  assert.ok(net.reads > readsAfterFirst, 'a call 31 s later reused the old result');
});

test('H8: a stall clears on the next check after the cache window, so the monitor sees recovery', async () => {
  const GET = await route();
  net.mode = 'pgError';
  assert.equal((await call(GET)).res.status, 503);
  net.mode = 'fast';
  offset += 31_000;
  const healed = await call(GET);
  assert.equal(healed.res.status, 200, healed.text);
  assert.equal(healed.body.ok, true);
});
