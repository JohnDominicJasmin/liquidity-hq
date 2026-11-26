/* QA: PR #2850: the dry-run switch of the unconfirmed-account clean-up; with #2851 (owner item 102) the order of the real run. The real route, lib and Supabase client run; the database
 * and auth service are stand-ins that hand back one sign-up row and one trial claim.
 *   D1 switch on ("1", "true", " yes ", anything but unset / empty / "0"): no account, row or claim is deleted; the log says what would go; the route's answer is as before
 *   D2 unset, empty and "0": the real run: the sign-up row, the account, then only the blank claim with that address
 *   D3 the account delete refused: the row is written back exactly as read, the claim is not touched */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
const SECRET = 'qa-cron-secret-0123456789'; process.env.CRON_SECRET = SECRET;
const ID = '55555555-5555-4555-8555-555555555555';
const user = { id: ID, aud: 'authenticated', created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), app_metadata: { provider: 'email', providers: ['email'] } };
const row = { user_id: ID, role: 'free', trial_ends_at: '2026-12-01T00:00:00+00:00', updated_at: '2026-11-17T00:00:00+00:00', plan: null };
const writes: string[] = [], lines: string[] = [], queries: Record<string, string> = {};
let refuse = false, inserted: unknown = null;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch, real = { log: console.log, error: console.error };
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url), path = url.pathname.replace(/^\/(rest|auth)\/v1\//, '');
  if (url.origin !== 'http://supabase.invalid') throw new Error(`stray request ${req.url}`);
  if (req.method === 'DELETE') { writes.push(`delete ${path}`); queries[path] = decodeURIComponent(url.search); }
  if (path === 'admin/users') return json({ users: [user], aud: 'authenticated' });
  if (path === `admin/users/${ID}`) return req.method === 'DELETE' ? (refuse ? json({ code: 500, msg: 'refused' }, 500) : json({})) : json(user);
  if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '*/0' } });
  if (req.method === 'DELETE') return new Response(null, { status: 204, headers: { 'content-range': '*/0' } });
  if (req.method === 'POST') { writes.push(`insert ${path}`); inserted = await req.json(); return json([], 201); }
  if (path === 'lhq_user_subscriptions') return json([row]);
  if (path === 'lhq_trial_claims') return json([{ normalized_email: 'a@example.test' }]);
  return json([]);
}) as typeof fetch;
console.log = (...a: unknown[]) => { lines.push(a.join(' ')); }; console.error = (...a: unknown[]) => { lines.push(a.join(' ')); };
after(() => { globalThis.fetch = realFetch; Object.assign(console, real); delete process.env.UNCONFIRMED_PURGE_DRY_RUN; });

const { POST } = await import('../app/api/alert-fires/purge/route') as { POST: (r: Request) => Promise<Response> };
async function run(value: string | undefined) {
  if (value === undefined) delete process.env.UNCONFIRMED_PURGE_DRY_RUN; else process.env.UNCONFIRMED_PURGE_DRY_RUN = value;
  writes.length = 0; lines.length = 0; inserted = null;
  const r = await POST(new Request('http://localhost/api/alert-fires/purge', { method: 'POST', headers: { 'x-cron-secret': SECRET } }));
  return { status: r.status, keys: Object.keys(await r.json() as object).sort(), writes: [...writes], log: lines.filter((l) => l.startsWith('[unconfirmed-accounts]')) };
}
const accountWrites = (w: string[]) => w.filter((x) => !x.endsWith('alert_fires'));

test('D1. switch on: counted and logged, nothing deleted', async () => {
  for (const value of ['1', 'true', ' yes ', 'false', 'off']) {
    const r = await run(value);
    assert.deepEqual([r.status, r.keys], [200, ['cutoff', 'deleted', 'retainDays']], value);
    assert.deepEqual(accountWrites(r.writes), [], `${JSON.stringify(value)}: something was written`);
    assert.deepEqual(r.log, ['[unconfirmed-accounts] dry-run would_remove=1 kept=0 removed=0'], value);
    assert.equal(r.writes.filter((x) => x.endsWith('alert_fires')).length, 1, 'the history purge still runs');
  }
});

test('D2. unset, empty and 0: the real run', async () => {
  for (const value of [undefined, '', '0', ' 0 ']) {
    const r = await run(value);
    assert.equal(r.status, 200);
    assert.deepEqual(accountWrites(r.writes), ['delete lhq_user_subscriptions', `delete admin/users/${ID}`, 'delete lhq_trial_claims'], String(value));
    assert.deepEqual(r.log, ['[unconfirmed-accounts] removed=1 failed=0'], String(value));
  }
  assert.equal(queries.lhq_user_subscriptions, `?user_id=eq.${ID}&role=eq.free`);
  assert.equal(queries.lhq_trial_claims, '?normalized_email=in.(a@example.test)&first_user_id=is.null');
});

test('D3. the account delete refused: the row goes back, the claim stays', async () => {
  refuse = true;
  const r = await run(undefined);
  assert.deepEqual(accountWrites(r.writes), ['delete lhq_user_subscriptions', `delete admin/users/${ID}`, 'insert lhq_user_subscriptions']);
  assert.deepEqual(inserted, [row]);
  assert.deepEqual(r.log, ['[unconfirmed-accounts] removed=0 failed=1']);
});
