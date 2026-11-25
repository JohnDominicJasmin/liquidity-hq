/* QA: PR #2811 (#1632 owner item 22), /api/health says whether the origin check setting is present: a yes or no, never the value. The REAL route runs; the database is a stand-in. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.SUPABASE_SERVICE_ROLE_KEY = 'qa_fixture_service_role_key_not_real'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'qa_fixture_anon_key_not_real';
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  if (new URL(req.url).origin !== SUPABASE) throw new Error(`stray request ${req.method} ${req.url}`);
  return new Response('[{"id":1}]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/1' } });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; delete process.env.ORIGIN_AUTH_SECRET; });

const routeP = import('../app/api/health/route.ts');
const call = async () => { const res = await (await routeP).GET(new NextRequest('http://localhost/api/health')); const text = await res.text(); return { text, body: JSON.parse(text) as { ok: boolean; originAuthConfigured?: unknown } }; };
const VALUE = 'qa-origin-value-7f3c9a';

test('unset and empty read false, set reads true, and the value is never in the answer', async () => {
  delete process.env.ORIGIN_AUTH_SECRET;
  assert.equal((await call()).body.originAuthConfigured, false, 'unset');
  process.env.ORIGIN_AUTH_SECRET = '';
  assert.equal((await call()).body.originAuthConfigured, false, 'empty');
  process.env.ORIGIN_AUTH_SECRET = VALUE;
  const set = await call();
  assert.equal(set.body.originAuthConfigured, true); assert.equal(set.body.ok, true);
  assert.ok(!set.text.includes(VALUE) && !set.text.includes(VALUE.slice(-6)), 'the value is in the public answer');
});
