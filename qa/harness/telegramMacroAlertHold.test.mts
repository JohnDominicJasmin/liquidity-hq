import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installControlsWorld } from '../telegramControlsWorld.mjs';
import { loadModule } from '../telegramWorld.mjs';

/* QA's cell for #2567: the OTHER Telegram sender. app/api/macro-alert/route.ts ("Macro Event in ~60 min") reads its own recipient list and sends to every entitled chat. The bot says /pause pauses "all alerts" and /status says
 * "Alerts: paused", and quiet hours / snooze are set on /alerts. A person who is paused, snoozed or in quiet hours must not get a macro-event message either.
 *   M1  CONTROL: a normal user gets the macro event message (the fake calendar serves one event 60 minutes away)
 *   M2  paused: no macro message          M3  snoozed (future): none          M4  quiet hours right now (their own timezone): none
 * WHAT IT CANNOT PROVE: the real economic calendar feed. */
type Row = Record<string, unknown>;
const PRO = { role: 'pro', trial_ends_at: null, current_period_end: '2027-03-01T00:00:00.000Z' };
async function run(settings: Row) {
  const w = makeWorld({ tables: {
    lhq_user_subscriptions: [{ user_id: 'u-a', ...PRO }, { user_id: 'u-b', ...PRO }],
    lhq_user_settings: [{ user_id: 'u-a', telegram_chat_id: '1001', timezone: 'UTC', ...settings }, { user_id: 'u-b', telegram_chat_id: '2002', timezone: 'UTC' }],
    lhq_app_config: [],
  } }) as ReturnType<typeof makeWorld>;
  installControlsWorld(w); const inner = globalThis.fetch;
  process.env.NEXT_PUBLIC_APP_URL = 'http://app.test';
  globalThis.fetch = async (input: any, init?: any) => {
    const u = new URL(String(input?.url ?? input));
    if (u.host === 'app.test' && u.pathname === '/api/econ-calendar') return new Response(JSON.stringify({ events: [{ name: 'US CPI', type: 'CPI', isoDate: new Date(Date.now() + 60 * 60_000).toISOString(), impact: 'high' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return inner(input, init);
  };
  const mod = await loadModule('app/api/macro-alert/route.ts'); const { NextRequest } = await import('next/server.js');
  const res = await mod.GET(new NextRequest('http://localhost/api/macro-alert', { headers: { 'x-cron-secret': 'harness-fake-secret' } }));
  const got = (c: string) => w.telegram.sent.filter((m: { chat_id: string; text: string }) => m.chat_id === c && /Macro Event/.test(m.text)).length;
  return { status: res.status, a: got('1001'), b: got('2002') };
}
const quietNow = () => { const h = new Date().getUTCHours(); return { alert_quiet_start: h, alert_quiet_end: (h + 2) % 24 }; };
test('M1. CONTROL: with no hold both users get the macro event message', async () => { const r = await run({}); assert.deepEqual([r.a, r.b], [1, 1], JSON.stringify(r)); });
test('M2. paused: the paused user gets no macro event message, the other still does', async () => { const r = await run({ alert_paused: true }); assert.deepEqual([r.a, r.b], [0, 1], `a=${r.a} b=${r.b}`); });
test('M3. snoozed: no macro event message', async () => { const r = await run({ alert_snooze_until: new Date(Date.now() + 3_600_000).toISOString() }); assert.deepEqual([r.a, r.b], [0, 1], `a=${r.a} b=${r.b}`); });
test('M4. inside quiet hours now (UTC window containing this hour): no macro event message', async () => { const r = await run(quietNow()); assert.deepEqual([r.a, r.b], [0, 1], `a=${r.a} b=${r.b}`); });
