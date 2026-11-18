import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installFakeFetch, loadModule } from '../telegramWorld.mjs';

/* QA cells for PR #2572, POST /api/telegram/test-alert ("Send test alert" on /alerts): the REAL handler in-process against the fake network of qa/telegramWorld.mjs. Nothing leaves the machine.
 * Order the route runs (read from the file): 401 -> 429 (in-memory limit, 3 per 10 min per user, counted BEFORE the Pro check) -> 403 PRO_REQUIRED -> 503 no bot -> 409 no linked chat -> send (502 on a Telegram refusal).
 *   A1 signed out is 401, nothing sent        A2 Free is 403 PRO_REQUIRED, a trial counts as Pro        A3 Pro with a linked chat: ONE message to ITS OWN chat, text says it is a test, no NaN
 *   A4 the caller cannot pick the chat (body, query, header) and a huge body or extra keys are ignored  A5 no linked chat (null, blank): 409, nothing sent, NO fallback to the global TELEGRAM_CHAT_ID
 *   A6 the limit: 4th call in 10 min is 429, another user unaffected, the window reopens after 10 min, a 429 sends nothing    A7 which refusals are COUNTED against the 3 (documented, not judged)
 *   A8 Telegram refusing / not answering is 502 and sent:false  A9 no bot token is 503 but a Free user still gets 403 first  A10 only POST exists  A11 bad stored timezone is not a crash */
const PRO_ROW = { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() };
const TRIAL_ROW = { role: 'free', trial_ends_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), current_period_end: null };
const USERS: Record<string, string> = { 'tok-pro': 'u-pro', 'tok-free': 'u-free', 'tok-trial': 'u-trial', 'tok-nolink': 'u-nolink', 'tok-pro2': 'u-pro2', 'tok-blank': 'u-blank', 'tok-badtz': 'u-badtz' };

async function scenario(o: { chat?: Record<string, string | null>; tz?: Record<string, string | null> } = {}) {
  (globalThis as { __lhqRateLimit?: { buckets: Map<string, unknown>; overflow: Map<string, unknown> } }).__lhqRateLimit?.buckets.clear();
  const chat = o.chat ?? { 'u-pro': '1001', 'u-pro2': '1002', 'u-free': '2002', 'u-trial': '3003', 'u-nolink': null, 'u-blank': '   ', 'u-badtz': '4004' };
  const w = makeWorld({ tables: {
    lhq_user_subscriptions: [{ user_id: 'u-pro', ...PRO_ROW }, { user_id: 'u-pro2', ...PRO_ROW }, { user_id: 'u-nolink', ...PRO_ROW }, { user_id: 'u-blank', ...PRO_ROW }, { user_id: 'u-badtz', ...PRO_ROW }, { user_id: 'u-free', role: 'free', trial_ends_at: null, current_period_end: null }, { user_id: 'u-trial', ...TRIAL_ROW }],
    lhq_user_settings: Object.entries(chat).map(([user_id, telegram_chat_id]) => ({ user_id, telegram_chat_id, timezone: o.tz?.[user_id] ?? 'UTC' })),
  } }) as ReturnType<typeof makeWorld>;
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
  const mod = await loadModule('app/api/telegram/test-alert/route.ts');
  const { NextRequest } = await import('next/server.js');
  const post = async (token: string | null, body: unknown = undefined, extra: Record<string, string> = {}, url = 'http://localhost/api/telegram/test-alert') => {
    const raw = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const res = await mod.POST(new NextRequest(url, { method: 'POST', headers: { ...(raw !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: raw }));
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { w, post, mod };
}
const chats = (w: ReturnType<typeof makeWorld>) => w.telegram.sent.map((m: { chat_id: string }) => m.chat_id);

test('A1. signed out (no header, an empty bearer, an unknown token) is 401 and sends nothing', async () => {
  const { w, post } = await scenario();
  for (const t of [null, '', 'tok-unknown']) { const r = await post(t); assert.equal(r.status, 401, `token ${JSON.stringify(t)}`); assert.equal(r.body.sent, false); }
  assert.equal(w.telegram.attempts.length, 0);
});

test('A2. a Free account is 403 PRO_REQUIRED and sends nothing; a trial account counts as Pro (same rule as telegram/test)', async () => {
  const { w, post } = await scenario();
  const f = await post('tok-free'); assert.equal(f.status, 403); assert.equal(f.body.error, 'PRO_REQUIRED'); assert.equal(f.body.sent, false); assert.equal(w.telegram.attempts.length, 0);
  const t = await post('tok-trial'); assert.equal(t.status, 200); assert.deepEqual(chats(w), ['3003']);
});

test('A3. a Pro account with a linked chat: 200 { ok, sent }, exactly ONE message, to its own chat, saying it is a test; no NaN/undefined/null', async () => {
  const { w, post } = await scenario();
  const r = await post('tok-pro'); assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, sent: true });
  assert.deepEqual(chats(w), ['1001']); const t = w.telegram.sent[0].text as string;
  assert.match(t, /Test alert/); assert.match(t, /this is a test/i); for (const bad of [/NaN/, /undefined/, /null/, /Infinity/]) assert.doesNotMatch(t, bad, t);
  assert.match(t, /UTC/, 'the stamp names the zone'); assert.ok(t.length < 400);
  await post('tok-pro2'); assert.deepEqual(chats(w), ['1001', '1002'], 'each user reaches only their own chat');
});

test('A4. the caller cannot pick the chat (body, query string, header); a 6 MB body and extra keys are ignored and the send still goes to the caller\'s own chat', async () => {
  const { w, post } = await scenario();
  await post('tok-pro', { chat_id: '2002', chatId: '2002', message: 'hi', text: 'attack' }); await post('tok-pro', undefined, { 'x-chat-id': '2002' }, 'http://localhost/api/telegram/test-alert?chat_id=2002&chatId=2002');
  const big = await post('tok-pro2', 'x'.repeat(6_000_000));
  assert.deepEqual(chats(w), ['1001', '1001', '1002']); assert.equal(big.status, 200, 'a huge body is not read, so it cannot hurt');
  assert.ok(w.telegram.sent.every((m: { text: string }) => !/attack/.test(m.text)), 'a body field reached the message text');
});

test('A5. no linked chat (null, blank, spaces) is 409 and nothing is sent; there is NO fallback to the global TELEGRAM_CHAT_ID', async () => {
  const { w, post } = await scenario(); process.env.TELEGRAM_CHAT_ID = '9999';
  try {
    const a = await post('tok-nolink'); const b = await post('tok-blank');
    assert.equal(a.status, 409); assert.equal(b.status, 409); assert.equal(a.body.sent, false); assert.match(String(a.body.error), /not connected/i);
    assert.equal(w.telegram.attempts.length, 0, 'something was sent');
  } finally { delete process.env.TELEGRAM_CHAT_ID; }
});

test('A6. the limit: 3 per 10 minutes per user; the 4th is 429 and sends nothing; another user is unaffected; 10 minutes later the user is allowed again', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-18T10:00:00Z') });
  try {
    const { w, post } = await scenario();
    for (let i = 1; i <= 3; i++) assert.equal((await post('tok-pro')).status, 200, `call ${i}`);
    const r4 = await post('tok-pro'); assert.equal(r4.status, 429, 'the 4th'); assert.equal(r4.body.sent, false); assert.equal(w.telegram.sent.filter((m: { chat_id: string }) => m.chat_id === '1001').length, 3, 'the 4th went out');
    assert.equal((await post('tok-pro')).status, 429, 'the 5th: refusals do not reset the window');
    assert.equal((await post('tok-pro2')).status, 200, 'a different user');
    mock.timers.setTime(Date.parse('2026-11-18T10:09:59Z')); assert.equal((await post('tok-pro')).status, 429, 'still inside 10 minutes');
    mock.timers.setTime(Date.parse('2026-11-18T10:10:01Z')); assert.equal((await post('tok-pro')).status, 200, 'the window reopened');
  } finally { mock.timers.reset(); }
});

test('A7. WHICH refusals count against the 3 (the limit is checked before the Pro and chat checks): a Free caller\'s 403s and a no-chat 409s eat the quota', async () => {
  const { post } = await scenario();
  const free: number[] = []; for (let i = 0; i < 4; i++) free.push((await post('tok-free')).status);
  const nolink: number[] = []; for (let i = 0; i < 4; i++) nolink.push((await post('tok-nolink')).status);
  assert.deepEqual(free, [403, 403, 403, 429], 'documented behaviour: the 4th Free call is 429, not 403');
  assert.deepEqual(nolink, [409, 409, 409, 429], 'documented behaviour: the 4th no-chat call is 429, not 409');
});

test('A8. Telegram refusing (403 bot blocked, 400 chat not found) or not answering is 502 with sent:false', async () => {
  for (const mode of ['403', '400', 'throw'] as const) {
    const { w, post } = await scenario(); w.telegram.mode = mode;
    const r = await post('tok-pro'); assert.equal(r.status, 502, mode); assert.equal(r.body.ok, false); assert.equal(r.body.sent, false);
    if (mode === 'throw') assert.equal(r.body.error, 'Telegram did not answer');
    else console.log(`[info] ${mode}: the answer carries Telegram's own description: ${JSON.stringify(r.body.error)}`);
  }
});

test('A9. no bot token: 503 for a Pro user, but a Free user is told 403 first (entitlement before server state)', async () => {
  const { post } = await scenario(); const saved = process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_BOT_TOKEN;
  try { assert.equal((await post('tok-free')).status, 403); assert.equal((await post('tok-pro')).status, 503); } finally { process.env.TELEGRAM_BOT_TOKEN = saved; }
});

test('A10. only POST exists on the route (a GET cannot send)', async () => {
  const { mod } = await scenario(); assert.equal(typeof mod.POST, 'function');
  for (const m of ['GET', 'PUT', 'PATCH', 'DELETE']) assert.equal(mod[m], undefined, `${m} is exported`);
});

test('A11. a stored timezone that Intl rejects is not a crash: the message still goes out, stamped in UTC; a real zone is named', async () => {
  const { w, post } = await scenario({ tz: { 'u-badtz': 'Not/AZone', 'u-pro': 'Asia/Manila' } });
  assert.equal((await post('tok-badtz')).status, 200); assert.equal((await post('tok-pro')).status, 200);
  assert.match(w.telegram.sent[0].text, /UTC/); assert.match(w.telegram.sent[1].text, /GMT\+8|PST|\+8/);
});
