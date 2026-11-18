import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installControlsWorld } from '../telegramControlsWorld.mjs';
import { loadModule } from '../telegramWorld.mjs';

/* QA's cells for #2567 (the settings route that stores quiet hours, snooze and pause), the REAL PATCH /api/settings in-process with a fake network and database.
 *   V1  valid values are accepted and stored: hours 0-23 (whole), an ISO snooze with Z or an offset, paused true/false, and null for each
 *   V2  invalid hours (24, -1, 7.5, "7", "22:00", true, [], {}), invalid snooze (words, a number, a bare date, no zone, an impossible date) and invalid paused ("true", 1) are 400 and NOTHING is written
 *   V3  the server fields cannot be written from the browser: telegram_lapse_notified_at and telegram_chat_id in the body are dropped by the allowlist
 *   V4  no session is 401 and writes nothing
 *   V5  KNOWN GAP (pinned, not a defect of the rule as written): there is no upper cap on how far ahead a snooze may be
 * WHAT IT CANNOT PROVE: the database grants (a column the browser role may not write), the client's save toast. */
type Row = Record<string, unknown>;
async function scenario() {
  const w = makeWorld({ tables: { lhq_user_settings: [{ user_id: 'u-a', telegram_chat_id: '1001', timezone: 'UTC', field_updated_at: {} }], lhq_user_subscriptions: [] } }) as ReturnType<typeof makeWorld>;
  installControlsWorld(w); const inner = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const u = new URL(String(input?.url ?? input));
    if (u.host === 'stub.supabase.test' && u.pathname === '/auth/v1/user') {
      const tok = String(new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      return tok === 'tok-a' ? new Response(JSON.stringify({ id: 'u-a', email: 'a@example.test', aud: 'authenticated', role: 'authenticated' }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ message: 'invalid JWT' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
    if (u.host === 'stub.supabase.test' && u.pathname === '/rest/v1/lhq_user_settings' && (init?.method ?? 'GET') === 'POST') {   // the upsert: merge into the one row
      const b = JSON.parse(init.body); w.writes.push({ method: 'POST', table: 'lhq_user_settings', query: u.search, body: b });
      Object.assign((w.tables.lhq_user_settings as Row[]).find((r) => r.user_id === b.user_id)!, b); return new Response(null, { status: 201 });
    }
    return inner(input, init);
  };
  const mod = await loadModule('app/api/settings/route.ts'); const { NextRequest } = await import('next/server.js');
  const patch = async (body: unknown, token: string | null = 'tok-a') => { const res = await mod.PATCH(new NextRequest('http://localhost/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })); return { status: res.status, body: await res.json().catch(() => null) as Row | null }; };
  const writes = () => (w.writes as Array<{ method: string; table: string; body: Row }>).filter((x) => x.table === 'lhq_user_settings' && x.method !== 'GET').length;
  return { w, patch, writes, row: () => (w.tables.lhq_user_settings as Row[])[0] };
}

test('V1. valid values are accepted and stored', async () => {
  const { patch, row } = await scenario();
  for (const body of [{ alert_quiet_start: 22, alert_quiet_end: 7 }, { alert_quiet_start: 0, alert_quiet_end: 23 }, { alert_snooze_until: '2026-11-19T08:00:00.000Z' }, { alert_snooze_until: '2026-11-19T08:00:00+08:00' }, { alert_snooze_until: '2026-11-19T08:00Z' }, { alert_paused: true }, { alert_paused: false },
    { alert_quiet_start: null, alert_quiet_end: null, alert_snooze_until: null, alert_paused: null }]) { row().field_updated_at = {}; const r = await patch(body); assert.equal(r.status, 200, `${JSON.stringify(body)} -> ${r.status} ${JSON.stringify(r.body)}`); for (const [k, v] of Object.entries(body)) assert.deepEqual(row()[k], v, `${k} not stored`); }
});
test('V2. invalid hours, snooze and paused are 400 and nothing is written', async () => {
  const { patch, writes } = await scenario(); const bad: Array<Row> = [];
  for (const v of [24, -1, 7.5, '7', '22:00', true, [], {}, 1e9, 23.0001]) { bad.push({ alert_quiet_start: v }); bad.push({ alert_quiet_end: v }); }
  for (const v of ['tomorrow', 12345, '2026-11-19', '2026-11-19T10:00', '2026-13-01T00:00:00Z', '', ' 2026-11-19T10:00:00Z', 'now', true, [], {}, '2026-11-19T10:00:00Zjunk']) bad.push({ alert_snooze_until: v });
  for (const v of ['true', 1, 0, 'yes', [], {}]) bad.push({ alert_paused: v });
  bad.push({ alert_quiet_start: 22, alert_quiet_end: 99 }, { alert_paused: true, alert_snooze_until: 'nope' });
  for (const b of bad) { const r = await patch(b); assert.equal(r.status, 400, `${JSON.stringify(b)} -> ${r.status}`); assert.match(String(r.body?.error), /Invalid alert_/); }
  assert.equal(writes(), 0, 'a refused request was stored');
});
test('V3. telegram_lapse_notified_at and telegram_chat_id in the body are dropped by the allowlist', async () => {
  const { patch, row } = await scenario(); const r = await patch({ alert_paused: true, telegram_lapse_notified_at: '2020-01-01T00:00:00Z', telegram_chat_id: '666' }); assert.equal(r.status, 200);
  assert.equal(row().telegram_lapse_notified_at, undefined, 'the server-only mark was writable from the browser'); assert.equal(row().telegram_chat_id, '1001'); assert.equal(row().alert_paused, true);
});
test('V4. no session is 401 and writes nothing', async () => {
  const { patch, writes } = await scenario(); assert.equal((await patch({ alert_paused: true }, null)).status, 401); assert.equal((await patch({ alert_paused: true }, 'tok-bad')).status, 401); assert.equal(writes(), 0);
});
test('V5. KNOWN GAP: a snooze of any length is accepted (year 9999), so the longest wait is the person\'s own choice and only Resume or /resume ends it', async () => {
  const { patch, row } = await scenario(); const r = await patch({ alert_snooze_until: '9999-12-31T23:59:59Z' }); assert.equal(r.status, 200); assert.equal(row().alert_snooze_until, '9999-12-31T23:59:59Z');
});
test('V2b. FINDING: an impossible calendar date (2026-02-30) passes the route check (Date.parse rolls it to 2 March) and would reach the timestamptz column, which refuses it: a 500 and retries, not a 400', async () => {
  const { patch, writes } = await scenario(); const r = await patch({ alert_snooze_until: '2026-02-30T10:00:00Z' });
  assert.equal(r.status, 400, `answered ${r.status} and wrote ${writes()} time(s)`);
});
