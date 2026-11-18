import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { randomBytes, createECDH } from 'node:crypto';
import { makeWorld, installControlsWorld } from '../telegramControlsWorld.mjs';
import { loadModule, loadRoute } from '../telegramWorld.mjs';

/* QA's cells for #2567: the OTHER two senders. A person who is paused, snoozed or in quiet hours must get nothing from them either: the bot says "/pause - pause all alerts".
 *   M1  CONTROL: with no hold both users get the macro-event message (the fake calendar serves one event 60 minutes away)
 *   M2  paused: no macro-event Telegram message          M3  snoozed (future): none          M4  quiet hours right now (their own timezone): none
 *   M5  WEB PUSH of the alert cron (app/api/telegram/alert/route.ts dispatchPush), behaviourally: web-push's own https.request is replaced by a recorder, nothing leaves the machine. One run with four push subscribers (no hold, paused, snoozed, in quiet hours):
 *       only the one with no hold is pushed; and the held users still own a subscription (it is not removed)
 * WHAT IT CANNOT PROVE: the real economic calendar feed, the push services, the browser's notification. */
type Row = Record<string, unknown>;
const PRO = { role: 'pro', trial_ends_at: null, current_period_end: '2027-03-01T00:00:00.000Z' };
async function run(settings: Row) {
  const w = makeWorld({ tables: {
    lhq_user_subscriptions: [{ user_id: 'u-a', ...PRO }, { user_id: 'u-b', ...PRO }],
    lhq_user_settings: [{ user_id: 'u-a', telegram_chat_id: '1001', ...{ timezone: 'UTC' }, ...settings }, { user_id: 'u-b', telegram_chat_id: '2002', timezone: 'UTC' }],
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
const quietNow = () => { const h = new Date().getUTCHours(); return { alert_quiet_start: h, alert_quiet_end: (h + 3) % 24 }; };
test('M1. CONTROL: with no hold both users get the macro event message', async () => { const r = await run({}); assert.deepEqual([r.a, r.b], [1, 1], JSON.stringify(r)); });
test('M2. paused: the paused user gets no macro event message, the other still does', async () => { const r = await run({ alert_paused: true }); assert.deepEqual([r.a, r.b], [0, 1], `a=${r.a} b=${r.b}`); });
test('M3. snoozed: no macro event message', async () => { const r = await run({ alert_snooze_until: new Date(Date.now() + 3_600_000).toISOString() }); assert.deepEqual([r.a, r.b], [0, 1], `a=${r.a} b=${r.b}`); });
test('M4. inside quiet hours now (UTC window containing this hour): no macro event message', async () => { const r = await run(quietNow()); assert.deepEqual([r.a, r.b], [0, 1], `a=${r.a} b=${r.b}`); });

/** A push subscription web-push accepts: a real P-256 public key and a 16-byte secret, on a known push host (lib/pushEndpoint.ts). */
const b64u = (b: Buffer) => b.toString('base64url');
const sub = (user: string) => { const ecdh = createECDH('prime256v1'); ecdh.generateKeys(); return { user_id: user, endpoint: `https://fcm.googleapis.com/fcm/send/${user}`, p256dh: b64u(ecdh.getPublicKey()), auth: b64u(randomBytes(16)) }; };
test('M5. Web Push honours pause, snooze and quiet hours: of four subscribers only the one with no hold is pushed', async () => {
  const vapid = createRequire(import.meta.url)('web-push').generateVAPIDKeys() as { publicKey: string; privateKey: string };
  const env = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY, VAPID_EMAIL: process.env.VAPID_EMAIL };
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vapid.publicKey; process.env.VAPID_PRIVATE_KEY = vapid.privateKey; process.env.VAPID_EMAIL = 'mailto:qa@example.test';
  const pushed: string[] = []; const realRequest = https.request;
  (https as unknown as { request: unknown }).request = ((opts: { hostname?: string; path?: string }, cb: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { write: () => void; end: () => void; destroy: () => void };
    req.write = () => {}; req.destroy = () => {};
    req.end = () => { pushed.push(`https://${opts.hostname}${opts.path}`); const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: object; setEncoding: () => void }; res.statusCode = 201; res.headers = {}; res.setEncoding = () => {}; setImmediate(() => { cb(res); res.emit('end'); }); };
    return req;
  }) as never;
  try {
    const users = [{ id: 'u-ctl', chat: '9000', hold: {} }, { id: 'u-paused', chat: '9001', hold: { alert_paused: true } }, { id: 'u-snoozed', chat: '9002', hold: { alert_snooze_until: new Date(Date.now() + 3_600_000).toISOString() } }, { id: 'u-quiet', chat: '9003', hold: quietNow() }];
    const w = makeWorld({ tables: {
      lhq_price_alerts: [], lhq_muted_alerts: [], lhq_user_subscriptions: users.map((u) => ({ user_id: u.id, ...PRO })),
      lhq_user_settings: users.map((u) => ({ user_id: u.id, telegram_chat_id: u.chat, ...{ timezone: 'UTC' }, ...u.hold })), lhq_push_subscriptions: users.map((u) => sub(u.id)),
    } }) as ReturnType<typeof makeWorld>;
    (w as unknown as { series: Record<string, number[]> }).series = { 'BTCUSDT:60': Array.from({ length: 300 }, (_, i) => 100 + i) }; installControlsWorld(w); const route = await loadRoute();
    const r = await route.run(); assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200)); assert.ok(!(r.body as { note?: string })?.note, 'the cron hit its own 28 s limit (a loaded machine)');
    await new Promise((res) => setTimeout(res, 1500));                                     // the push is not awaited by the run
    assert.ok(w.telegram.sent.some((m: { chat_id: string }) => m.chat_id === '9000'), 'CONTROL: the user with no hold got the Telegram alert');
    assert.deepEqual(pushed.sort(), ['https://fcm.googleapis.com/fcm/send/u-ctl'], `pushed to: ${pushed.join(', ') || '(nobody)'}`);
    assert.equal((w.tables.lhq_push_subscriptions as unknown[]).length, 4, 'a held user\'s subscription was removed');
  } finally { (https as unknown as { request: unknown }).request = realRequest; for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});
