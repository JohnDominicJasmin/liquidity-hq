/* QA: PR #2850: the dry-run switch of the unconfirmed-account clean-up. The real route, lib and Supabase client run; the database and auth service are stand-ins.
 *   D1 switch on ("1", "true", " yes ", anything but unset / empty / "0"): no account and no trial claim is deleted; the log says what would go; the route's answer is as before
 *   D2 unset, empty and "0": the real run, claim first, then the account */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
const SECRET = 'qa-cron-secret-0123456789'; process.env.CRON_SECRET = SECRET;
const ID = '55555555-5555-4555-8555-555555555555';
const user = { id: ID, aud: 'authenticated', created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), app_metadata: { provider: 'email', providers: ['email'] } };
const writes: string[] = [], lines: string[] = [];
const json = (b: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
const realFetch = globalThis.fetch, real = { log: console.log, error: console.error };
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.origin !== 'http://supabase.invalid') throw new Error(`stray request ${req.url}`);
  if (req.method === 'DELETE') writes.push(url.pathname.replace(/^\/(rest|auth)\/v1\//, ''));
  if (url.pathname === '/auth/v1/admin/users') return json({ users: [user], aud: 'authenticated' });
  if (url.pathname === `/auth/v1/admin/users/${ID}`) return json(req.method === 'DELETE' ? {} : user);
  if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '*/0' } });
  if (req.method === 'DELETE') return new Response(null, { status: 204, headers: { 'content-range': '*/0' } });
  return json([]);
}) as typeof fetch;
console.log = (...a: unknown[]) => { lines.push(a.join(' ')); }; console.error = (...a: unknown[]) => { lines.push(a.join(' ')); };
after(() => { globalThis.fetch = realFetch; Object.assign(console, real); delete process.env.UNCONFIRMED_PURGE_DRY_RUN; });

const { POST } = await import('../app/api/alert-fires/purge/route') as { POST: (r: Request) => Promise<Response> };
async function run(value: string | undefined) {
  if (value === undefined) delete process.env.UNCONFIRMED_PURGE_DRY_RUN; else process.env.UNCONFIRMED_PURGE_DRY_RUN = value;
  writes.length = 0; lines.length = 0;
  const r = await POST(new Request('http://localhost/api/alert-fires/purge', { method: 'POST', headers: { 'x-cron-secret': SECRET } }));
  return { status: r.status, keys: Object.keys(await r.json() as object).sort(), deletes: [...writes], log: lines.filter((l) => l.startsWith('[unconfirmed-accounts]')) };
}
const accountWrites = (w: string[]) => w.filter((x) => !x.endsWith('alert_fires'));

test('D1. switch on: counted and logged, nothing deleted', async () => {
  for (const value of ['1', 'true', ' yes ', 'false', 'off']) {
    const r = await run(value);
    assert.deepEqual([r.status, r.keys], [200, ['cutoff', 'deleted', 'retainDays']], value);
    assert.deepEqual(accountWrites(r.deletes), [], `${JSON.stringify(value)}: something was deleted`);
    assert.deepEqual(r.log, ['[unconfirmed-accounts] dry-run would_remove=1 kept=0 removed=0'], value);
    assert.equal(r.deletes.filter((x) => x.endsWith('alert_fires')).length, 1, 'the history purge still runs');
  }
});

test('D2. unset, empty and 0: the real run', async () => {
  for (const value of [undefined, '', '0', ' 0 ']) {
    const r = await run(value);
    assert.equal(r.status, 200);
    assert.deepEqual(accountWrites(r.deletes), ['lhq_trial_claims', `admin/users/${ID}`], String(value));
    assert.deepEqual(r.log, ['[unconfirmed-accounts] removed=1 failed=0'], String(value));
  }
});
