/* Cancel a plan (#1396, PR #1435): the first outbound call this app makes to Lemon Squeezy's API.
 *
 * THREE LAYERS, for the reason the one-active-plan file gives: the pure client cannot show that a ROUTE
 * derives the subscription id from the caller's own row, refuses when it should and writes nothing.
 *
 *   L      lib/lemonsqueezyApi.ts  `cancelSubscription`, against a stand-in for `fetch`
 *   P      POST /api/lemonsqueezy/cancel, the REAL handler, against a stand-in for Supabase auth, the REST
 *          API and Lemon Squeezy, all at the network boundary
 *   G      GET /api/subscription, the REAL handler: the `canCancel` matrix and what it must not leak
 *
 * WHAT IS OBSERVED AND WHAT IS NOT - the difference is the point of this file:
 *   NOT OBSERVED, DOCUMENTED ONLY: everything about what Lemon Squeezy answers. The request shape, the
 *     `data.attributes.status` / `ends_at` fields, the status codes. No real call has been made. The response
 *     bodies below are SYNTHETIC, shaped from the docs the client's own header cites, and no assertion here
 *     treats a Lemon Squeezy field as fact: they pin what OUR code does with each answer it might get.
 *   OBSERVED: nothing yet. The first call on qa is the capture; this file changes after it, not before.
 *
 * Every expectation is written from the design in the PR (BOLA, fail closed, the webhook is the single writer of the
 * row), as literal cases, not computed from the code under test. Ids and the "key" are synthetic; the key is
 * JWT-shaped because Lemon Squeezy's keys are. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { cancelSubscription, isLsApiConfigured } from '../lib/lemonsqueezyApi.ts';

const LS_BASE = 'https://api.lemonsqueezy.com/v1';
const LS_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.stand-in-payload-not-a-real-key.stand-in-signature';
const UID_A = '00000000-0000-4000-8000-0000000000a1';
const UID_B = '00000000-0000-4000-8000-0000000000b2';
const TOKEN_A = 'user-token-for-A-not-a-real-jwt';
const TOKEN_B = 'user-token-for-B-not-a-real-jwt';

process.env.NEXT_PUBLIC_APP_ENV = 'dev';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://stand-in.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_stand_in_key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_stand_in_key';

/* `apiError` reports through `Sentry.captureException`, which Node's ESM loader does not expose from
   `@sentry/nextjs`. Stubbed for this file only; what is asserted is the line apiError logs first. */
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === '@sentry/nextjs') {
      return { url: 'data:text/javascript,export function captureException(){}', shortCircuit: true };
    }
    return next(specifier, context);
  }`));

/* ── the stand-in world ─────────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;
type Call = { method: string; url: string; headers: Record<string, string>; body?: string };
const calls: Call[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const lsSuccess = (attrs: Record<string, unknown> = { status: 'cancelled', ends_at: '2098-10-08T05:26:55.000000Z' }) =>
  () => json({ data: { type: 'subscriptions', id: 'x', attributes: attrs } });

const world = {
  tokens: new Map<string, string>(),
  rows: new Map<string, Row>(),
  dbError: false,
  lsThrows: false,
  ls: lsSuccess() as (id: string) => Response,
};
function reset(over: { key?: string | undefined } = { key: LS_KEY }) {
  calls.length = 0;
  world.tokens = new Map([[TOKEN_A, UID_A], [TOKEN_B, UID_B]]);
  world.rows = new Map();
  world.dbError = false;
  world.lsThrows = false;
  world.ls = lsSuccess();
  if (over.key === undefined) delete process.env.LEMONSQUEEZY_API_KEY;
  else process.env.LEMONSQUEEZY_API_KEY = over.key;
}
const seed = (uid: string, over: Row = {}) => {
  world.rows.set(uid, {
    user_id: uid, role: 'pro', ls_status: 'active', ls_subscription_id: uid === UID_A ? 'SUB_A' : 'SUB_B',
    ls_customer_id: uid === UID_A ? 'CUST_A' : 'CUST_B', current_period_end: '2099-09-25T00:00:00.000Z', ...over,
  });
};

globalThis.fetch = (async (input: unknown, init: { method?: string; headers?: HeadersInit; body?: unknown } = {}) => {
  const url = new URL(String((input as { url?: string })?.url ?? input));
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers ?? {});
  calls.push({ method, url: url.toString(), headers: Object.fromEntries(headers.entries()), body: typeof init.body === 'string' ? init.body : undefined });

  if (url.host === 'api.lemonsqueezy.com') {
    if (world.lsThrows) throw new TypeError('fetch failed (stand-in)');
    return world.ls(url.pathname.split('/').pop() ?? '');
  }
  if (url.pathname === '/auth/v1/user') {
    const uid = world.tokens.get((headers.get('authorization') ?? '').replace(/^Bearer /, ''));
    return uid
      ? json({ id: uid, aud: 'authenticated', role: 'authenticated', email: `${uid}@example.com`, app_metadata: {}, user_metadata: {}, created_at: '2020-01-01T00:00:00Z' })
      : json({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }, 401);
  }
  if (url.pathname.endsWith('_user_subscriptions')) {
    if (method !== 'GET') return new Response(null, { status: 201 });
    if (world.dbError) return json({ code: 'XX000', message: 'stand-in: read failed', details: '', hint: '' }, 500);
    const uid = (url.searchParams.get('user_id') ?? '').replace(/^eq\./, '');
    const row = world.rows.get(uid);
    if (!row) return json([]);
    const cols = (url.searchParams.get('select') ?? '*').split(',').map((c) => c.trim());
    return json([cols[0] === '*' ? row : Object.fromEntries(cols.map((c) => [c, row[c]]))]);
  }
  throw new Error(`stand-in got an unexpected request: ${method} ${url}`);
}) as typeof fetch;

const lsCalls = () => calls.filter((c) => c.url.startsWith(LS_BASE));
const dbWrites = () => calls.filter((c) => c.url.includes('/rest/v1/') && c.method !== 'GET');
const dbReads = () => calls.filter((c) => c.url.includes('/rest/v1/'));

async function cancelRoute(token: string | null, opts: { body?: string; query?: string; extraHeaders?: Record<string, string> } = {}) {
  const { POST } = await import('../app/api/lemonsqueezy/cancel/route.ts');
  const headers: Record<string, string> = { ...(opts.extraHeaders ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await POST(new Request(`http://x/api/lemonsqueezy/cancel${opts.query ?? ''}`, { method: 'POST', headers, body: opts.body }) as never);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
async function subRoute(token: string | null) {
  const { GET } = await import('../app/api/subscription/route.ts');
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await GET(new Request('http://x/api/subscription', { method: 'GET', headers }) as never);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/* ══ L — lib/lemonsqueezyApi.ts ═══════════════════════════════════════════════════════════════ */

test('L1. no API key: fails closed with ls_api_key_unset and makes NO request', async () => {
  reset({ key: undefined });
  const r = await cancelSubscription('SUB_A');
  assert.deepEqual([r.ok, r.reason, r.status], [false, 'ls_api_key_unset', 0]);
  assert.equal(calls.length, 0, 'a request was made without a key');
});

test('L2. no subscription id: fails closed and makes NO request', async () => {
  reset();
  const r = await cancelSubscription('');
  assert.deepEqual([r.ok, r.reason], [false, 'no_subscription_id']);
  assert.equal(calls.length, 0);
});

test('L3. what we SEND (as documented, not observed): DELETE /v1/subscriptions/<id> with the key as a Bearer token', async () => {
  reset();
  await cancelSubscription('SUB_A');
  assert.equal(lsCalls().length, 1);
  const c = lsCalls()[0];
  assert.equal(c.method, 'DELETE');
  assert.equal(c.url, `${LS_BASE}/subscriptions/SUB_A`);
  assert.equal(c.headers.authorization, `Bearer ${LS_KEY}`);
  assert.equal(c.headers.accept, 'application/vnd.api+json');
  assert.equal(c.body, undefined, 'a body was sent on a DELETE');
});

test('L4. the id is URL-encoded: a hostile-looking id cannot add path segments or a query', async () => {
  reset();
  await cancelSubscription('../x/1 2?admin=1');
  const c = lsCalls()[0];
  assert.equal(new URL(c.url).pathname, '/v1/subscriptions/..%2Fx%2F1%202%3Fadmin%3D1');
  assert.equal(new URL(c.url).search, '');
});

test('L5. a 2xx whose status is "cancelled" succeeds and carries ends_at', async () => {
  reset();
  world.ls = lsSuccess({ status: 'cancelled', ends_at: '2098-10-08T05:26:55.000000Z' });
  const r = await cancelSubscription('SUB_A');
  assert.deepEqual([r.ok, r.reason, r.status, r.lsStatus, r.endsAt], [true, 'cancelled', 200, 'cancelled', '2098-10-08T05:26:55.000000Z']);
});

test('L6. a 2xx "cancelled" with no ends_at still succeeds, with endsAt null', async () => {
  reset();
  world.ls = lsSuccess({ status: 'cancelled' });
  const r = await cancelSubscription('SUB_A');
  assert.deepEqual([r.ok, r.endsAt], [true, null]);
  world.ls = lsSuccess({ status: 'cancelled', ends_at: 12345 });
  assert.equal((await cancelSubscription('SUB_A')).endsAt, null, 'a non-string ends_at must not be passed on');
});

for (const status of ['active', 'paused', 'past_due', 'expired', 'on_trial', 'unpaid', '']) {
  test(`L7. a 2xx whose status is "${status}" is NOT a cancellation: fails closed, the status is reported`, async () => {
    reset();
    world.ls = lsSuccess({ status });
    const r = await cancelSubscription('SUB_A');
    assert.equal(r.ok, false);
    assert.equal(r.reason, `ok_but_status_${status}`);
    assert.equal(r.status, 200);
  });
}

test('L7b. a 2xx with NO status field at all fails closed', async () => {
  reset();
  world.ls = () => json({ data: { attributes: {} } });
  const r = await cancelSubscription('SUB_A');
  assert.deepEqual([r.ok, r.reason, r.lsStatus], [false, 'ok_but_status_missing', null]);
});

for (const [label, body] of [['empty', ''], ['html', '<html>maintenance</html>'], ['json null', 'null'], ['json array', '[]'], ['plain text', 'ok']] as const) {
  test(`L8. a 2xx with a ${label} body is never reported as success`, async () => {
    reset();
    world.ls = () => new Response(body, { status: 200 });
    const r = await cancelSubscription('SUB_A');
    assert.equal(r.ok, false, `a ${label} body was treated as a cancellation`);
    assert.match(r.reason, /^ok_(status_unparsable_body|but_status_missing)/);
  });
}

for (const status of [400, 401, 404, 409, 422, 429, 500, 503]) {
  test(`L9. HTTP ${status} fails closed and keeps the status`, async () => {
    reset();
    world.ls = () => json({ errors: [{ detail: 'stand-in refusal' }] }, status);
    const r = await cancelSubscription('SUB_A');
    assert.equal(r.ok, false);
    assert.equal(r.status, status);
    assert.match(r.reason, new RegExp(`^ls_status_${status}:`));
  });
}

test('L10. a network error fails closed with status 0', async () => {
  reset();
  world.lsThrows = true;
  const r = await cancelSubscription('SUB_A');
  assert.deepEqual([r.ok, r.status], [false, 0]);
  assert.match(r.reason, /^fetch_failed:/);
});

test('L11. redaction: a Bearer token, a JWT and an api_key echoed in an error body never reach `reason`', async () => {
  reset();
  const secrets = ['abc123SECRETtokenXYZ', 'eyJhbGciOiJSUzI1NiJ9.payloadpayloadpayload.signaturesignature', 'sk_live_verylongsecretvalue0123'];
  world.ls = () => new Response(
    `Authorization: Bearer ${secrets[0]} ... token ${secrets[1]} ... {"api_key": "${secrets[2]}"}`, { status: 401 });
  const r = await cancelSubscription('SUB_A');
  for (const s of secrets) assert.equal(r.reason.includes(s), false, `"${s.slice(0, 12)}..." leaked into the reason`);
  assert.match(r.reason, /\[redacted/);
});

test('L12. the configured key, echoed back by a server, is not in `reason` (JWT-shaped, as Lemon Squeezy keys are)', async () => {
  reset();
  world.ls = () => new Response(`bad request for key ${LS_KEY}`, { status: 400 });
  const r = await cancelSubscription('SUB_A');
  assert.equal(r.reason.includes(LS_KEY), false);
  assert.equal(r.reason.includes('stand-in-payload'), false);
});

test('L13. `reason` is length-capped: a huge error body cannot flood a log', async () => {
  reset();
  world.ls = () => new Response('x'.repeat(50_000), { status: 500 });
  const r = await cancelSubscription('SUB_A');
  assert.ok(r.reason.length <= 'ls_status_500:'.length + 600, `reason is ${r.reason.length} chars`);
});

test('L14. the client touches only Lemon Squeezy and never the database', async () => {
  reset();
  await cancelSubscription('SUB_A');
  assert.ok(calls.every((c) => c.url.startsWith(LS_BASE)), calls.map((c) => c.url).join(', '));
});

test('L15. isLsApiConfigured reads the environment AT CALL TIME', () => {
  reset({ key: undefined });
  assert.equal(isLsApiConfigured(), false);
  process.env.LEMONSQUEEZY_API_KEY = LS_KEY;
  assert.equal(isLsApiConfigured(), true);
  process.env.LEMONSQUEEZY_API_KEY = '';
  assert.equal(isLsApiConfigured(), false, 'an empty key must count as unset');
});

/* ══ P — POST /api/lemonsqueezy/cancel ═══════════════════════════════════════════════════════ */

test('P1. no Authorization header: 401, nothing read, nothing sent to Lemon Squeezy', async () => {
  reset();
  seed(UID_A);
  const r = await cancelRoute(null);
  assert.equal(r.status, 401);
  assert.equal(lsCalls().length, 0);
  assert.equal(dbReads().length, 0);
});

test('P2. a token that does not resolve to a user: 401, nothing sent', async () => {
  reset();
  seed(UID_A);
  const r = await cancelRoute('not-a-token');
  assert.equal(r.status, 401);
  assert.equal(lsCalls().length, 0);
});

test('P3. no API key on the server (production today): 200 "unavailable", NOTHING read and nothing sent', async () => {
  reset({ key: undefined });
  seed(UID_A);
  const r = await cancelRoute(TOKEN_A);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: false, reason: 'unavailable' });
  assert.equal(lsCalls().length, 0);
  assert.equal(dbReads().length, 0, 'the database was read even though the feature is unavailable');
});

test('P4. BOLA: the subscription id comes from the CALLER\'S row, never from the request', async () => {
  reset();
  seed(UID_A);
  seed(UID_B);
  // every place a crafted id could ride: body (JSON and form), query string, headers
  const r = await cancelRoute(TOKEN_A, {
    body: JSON.stringify({ subscriptionId: 'SUB_B', subscription_id: 'SUB_B', id: 'SUB_B', user_id: UID_B, userId: UID_B }),
    query: '?subscriptionId=SUB_B&id=SUB_B&user_id=' + UID_B,
    extraHeaders: { 'x-user-id': UID_B, 'x-subscription-id': 'SUB_B', 'content-type': 'application/json' },
  });
  assert.equal(r.status, 200);
  assert.equal(lsCalls().length, 1);
  assert.equal(lsCalls()[0].url, `${LS_BASE}/subscriptions/SUB_A`, 'the caller cancelled somebody else\'s subscription');
  assert.equal(calls.some((c) => c.url.includes('SUB_B')), false, 'SUB_B appears in a request');
});

test('P4b. BOLA, the other direction: B\'s token cancels B\'s subscription and A\'s is never touched', async () => {
  reset();
  seed(UID_A);
  seed(UID_B);
  await cancelRoute(TOKEN_B, { body: JSON.stringify({ subscriptionId: 'SUB_A' }) });
  assert.deepEqual(lsCalls().map((c) => c.url), [`${LS_BASE}/subscriptions/SUB_B`]);
});

test('P5. a user with no subscription row: "no_subscription", nothing sent', async () => {
  reset();
  const r = await cancelRoute(TOKEN_A);
  assert.deepEqual([r.status, r.body], [200, { ok: false, reason: 'no_subscription' }]);
  assert.equal(lsCalls().length, 0);
});

for (const id of [null, '']) {
  test(`P6. a Pro row with subscription id ${JSON.stringify(id)} (an admin grant): "no_subscription", nothing sent`, async () => {
    reset();
    seed(UID_A, { ls_subscription_id: id, ls_status: '' });
    const r = await cancelRoute(TOKEN_A);
    assert.deepEqual([r.status, r.body], [200, { ok: false, reason: 'no_subscription' }]);
    assert.equal(lsCalls().length, 0);
  });
}

test('P7. a row already cancelled: "already_cancelled", nothing sent (this is why a second cancel cannot reach Lemon Squeezy)', async () => {
  reset();
  seed(UID_A, { ls_status: 'cancelled' });
  const r = await cancelRoute(TOKEN_A);
  assert.deepEqual([r.status, r.body], [200, { ok: false, reason: 'already_cancelled' }]);
  assert.equal(lsCalls().length, 0);
});

for (const status of [400, 401, 404, 422, 429, 500]) {
  test(`P8. Lemon Squeezy answers ${status}: 502 generic, nothing written, the reason is logged and no secret is`, async (t) => {
    reset();
    seed(UID_A);
    world.ls = () => new Response(`upstream said no; Bearer leakedtokenvalue123; ${LS_KEY}`, { status });
    const err = t.mock.method(console, 'error', () => {});
    const r = await cancelRoute(TOKEN_A);
    assert.equal(r.status, 502);
    assert.deepEqual(r.body, { ok: false, error: 'Cancel failed' }, 'the client must get a generic failure, not the upstream text');
    assert.equal(dbWrites().length, 0);
    const logged = err.mock.calls.map((c) => String(c.arguments[0])).join('\n');
    assert.match(logged, new RegExp(`LS cancel failed for user=${UID_A} - reason=ls_status_${status}`));
    assert.equal(logged.includes('leakedtokenvalue123'), false, 'a bearer token reached the log');
    assert.equal(logged.includes(LS_KEY), false, 'the API key reached the log');
    assert.equal(logged.includes(TOKEN_A), false, 'the caller\'s token reached the log');
  });
}

test('P9. a 2xx that is not a cancellation (wrong status, unreadable body) is a 502 and writes nothing', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const make of [lsSuccess({ status: 'active' }), () => new Response('<html>', { status: 200 }), () => new Response('', { status: 200 })]) {
    reset();
    seed(UID_A);
    world.ls = make as (id: string) => Response;
    const r = await cancelRoute(TOKEN_A);
    assert.equal(r.status, 502);
    assert.equal(r.body.ok, false);
    assert.equal(dbWrites().length, 0);
  }
});

test('P10. a network error to Lemon Squeezy is a 502 and writes nothing', async (t) => {
  t.mock.method(console, 'error', () => {});
  reset();
  seed(UID_A);
  world.lsThrows = true;
  const r = await cancelRoute(TOKEN_A);
  assert.equal(r.status, 502);
  assert.equal(dbWrites().length, 0);
});

test('P11. SUCCESS: 200 with endsAt, and the route WRITES NOTHING (the webhook is the row\'s single writer)', async () => {
  reset();
  seed(UID_A);
  const r = await cancelRoute(TOKEN_A);
  assert.deepEqual([r.status, r.body], [200, { ok: true, endsAt: '2098-10-08T05:26:55.000000Z' }]);
  assert.equal(dbWrites().length, 0, 'the cancel route wrote the row: two writers of one row is how #1429 happened');
  assert.equal(lsCalls().length, 1);
});

test('P12. the response never contains the subscription id', async () => {
  reset();
  seed(UID_A);
  const ok = await cancelRoute(TOKEN_A);
  assert.equal(JSON.stringify(ok.body).includes('SUB_A'), false);
});

test('P13. a failed read of the caller\'s row: 503, and NOTHING is sent to Lemon Squeezy', async (t) => {
  t.mock.method(console, 'error', () => {});
  reset();
  seed(UID_A);
  world.dbError = true;
  const r = await cancelRoute(TOKEN_A);
  assert.equal(r.status, 503);
  assert.equal(lsCalls().length, 0, 'an unknown row state must not lead to a cancel');
});

test('P14. the request body is never parsed: garbage does not stop, or change, the cancel', async () => {
  reset();
  seed(UID_A);
  const r = await cancelRoute(TOKEN_A, { body: '{not json', extraHeaders: { 'content-type': 'application/json' } });
  assert.equal(r.status, 200);
  assert.equal(lsCalls()[0].url, `${LS_BASE}/subscriptions/SUB_A`);
});

/* ══ G — GET /api/subscription ═══════════════════════════════════════════════════════════════ */

test('G1. no token, or a token that resolves to no user: 401', async () => {
  reset();
  seed(UID_A);
  assert.equal((await subRoute(null)).status, 401);
  assert.equal((await subRoute('nope')).status, 401);
});

/* canCancel = role pro AND a stored subscription id AND status not cancelled AND the server can call LS.
   Written from the PR's stated rule. */
const CAN_CANCEL: { name: string; row: Row | null; key: boolean; want: { role: string; hasSubscription: boolean; canCancel: boolean } }[] = [
  { name: 'no row at all', row: null, key: true, want: { role: 'free', hasSubscription: false, canCancel: false } },
  { name: 'free, never paid', row: { role: 'free', ls_subscription_id: null, ls_status: '' }, key: true, want: { role: 'free', hasSubscription: false, canCancel: false } },
  { name: 'free trial (no subscription)', row: { role: 'free', ls_subscription_id: null, ls_status: '', trial_ends_at: '2099-01-01T00:00:00Z' }, key: true, want: { role: 'free', hasSubscription: false, canCancel: false } },
  { name: 'free, access ended by a failed payment (id kept)', row: { role: 'free', ls_status: 'past_due' }, key: true, want: { role: 'free', hasSubscription: true, canCancel: false } },
  { name: 'free, subscription expired (id kept)', row: { role: 'free', ls_status: 'expired' }, key: true, want: { role: 'free', hasSubscription: true, canCancel: false } },
  { name: 'pro, live subscription', row: {}, key: true, want: { role: 'pro', hasSubscription: true, canCancel: true } },
  { name: 'pro, live subscription, status not recorded', row: { ls_status: null }, key: true, want: { role: 'pro', hasSubscription: true, canCancel: true } },
  { name: 'pro, cancelled but still in its paid period', row: { ls_status: 'cancelled' }, key: true, want: { role: 'pro', hasSubscription: true, canCancel: false } },
  { name: 'pro with no subscription id (admin grant)', row: { ls_subscription_id: null, ls_status: '' }, key: true, want: { role: 'pro', hasSubscription: false, canCancel: false } },
  { name: 'pro, live subscription, server has NO Lemon Squeezy key (production today)', row: {}, key: false, want: { role: 'pro', hasSubscription: true, canCancel: false } },
];
for (const c of CAN_CANCEL) {
  test(`G2. canCancel: ${c.name}`, async () => {
    reset({ key: c.key ? LS_KEY : undefined });
    if (c.row) seed(UID_A, c.row);
    const r = await subRoute(TOKEN_A);
    assert.equal(r.status, 200);
    assert.deepEqual({ role: r.body.role, hasSubscription: r.body.hasSubscription, canCancel: r.body.canCancel }, c.want);
  });
}

test('G3. the response has exactly the five documented fields and never the subscription or customer id', async () => {
  reset();
  seed(UID_A);
  const r = await subRoute(TOKEN_A);
  assert.deepEqual(Object.keys(r.body).sort(), ['canCancel', 'currentPeriodEnd', 'hasSubscription', 'lsStatus', 'role']);
  const text = JSON.stringify(r.body);
  for (const secret of ['SUB_A', 'CUST_A', UID_A]) assert.equal(text.includes(secret), false, `${secret} is in the response`);
});

test('G4. user isolation: each token sees only its own row', async () => {
  reset();
  seed(UID_A, { current_period_end: '2099-01-01T00:00:00Z' });
  seed(UID_B, { role: 'free', ls_subscription_id: null, ls_status: '', current_period_end: null });
  assert.equal((await subRoute(TOKEN_A)).body.role, 'pro');
  assert.equal((await subRoute(TOKEN_B)).body.role, 'free');
  assert.equal((await subRoute(TOKEN_B)).body.hasSubscription, false);
});

test('G5. a failed read: 503 with a neutral error, never a guessed state', async (t) => {
  t.mock.method(console, 'error', () => {});
  reset();
  seed(UID_A);
  world.dbError = true;
  const r = await subRoute(TOKEN_A);
  assert.equal(r.status, 503);
  assert.equal('canCancel' in r.body, false, 'a failed read must not carry a canCancel');
});

/* ── FINDING (#1435 review): the comment says the button and the route's guard agree. They do not. ───────
 * `app/api/subscription/route.ts` says `canCancel` is computed there "so the button's presence and the route's
 * guard agree". The route checks the id and `ls_status === 'cancelled'` and never the role, so a row where
 * canCancel is FALSE (a free user whose payment failed or whose subscription expired, the id kept) still gets a
 * cancel sent to Lemon Squeezy by anyone who calls the route. It is their own subscription (BOLA holds), so this
 * is a consistency gap, not a leak. `todo`: it runs, fails today, and turns green when the route or the comment
 * is changed; Dev decides which. */
test('D1. FINDING: wherever canCancel is false, the route also refuses (the comment says they agree)',
  { todo: 'finding on #1435: POST does not check the role, so a free user with a kept subscription id is cancelled upstream' }, async () => {
    reset();
    seed(UID_A, { role: 'free', ls_status: 'past_due' });
    assert.equal((await subRoute(TOKEN_A)).body.canCancel, false, 'precondition: the button would not be offered');
    await cancelRoute(TOKEN_A);
    assert.equal(lsCalls().length, 0, 'the route sent a cancel for a row the button would not offer');
  });
