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

test('H5: N calls inside 30 s make ONE database read, while each RESPONSE is stamped when it was served', async () => {
  /* REWRITTEN 2026-10-22, and the old version was wrong in a way worth recording. It asserted
     `again.body.checked_at === first.body.checked_at` - i.e. it PINNED the bug.
     Measured on production (8f4b23b, 17:56:22-28Z): three calls two seconds apart returned an identical `checked_at` AND an identical
     `db_ms` under `Cache-Control: no-store`. The header promised freshness the body did not deliver, so a reader taking `checked_at` as
     "now" was wrong by up to 30 seconds. For the breaker fields this is not cosmetic: an exchange block inside that cached body would
     report healthy for up to 30 s into a cooldown, and any cooldown shorter than 30 s would be invisible permanently.
     So the two facts are now carried by two fields, and this test checks both rather than conflating them:
       db_checked_at - when the DATABASE was last actually read. Identical across the window. That is the cache.
       checked_at    - when THIS response was served. Different every call. That is the freshness the no-store header promises.
     The clock is advanced INSIDE the loop on purpose: the old test moved it once before four calls, so all four shared one instant and a
     naive "they must differ" assertion would have failed a correct implementation. The fixture's Date.now is the only clock here. */
  /* `call()` types the body as Record<string, unknown> for the whole file, so these two narrow it HERE rather than casting. A cast would
     silence tsc while asserting nothing; these assert the type and then return it, which also covers the "present but carrying the STRING
     'undefined'" case - a field that vanished through JSON.stringify and was 'fixed' by stringifying it satisfies a key-presence check
     and means nothing. */
  const str = (v: unknown, name: string): string => {
    assert.equal(typeof v, 'string', `${name} is not a string: ${JSON.stringify(v)}`);
    return v as string;
  };
  const num = (v: unknown, name: string): number => {
    assert.equal(typeof v, 'number', `${name} is not a number: ${JSON.stringify(v)}`);
    return v as number;
  };

  const GET = await route();
  const first = await call(GET);
  const readsAfterFirst = net.reads;
  assert.ok(readsAfterFirst >= 1);
  assert.ok(first.body.db_checked_at, 'no db_checked_at: the cached read has no timestamp of its own');
  str(first.body.db_checked_at, 'db_checked_at');
  str(first.body.checked_at, 'checked_at');

  const STEP = 2_000; /* 4 x 2 s = 8 s, comfortably inside the 30 s window, so none of these may re-read (H7 owns the expiry) */
  let prev = first.body;
  for (let i = 1; i <= 4; i++) {
    offset += STEP;
    const again = await call(GET);
    assert.equal(again.res.status, 200);
    assertNoStore(again.res);

    assert.equal(again.body.db_checked_at, first.body.db_checked_at,
      `call ${i} inside 30 s re-read the database, or db_checked_at is being regenerated per request`);
    assert.notEqual(again.body.checked_at, prev.checked_at,
      `call ${i} returned the PREVIOUS response's checked_at - a no-store response must say when it was served, not when the cache was filled`);
    assert.ok(Date.parse(str(again.body.checked_at, `call ${i} checked_at`)) > Date.parse(str(prev.checked_at, 'previous checked_at')),
      `call ${i}'s checked_at went backwards or stood still: ${prev.checked_at} -> ${again.body.checked_at}`);

    /* db_age_ms is the same fact a reader can see WITHOUT calling twice - the whole point of adding it.
       `!= null` rather than `!== undefined`: the route's type allows null, and a null here must skip the arithmetic, not do it on 0. */
    if (again.body.db_age_ms != null) {
      const age = num(again.body.db_age_ms, `call ${i} db_age_ms`);
      const expected = i * STEP;
      assert.ok(Math.abs(age - expected) <= 100,
        `call ${i}: db_age_ms ${age} does not track the clock (expected about ${expected})`);
    }
    prev = again.body;
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

/* ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * #1649, THE EXCHANGE BREAKER GAUGE. Written because the implementation arrived with NO committed coverage of its new payload: the
 * ten assertions behind it were checked by a probe, and a probe is not coverage - nothing in the repo would catch a regression of
 * the credential gate or of the all-four-named property. Those are the two that matter most, for opposite reasons: the gate is
 * security-relevant, and the naming is what stops an absent key reading as a healthy one.
 *
 * The breaker is opened THE WAY PRODUCTION OPENS IT - exchangeFetch against a 429 - rather than through a test backdoor, so these
 * tests exercise the real trip path. Each one restores the fetch stand-in and resets the guard, because a tripped breaker lasts ten
 * minutes of fake-clock time and would otherwise leak into every test after it. ══════════════════════════════════════════════════ */

const EXCHANGES = ['binance', 'bybit', 'okx', 'hyperliquid'];

/** A request carrying the cron secret, which is how the detailed view is unlocked. */
const withSecret = () => new NextRequest('http://localhost/api/health', { headers: { 'x-cron-secret': CRON } });
async function callWith(GET: (req: NextRequest) => Promise<Response>, req: NextRequest) {
  const res = await GET(req);
  const text = await res.text();
  return { res, text, body: JSON.parse(text) as Record<string, unknown> };
}

/** Open one exchange's breaker through the real path: a 429 from that host. Restores the Supabase stand-in afterwards. */
async function tripBreaker(host: string) {
  const { exchangeFetch } = await import('../lib/exchangeGuard.ts');
  const saved = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes(host)) return new Response('{"retCode":10006,"retMsg":"Too many visits"}', { status: 429 });
    throw new Error(`tripBreaker saw an unexpected request: ${String(input)}`);
  }) as typeof fetch;
  try {
    await exchangeFetch(`https://${host}/v5/market/tickers`).catch(() => {});
  } finally {
    globalThis.fetch = saved;
  }
}
const resetGuard = async () => (await import('../lib/exchangeGuard.ts'))._resetExchangeGuard();

test('H10: the PUBLIC answer names every configured exchange, and carries no detailed figures', async () => {
  await resetGuard();
  const { body, text } = await call(await route());

  const exchanges = body.exchanges as Record<string, { degraded?: unknown }> | undefined;
  assert.ok(exchanges, 'no `exchanges` block: the breaker is invisible again, which is the whole point of #1649');
  /* Every one, every time. An absent key cannot be told apart from a healthy one - the same lesson as `NaN != null`. */
  for (const ex of EXCHANGES) {
    assert.ok(ex in exchanges, `${ex} is missing from the payload; present keys: ${Object.keys(exchanges).join(', ')}`);
    assert.equal(typeof exchanges[ex].degraded, 'boolean', `${ex}.degraded is ${JSON.stringify(exchanges[ex].degraded)}, not a boolean`);
  }
  assert.equal(Object.keys(exchanges).length, EXCHANGES.length, `unexpected exchanges: ${Object.keys(exchanges).join(', ')}`);

  /* okx and hyperliquid were as invisible as the two we talk about, and #1701 cannot audit a venue it cannot observe. */
  assert.ok('okx' in exchanges && 'hyperliquid' in exchanges, 'okx and hyperliquid must be reportable, not just binance and bybit');

  /* The detail is credentialed: strikes + cooling window + last upstream status together map our rate-limit exposure, and this
     endpoint is unauthenticated. A bare monitor request must not receive them. */
  assert.equal(body.exchange_detail, undefined, 'the public answer leaked exchange_detail to a request with no secret');
  assertNothingSensitive(text);
});

test('H11: WITH the cron secret the detail appears, and a counter that does not apply is null - never the string "undefined"', async () => {
  await resetGuard();
  const { res, body, text } = await callWith(await route(), withSecret());
  assert.equal(res.status, 200, text);

  const detail = body.exchange_detail as Record<string, Record<string, unknown>> | undefined;
  assert.ok(detail, 'the cron secret did not unlock exchange_detail');
  for (const ex of EXCHANGES) assert.ok(ex in detail, `${ex} missing from exchange_detail`);

  /* "4 strikes" means nothing without "in 60 minutes", so the window travels with the count. */
  assert.equal(typeof detail.bybit.strikes_window_ms, 'number', 'strikes_window_ms is missing, so a strike count cannot be read');

  /* JSON.stringify DROPS an undefined value, so these keys vanished entirely and an absent key reads as healthy. null is the fix -
     and the obvious wrong fix is to stringify, which satisfies a key-presence check while meaning nothing. Both are excluded. */
  for (const [ex, other] of [['bybit', 'binanceWeight'], ['binance', 'bybitLast5s']] as const) {
    assert.ok(other in detail[ex], `${ex}.${other} is absent; an absent key cannot be told apart from a healthy value`);
    assert.notEqual(detail[ex][other], 'undefined', `${ex}.${other} is the STRING "undefined" - a dropped value "fixed" by stringifying it`);
    assert.notEqual(detail[ex][other], 'null', `${ex}.${other} is the STRING "null"`);
    assert.equal(detail[ex][other], null, `${ex}.${other} should be null where the counter does not apply, got ${JSON.stringify(detail[ex][other])}`);
  }
  assertNothingSensitive(text);
});

test('H12: an open breaker is reported as degraded on THAT exchange only, and ok stays true with a 200', async () => {
  /* This is the assertion the implementation could only mark SKIP, because it needs the 200 database path. The stand-in supplies
     exactly that, so it is testable here: degraded is not down. A health check that reddens during every cooldown gets ignored,
     and then it is a mechanism wired to nothing - which is the failure #1649 exists to end. */
  await resetGuard();
  try {
    await tripBreaker('api.bybit.com');
    const { res, body, text } = await call(await route());

    assert.equal(res.status, 200, `an open breaker changed the status code: ${text}`);
    assert.equal(body.ok, true, 'an open breaker set ok:false - degraded is not down');

    const ex = body.exchanges as Record<string, { degraded: boolean }>;
    assert.equal(ex.bybit.degraded, true, 'bybit tripped but is not reported as degraded');
    for (const other of ['binance', 'okx', 'hyperliquid']) {
      assert.equal(ex[other].degraded, false, `${other} is reported degraded although only bybit tripped`);
    }
  } finally {
    await resetGuard();
  }
});

test('H13: the breaker is read PER REQUEST while the database stays cached', async () => {
  /* The property that makes this an instrument rather than a decoration. If the exchange block were computed inside the cached
     check, it would report healthy for up to 30 s into a cooldown and any cooldown shorter than that would be invisible for good.
     So: trip the breaker BETWEEN two calls inside the 30 s window, and require the second answer to show it while db_checked_at
     proves the database was not re-read. */
  await resetGuard();
  try {
    const GET = await route();
    const first = await call(GET);
    assert.equal((first.body.exchanges as Record<string, { degraded: boolean }>).bybit.degraded, false, 'bybit degraded before anything tripped');
    const readsAfterFirst = net.reads;

    await tripBreaker('api.bybit.com');
    offset += 5_000; /* still inside the 30 s database cache */

    const second = await call(GET);
    assert.equal((second.body.exchanges as Record<string, { degraded: boolean }>).bybit.degraded, true,
      'the second answer still says healthy, so the exchange block is being cached with the database check');
    assert.equal(second.body.db_checked_at, first.body.db_checked_at, 'precondition failed: the database WAS re-read, so this proves nothing about caching');
    assert.equal(net.reads, readsAfterFirst, 'precondition failed: a second database read happened inside the window');
  } finally {
    await resetGuard();
  }
});
