import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installFakeFetch, loadModule } from '../telegramWorld.mjs';

/* QA cells for PR #2572, PATCH /api/settings with daily_summary_hour (the /alerts hour picker's save): the REAL handler in-process, a fake network, nothing leaves the machine.
 *   P1 a whole hour 0-23 is accepted and written; null is accepted (back to the 07:00 default)
 *   P2 everything else is 400 'Invalid daily_summary_hour' and NOTHING is written: -1, 24, 7.5, "9", "", true, [], {}, 1e3, NaN-as-null-string, 23.0000001
 *   P3 signed out is 401, nothing written
 *   P4 the field is in the write payload exactly as sent (no coercion: 7.0 is 7), and an unrelated field in the same PATCH is unaffected */
const USERS: Record<string, string> = { 'tok-a': 'u-a' };
async function scenario() {
  const w = makeWorld({ tables: { lhq_user_settings: [{ user_id: 'u-a', telegram_chat_id: '1001', timezone: 'UTC' }] } }) as ReturnType<typeof makeWorld>;
  installFakeFetch(w);
  const inner = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const u = new URL(String(input?.url ?? input));
    if (u.host === 'stub.supabase.test' && u.pathname === '/auth/v1/user') {
      const tok = String(init?.headers?.Authorization ?? init?.headers?.authorization ?? new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      const id = USERS[tok];
      return id ? new Response(JSON.stringify({ id, email: `${id}@example.test`, aud: 'authenticated', role: 'authenticated' }), { status: 200, headers: { 'content-type': 'application/json' } })
                : new Response(JSON.stringify({ message: 'invalid JWT' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
    return inner(input, init);
  };
  const mod = await loadModule('app/api/settings/route.ts'); const { NextRequest } = await import('next/server.js');
  const patch = async (token: string | null, body: unknown) => {
    const res = await mod.PATCH(new NextRequest('http://localhost/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const stored = () => w.writes.filter((x: { table: string }) => x.table === 'lhq_user_settings');
  return { w, patch, stored };
}

test('P1. whole hours 0-23 and null are accepted and written', async () => {
  for (const h of [0, 1, 7, 12, 23, null]) {
    const { patch, stored } = await scenario(); const r = await patch('tok-a', { daily_summary_hour: h });
    assert.equal(r.status, 200, `hour ${h}: ${JSON.stringify(r.body)}`); assert.deepEqual(r.body.accepted, ['daily_summary_hour']);
    const body = stored()[0]?.body; const row = Array.isArray(body) ? body[0] : body; assert.equal(row?.daily_summary_hour, h, `hour ${h} was not written as sent`);
  }
});

test('P2. an invalid hour is 400 and nothing is stored', async () => {
  const bad: unknown[] = [-1, 24, 25, 7.5, 23.0000001, '9', '', 'null', true, false, [], {}, [7], 1e3, -0.5];
  for (const h of bad) {
    const { patch, stored } = await scenario(); const r = await patch('tok-a', { daily_summary_hour: h });
    assert.equal(r.status, 400, `hour ${JSON.stringify(h)} was accepted: ${JSON.stringify(r.body)}`); assert.equal(r.body.error, 'Invalid daily_summary_hour');
    assert.equal(stored().length, 0, `hour ${JSON.stringify(h)}: something was written`);
  }
});

test('P2b. a bad hour beside a good field refuses the whole request (nothing half-saved)', async () => {
  const { patch, stored } = await scenario(); const r = await patch('tok-a', { daily_summary_hour: 24, risk_pct: 2 });
  assert.equal(r.status, 400); assert.equal(stored().length, 0);
});

test('P3. signed out is 401 and nothing is written', async () => {
  const { patch, stored } = await scenario();
  for (const t of [null, 'tok-unknown']) { const r = await patch(t, { daily_summary_hour: 9 }); assert.equal(r.status, 401); }
  assert.equal(stored().length, 0);
});

test('P4. an unrelated field in the same PATCH is written beside the hour', async () => {
  const { patch, stored } = await scenario(); const r = await patch('tok-a', { daily_summary_hour: 9, risk_pct: 2 });
  assert.equal(r.status, 200); const body = stored()[0]?.body; const row = Array.isArray(body) ? body[0] : body; assert.equal(row.daily_summary_hour, 9); assert.equal(row.risk_pct, 2);
});
