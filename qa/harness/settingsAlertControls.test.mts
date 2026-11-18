import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installControlsWorld } from '../telegramControlsWorld.mjs';
import { loadModule } from '../telegramWorld.mjs';

/* QA's cells for #2567 (the settings route that stores quiet hours, snooze and pause), the REAL PATCH /api/settings in-process with a fake network and database.
 *   V1  valid values are accepted and stored: a quiet PAIR of hours 0-23 (whole), an ISO snooze with Z or an offset (up to 7 days ahead), paused true/false, and null for each
 *   V2  invalid hours (24, -1, 7.5, "7", "22:00", true, [], {}), invalid snooze (words, a number, a bare date, no zone) and invalid paused ("true", 1) are 400 and NOTHING is written
 *   V2b an impossible calendar time (30 February, 31 April, 29 February in a non-leap year, hour 24 or 25, minute or second 60, an offset beyond +14:00 or with minutes over 59) is 400, nothing written
 *   V3  the server fields cannot be written from the browser: telegram_lapse_notified_at and telegram_chat_id in the body are dropped by the allowlist
 *   V4  no session is 401 and writes nothing
 *   V5  the snooze cap is 7 days, on a frozen clock: exactly 7 days is accepted, 7 days + 1 ms and + 1 s are 400, a year-9999 snooze is 400; a snooze in the past is accepted (it means "not snoozed")
 *   V6  quiet hours are a PAIR: one bound alone (either one), or one null and one set, is 400 and writes nothing; both set, both null and start == end are accepted
 * WHAT IT CANNOT PROVE: the database grants (a column the browser role may not write), the client's save toast. */
type Row = Record<string, unknown>;
const realNow = Date.now.bind(Date);
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
  /** `frozenAt`: the clock the route sees during this one request (a snooze cap is a boundary: it is measured against a fixed instant) */
  const patch = async (body: unknown, token: string | null = 'tok-a', frozenAt?: number) => {
    if (frozenAt !== undefined) Date.now = () => frozenAt;
    try { const res = await mod.PATCH(new NextRequest('http://localhost/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })); return { status: res.status, body: await res.json().catch(() => null) as Row | null }; }
    finally { Date.now = realNow; }
  };
  const writes = () => (w.writes as Array<{ method: string; table: string; body: Row }>).filter((x) => x.table === 'lhq_user_settings' && x.method !== 'GET').length;
  return { w, patch, writes, row: () => (w.tables.lhq_user_settings as Row[])[0] };
}
const DAY = 86_400_000;

test('V1. valid values are accepted and stored', async () => {
  const { patch, row } = await scenario(); const now = realNow(); const iso = (d: number) => new Date(now + d).toISOString();
  for (const body of [{ alert_quiet_start: 22, alert_quiet_end: 7 }, { alert_quiet_start: 0, alert_quiet_end: 23 }, { alert_quiet_start: 5, alert_quiet_end: 5 }, { alert_snooze_until: iso(DAY) }, { alert_snooze_until: iso(3 * DAY).replace(/\.\d+Z$/, '+00:00') }, { alert_snooze_until: iso(2 * DAY).slice(0, 16) + 'Z' }, { alert_paused: true }, { alert_paused: false },
    { alert_quiet_start: null, alert_quiet_end: null, alert_snooze_until: null, alert_paused: null }]) { row().field_updated_at = {}; const r = await patch(body); assert.equal(r.status, 200, `${JSON.stringify(body)} -> ${r.status} ${JSON.stringify(r.body)}`); for (const [k, v] of Object.entries(body)) assert.deepEqual(row()[k], v, `${k} not stored`); }
  row().field_updated_at = {}; const off = await patch({ alert_snooze_until: new Date(now + DAY).toISOString().replace(/\.\d+Z$/, '+08:00') }); assert.equal(off.status, 200, 'an offset form');
});
test('V2. invalid hours, snooze and paused are 400 and nothing is written', async () => {
  const { patch, writes } = await scenario(); const bad: Array<Row> = [];
  for (const v of [24, -1, 7.5, '7', '22:00', true, [], {}, 1e9, 23.0001]) { bad.push({ alert_quiet_start: v, alert_quiet_end: 7 }); bad.push({ alert_quiet_start: 22, alert_quiet_end: v }); }
  for (const v of ['tomorrow', 12345, '2026-11-19', '2026-11-19T10:00', '2026-13-01T00:00:00Z', '', ' 2026-11-19T10:00:00Z', 'now', true, [], {}, '2026-11-19T10:00:00Zjunk']) bad.push({ alert_snooze_until: v });
  for (const v of ['true', 1, 0, 'yes', [], {}]) bad.push({ alert_paused: v });
  bad.push({ alert_quiet_start: 22, alert_quiet_end: 99 }, { alert_paused: true, alert_snooze_until: 'nope' });
  for (const b of bad) { const r = await patch(b); assert.equal(r.status, 400, `${JSON.stringify(b)} -> ${r.status}`); assert.match(String(r.body?.error), /Invalid alert_/); }
  assert.equal(writes(), 0, 'a refused request was stored');
});
test('V2b. an impossible calendar time is 400 and nothing is written (30 Feb, 31 Apr, 29 Feb in a non-leap year, hour 24/25, minute 60, second 60, offsets beyond +14:00 or over 59 minutes)', async () => {
  const { patch, writes } = await scenario();
  for (const v of ['2026-02-30T10:00:00Z', '2026-02-29T10:00:00Z', '2026-04-31T10:00:00Z', '2026-11-19T24:00:00Z', '2026-11-19T25:00:00Z', '2026-11-19T10:60:00Z', '2026-11-19T10:00:60Z', '2026-11-19T10:00:00+15:00', '2026-11-19T10:00:00+05:60', '2026-00-10T10:00:00Z', '2026-11-00T10:00:00Z', '2026-11-32T10:00:00Z']) {
    const r = await patch({ alert_snooze_until: v }); assert.equal(r.status, 400, `${v} answered ${r.status}`);
  }
  assert.equal(writes(), 0, 'a refused request was stored');
  const ok = await patch({ alert_snooze_until: new Date(realNow() + DAY).toISOString() }); assert.equal(ok.status, 200, 'CONTROL: a real time is accepted'); assert.equal(writes(), 1);
});
test('V3. telegram_lapse_notified_at and telegram_chat_id in the body are dropped by the allowlist', async () => {
  const { patch, row } = await scenario(); const r = await patch({ alert_paused: true, telegram_lapse_notified_at: '2020-01-01T00:00:00Z', telegram_chat_id: '666' }); assert.equal(r.status, 200);
  assert.equal(row().telegram_lapse_notified_at, undefined, 'the server-only mark was writable from the browser'); assert.equal(row().telegram_chat_id, '1001'); assert.equal(row().alert_paused, true);
});
test('V4. no session is 401 and writes nothing', async () => {
  const { patch, writes } = await scenario(); assert.equal((await patch({ alert_paused: true }, null)).status, 401); assert.equal((await patch({ alert_paused: true }, 'tok-bad')).status, 401); assert.equal(writes(), 0);
});
test('V5. the snooze cap is 7 days (frozen clock): exactly 7 days accepted; +1 ms, +1 s, +30 days, year 9999 refused; a snooze in the past accepted; nothing is written for a refusal', async () => {
  const { patch, row, writes } = await scenario(); const T = Date.parse('2026-11-18T12:00:00.000Z'); const at = (d: number) => new Date(T + d).toISOString(); const week = 7 * DAY;
  const exact = await patch({ alert_snooze_until: at(week) }, 'tok-a', T); assert.equal(exact.status, 200, `exactly 7 days -> ${exact.status} ${JSON.stringify(exact.body)}`); assert.equal(row().alert_snooze_until, at(week)); const before = writes();
  for (const [name, v] of [['+1 ms', at(week + 1)], ['+1 s', at(week + 1000)], ['+8 days', at(8 * DAY)], ['+30 days', at(30 * DAY)], ['year 9999', '9999-12-31T23:59:59Z']] as const) { row().field_updated_at = {}; const r = await patch({ alert_snooze_until: v }, 'tok-a', T); assert.equal(r.status, 400, `${name} (${v}) answered ${r.status}`); assert.match(String(r.body?.error), /Invalid alert_snooze_until/); }
  assert.equal(writes(), before, 'a refused snooze was stored'); assert.equal(row().alert_snooze_until, at(week), 'the stored snooze changed');
  row().field_updated_at = {}; const justUnder = await patch({ alert_snooze_until: at(week - 1) }, 'tok-a', T); assert.equal(justUnder.status, 200, '7 days - 1 ms');
  row().field_updated_at = {}; const past = await patch({ alert_snooze_until: '2020-01-01T00:00:00Z' }, 'tok-a', T); assert.equal(past.status, 200, 'a past time means not snoozed and is accepted');
  row().field_updated_at = {}; const offset = await patch({ alert_snooze_until: new Date(T + week).toISOString().replace(/\.\d+Z$/, '.000Z') .replace('12:00:00.000Z', '20:00:00.000+08:00') }, 'tok-a', T); assert.equal(offset.status, 200, 'the same instant written with an offset (20:00+08:00 = 12:00Z)');
  row().field_updated_at = {}; const offsetOver = await patch({ alert_snooze_until: new Date(T + week + 1000).toISOString().replace('12:00:01.000Z', '20:00:01.000+08:00') }, 'tok-a', T); assert.equal(offsetOver.status, 400, 'one second over, written with an offset');
});
test('V6. quiet hours are a PAIR: one bound alone, or one null and one set, is 400 and writes nothing; both set, both null and start == end are accepted', async () => {
  const { patch, row, writes } = await scenario();
  for (const b of [{ alert_quiet_start: 22 }, { alert_quiet_end: 7 }, { alert_quiet_start: null }, { alert_quiet_end: null }, { alert_quiet_start: 22, alert_quiet_end: null }, { alert_quiet_start: null, alert_quiet_end: 7 }]) {
    const r = await patch(b); assert.equal(r.status, 400, `${JSON.stringify(b)} -> ${r.status}`); assert.match(String(r.body?.error), /alert_quiet_start\/alert_quiet_end/);
  }
  assert.equal(writes(), 0, 'a half pair was stored');
  for (const b of [{ alert_quiet_start: 22, alert_quiet_end: 7 }, { alert_quiet_start: null, alert_quiet_end: null }, { alert_quiet_start: 9, alert_quiet_end: 9 }]) { row().field_updated_at = {}; const r = await patch(b); assert.equal(r.status, 200, `${JSON.stringify(b)} -> ${r.status}`); assert.equal(row().alert_quiet_start, b.alert_quiet_start); assert.equal(row().alert_quiet_end, b.alert_quiet_end); }
  row().field_updated_at = {}; const mixed = await patch({ alert_paused: true, alert_quiet_start: 3 }); assert.equal(mixed.status, 400, 'a half pair next to a valid field'); assert.notEqual(row().alert_paused, true, 'the valid field was stored beside a refused half pair');
});
