/* The price-alerts list returns EVERY active alert, not the newest 100 (#1152, PR #1500).
 *
 * GET /api/price-alerts used to stop at `.limit(100)` while creating alerts has no cap, so a Pro account with
 * more than 100 could neither see nor delete the older ones, and those kept firing. The fix pages through the
 * table in 1000-row ranges, ordered created_at desc then id desc, stops on the first short page, and bounds one
 * response at 10,000 rows with `truncated` saying so.
 *
 * WHAT RUNS: the REAL route handler, with the REAL @supabase/supabase-js client, against a stand-in for Supabase
 * auth and PostgREST at the network boundary (global `fetch`). Nothing in the route is mocked.
 *
 * THE STAND-IN PostgREST honours only what the request says. It applies each `col=eq.value` filter it receives
 * (and refuses any other operator), sorts by the `order` parameter it receives, and slices by `offset`/`limit`,
 * which is what postgrest-js 2.106 sends for `.range(from, to)` (`offset=from`, `limit=to-from+1`, read from
 * node_modules/@supabase/postgrest-js/dist/index.mjs). Every response is clamped at 1000 rows, PostgREST's
 * default `max-rows` on Supabase. A filter the route forgets is a filter the stand-in does not apply.
 *
 * EXPECTATIONS come from the seed, never from the route: each seeded account is built newest-first in a known
 * order (created_at descending, ties broken by a descending id) and inserted OLDEST-first, so an unordered read
 * comes back in the wrong order. Ids, users and tokens are synthetic.
 *
 * NOT PINNED, on purpose (see the two todos at the bottom): exactly 10,000 alerts, and rows changing between
 * page reads. Both are open follow-ups on #1500, not behaviour this file should freeze. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const UID_A = '00000000-0000-4000-8000-0000000000a1';
const UID_B = '00000000-0000-4000-8000-0000000000b2';
const TOKEN_A = 'user-token-for-A-not-a-real-jwt';
const TOKEN_B = 'user-token-for-B-not-a-real-jwt';
const TABLE_PATH = '/rest/v1/lhq_dev_price_alerts';
const MAX_ROWS = 1000;

process.env.NEXT_PUBLIC_APP_ENV = 'dev';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://stand-in.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_stand_in_key';

/* `apiError` reports through `Sentry.captureException`, which Node's ESM loader does not expose from
   `@sentry/nextjs`. Stubbed for this file only, as in cancelSubscription.test.mts. */
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === '@sentry/nextjs') {
      return { url: 'data:text/javascript,export function captureException(){}', shortCircuit: true };
    }
    return next(specifier, context);
  }`));

/* ── the stand-in world ─────────────────────────────────────────────────────────────────── */

type Row = { id: string; user_id: string; active: boolean; created_at: string; coin: string; target_price: number; direction: string; label: string };
type Call = { method: string; url: URL; authorization: string | null };
const calls: Call[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const world = {
  tokens: new Map<string, string>(),
  rows: [] as Row[],
  /* 1-based index of the table read that answers 500; 0 = none */
  failRead: 0,
};
function reset() {
  calls.length = 0;
  world.tokens = new Map([[TOKEN_A, UID_A], [TOKEN_B, UID_B]]);
  world.rows = [];
  world.failRead = 0;
}

const BASE_MS = Date.UTC(2026, 8, 1);
/* Seeds `n` alerts for `uid` and returns their ids NEWEST FIRST, the order the list must come back in. Three
   alerts share each created_at, so the id tie-break is exercised on every page; within a tie the larger id is
   newer. Inserted oldest first, so the stand-in's storage order is the reverse of the expected one. */
function seed(uid: string, n: number, opts: { active?: boolean; tag?: string } = {}): string[] {
  const active = opts.active ?? true;
  const tag = opts.tag ?? (uid === UID_A ? 'a' : 'b');
  const newestFirst: Row[] = [];
  for (let k = 0; k < n; k++) {
    newestFirst.push({
      id: `${tag}-${String(n - k).padStart(6, '0')}`,
      user_id: uid,
      active,
      created_at: new Date(BASE_MS - Math.floor(k / 3) * 60_000).toISOString(),
      coin: 'BTC',
      target_price: 100_000 + k,
      direction: 'above',
      label: '',
    });
  }
  world.rows.push(...[...newestFirst].reverse());
  return newestFirst.map((r) => r.id);
}

function standInSelect(url: URL): Row[] {
  let rows = world.rows;
  for (const [key, value] of url.searchParams) {
    if (['select', 'order', 'offset', 'limit'].includes(key)) continue;
    if (!value.startsWith('eq.')) throw new Error(`stand-in does not implement filter ${key}=${value}`);
    const want = value.slice(3);
    rows = rows.filter((r) => String((r as Record<string, unknown>)[key]) === want);
  }
  const order = url.searchParams.get('order');
  if (order) {
    const keys = order.split(',').map((part) => {
      const [col, dir] = part.split('.');
      if (dir !== 'asc' && dir !== 'desc') throw new Error(`stand-in does not implement order ${part}`);
      return { col, sign: dir === 'desc' ? -1 : 1 };
    });
    rows = [...rows].sort((x, y) => {
      for (const { col, sign } of keys) {
        const a = String((x as Record<string, unknown>)[col]);
        const b = String((y as Record<string, unknown>)[col]);
        if (a !== b) return a < b ? -sign : sign;
      }
      return 0;
    });
  }
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : Infinity;
  return rows.slice(offset, offset + Math.min(limit, MAX_ROWS));
}

globalThis.fetch = (async (input: unknown, init: { method?: string; headers?: HeadersInit } = {}) => {
  const url = new URL(String((input as { url?: string })?.url ?? input));
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers ?? {});
  calls.push({ method, url, authorization: headers.get('authorization') });

  if (url.pathname === '/auth/v1/user') {
    const uid = world.tokens.get((headers.get('authorization') ?? '').replace(/^Bearer /, ''));
    return uid
      ? json({ id: uid, aud: 'authenticated', role: 'authenticated', email: `${uid}@example.com`, app_metadata: {}, user_metadata: {}, created_at: '2020-01-01T00:00:00Z' })
      : json({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }, 401);
  }
  if (url.pathname === TABLE_PATH && method === 'GET') {
    if (world.failRead && reads().length === world.failRead) {
      return json({ code: 'XX000', message: 'stand-in: read failed', details: '', hint: '' }, 500);
    }
    return json(standInSelect(url));
  }
  throw new Error(`stand-in got an unexpected request: ${method} ${url}`);
}) as typeof fetch;

const reads = () => calls.filter((c) => c.url.pathname.startsWith('/rest/v1/'));
const param = (c: Call, key: string) => c.url.searchParams.get(key);

async function list(token: string | null) {
  const { GET } = await import('../app/api/price-alerts/route.ts');
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await GET(new Request('http://x/api/price-alerts', { method: 'GET', headers }) as never);
  return { status: res.status, body: (await res.json()) as { alerts?: Row[]; truncated?: boolean; error?: string } };
}
const ids = (body: { alerts?: Row[] }) => (body.alerts ?? []).map((r) => r.id);

/* ── cases ──────────────────────────────────────────────────────────────────────────────── */

test('1. an account with no alerts costs exactly one read (offset 0, limit 1000) and answers an empty, untruncated list, because a first short page is the end', async () => {
  reset();
  const r = await list(TOKEN_A);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { alerts: [], truncated: false });
  assert.equal(reads().length, 1);
  assert.deepEqual([param(reads()[0], 'offset'), param(reads()[0], 'limit')], ['0', '1000']);
});

test('2. 150 alerts all come back from one read, newest first by created_at then id, because the old .limit(100) hid the oldest 50 and they kept firing', async () => {
  reset();
  const want = seed(UID_A, 150);
  const r = await list(TOKEN_A);
  assert.equal(r.status, 200);
  assert.equal(reads().length, 1);
  assert.equal(param(reads()[0], 'order'), 'created_at.desc,id.desc', 'without the id tie-break a page boundary can skip or repeat a row');
  assert.equal(r.body.alerts?.length, 150);
  assert.deepEqual(ids(r.body), want);
  assert.equal(r.body.truncated, false);
});

test('3. exactly 1000 alerts take two reads (offsets 0 and 1000), because a FULL page cannot tell the route it was the last one', async () => {
  reset();
  const want = seed(UID_A, 1000);
  const r = await list(TOKEN_A);
  assert.equal(r.status, 200);
  assert.deepEqual(reads().map((c) => [param(c, 'offset'), param(c, 'limit')]), [['0', '1000'], ['1000', '1000']]);
  assert.deepEqual(ids(r.body), want);
  assert.equal(r.body.truncated, false);
});

test('4. 2500 alerts take three reads and come back complete, unique and in descending order, because pages must join without a gap or a repeat', async () => {
  reset();
  const want = seed(UID_A, 2500);
  const r = await list(TOKEN_A);
  assert.equal(r.status, 200);
  assert.deepEqual(reads().map((c) => param(c, 'offset')), ['0', '1000', '2000']);
  const got = ids(r.body);
  assert.equal(got.length, 2500);
  assert.equal(new Set(got).size, 2500, 'an alert appears twice');
  assert.deepEqual(got, want, 'the list is not newest-first across page boundaries');
  assert.equal(r.body.truncated, false);
});

test('5. 10,001 alerts stop at ten reads with the newest 10,000 and truncated true, because one response is bounded and must SAY it was cut rather than cut silently', async () => {
  reset();
  const want = seed(UID_A, 10_001);
  const r = await list(TOKEN_A);
  assert.equal(r.status, 200);
  assert.deepEqual(reads().map((c) => param(c, 'offset')), ['0', '1000', '2000', '3000', '4000', '5000', '6000', '7000', '8000', '9000']);
  assert.equal(r.body.alerts?.length, 10_000);
  assert.deepEqual(ids(r.body), want.slice(0, 10_000), 'the 10,000 returned are not the newest');
  assert.equal(r.body.truncated, true);
});

test('6. every page read filters to the caller and to active alerts, because another user\'s rows or a deleted (inactive) alert must never appear on any page, not just the first', async () => {
  reset();
  const wantA = seed(UID_A, 1200);
  seed(UID_A, 300, { active: false, tag: 'a-deleted' });
  const wantB = seed(UID_B, 500);
  const a = await list(TOKEN_A);
  assert.equal(a.status, 200);
  assert.equal(reads().length, 2, 'precondition: the caller\'s list spans two pages');
  for (const c of reads()) {
    assert.equal(param(c, 'user_id'), `eq.${UID_A}`, `page at offset ${param(c, 'offset')} is not filtered to the caller`);
    assert.equal(param(c, 'active'), 'eq.true', `page at offset ${param(c, 'offset')} is not filtered to active alerts`);
    assert.equal(c.authorization, `Bearer ${TOKEN_A}`, 'the read did not carry the caller\'s token, so RLS is not the second line');
  }
  assert.deepEqual(ids(a.body), wantA);
  assert.ok((a.body.alerts ?? []).every((row) => row.user_id === UID_A && row.active === true));

  calls.length = 0;
  const b = await list(TOKEN_B);
  assert.deepEqual(ids(b.body), wantB, 'B saw something other than exactly B\'s active alerts');
});

for (const failRead of [1, 2, 3]) {
  test(`7. a failed read on page ${failRead} of 3 answers 500 with NO alerts key, because a partial list would show the user an incomplete set as if it were all of them`, async (t) => {
    t.mock.method(console, 'error', () => {});
    reset();
    seed(UID_A, 2500);
    world.failRead = failRead;
    const r = await list(TOKEN_A);
    assert.equal(r.status, 500);
    assert.equal('alerts' in r.body, false, `a partial list came back: ${r.body.alerts?.length} rows`);
    assert.equal('truncated' in r.body, false);
    assert.equal(reads().length, failRead, 'the route kept reading after a failed page');
  });
}

test('8a. no Authorization header answers 401 before ANY request, because the list is user data and an anonymous caller gets nothing to page through', async () => {
  reset();
  seed(UID_A, 150);
  const r = await list(null);
  assert.equal(r.status, 401);
  assert.equal('alerts' in r.body, false);
  assert.equal(calls.length, 0, 'a request was made without a token');
});

test('8b. a token that resolves to no user answers 401 and reads no alerts, because an unknown caller has no user_id to filter on', async () => {
  reset();
  seed(UID_A, 150);
  const r = await list('not-a-token');
  assert.equal(r.status, 401);
  assert.equal('alerts' in r.body, false);
  assert.equal(reads().length, 0, 'the table was read for a caller who is not signed in');
});

/* ── open follow-ups on #1500, recorded rather than frozen ──────────────────────────────────── */

test.todo('exactly 10,000 active alerts: the loop ends on a full page and answers truncated true although nothing was cut (needs one extra read, or a count, to tell "exactly at the bound" from "over it")');
test.todo('an alert inserted or deactivated between two page reads shifts every later offset by one, so a row is skipped or repeated (offset paging; keyset paging on created_at,id would not)');
