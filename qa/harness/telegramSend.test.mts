import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorld, installFakeFetch, loadModule } from '../telegramWorld.mjs';

/* #2332 (S5): POST /api/telegram/send, the REAL handler in-process against the fake network of qa/telegramWorld.mjs.
 * Order the route runs: 401 (no/invalid session) -> 429 (persistent limit, counted BEFORE the Pro check) -> 403 (not Pro) -> 503 (no bot / flag off) -> body: 413, 400 -> 409 (no linked chat) -> send (502 on failure).
 * The fake Auth answers `/auth/v1/user` for the opaque tokens below; the fake `lhq_rate_limit_hit` function counts per key and honours p_limit, so the route's contract (keys, limits, windows) is what is measured.
 * NOT covered: the SQL function itself (PM applied it on dev; its refusal is a database check), a real Telegram delivery (the real-send cell is a separate staging run). */

const PRO_ROW = { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() };
const TRIAL_ROW = { role: 'free', trial_ends_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), current_period_end: null };
const USERS: Record<string, string> = { 'tok-pro': 'u-pro', 'tok-free': 'u-free', 'tok-trial': 'u-trial', 'tok-nolink': 'u-nolink', 'tok-pro2': 'u-pro2' };

async function scenario(o: { rpc?: 'ok' | 'fail'; chat?: Record<string, string | null>; flagOff?: boolean } = {}) {
  const chat = o.chat ?? { 'u-pro': '1001', 'u-pro2': '1002', 'u-free': '2002', 'u-trial': '3003', 'u-nolink': null };
  const w = makeWorld({ tables: {
    lhq_user_subscriptions: [{ user_id: 'u-pro', ...PRO_ROW }, { user_id: 'u-pro2', ...PRO_ROW }, { user_id: 'u-nolink', ...PRO_ROW }, { user_id: 'u-free', role: 'free', trial_ends_at: null, current_period_end: null }, { user_id: 'u-trial', ...TRIAL_ROW }],
    lhq_user_settings: Object.entries(chat).map(([user_id, telegram_chat_id]) => ({ user_id, telegram_chat_id, timezone: 'UTC' })),
    lhq_app_config: o.flagOff ? [{ key: 'feature_flags', value: { telegram: false } }] : [],
  } }) as ReturnType<typeof makeWorld> & { hits: Array<{ key: string; limit: number; window: number }>; counts: Map<string, number> };
  w.hits = []; w.counts = new Map();
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
    if (u.host === 'stub.supabase.test' && u.pathname === '/rest/v1/rpc/lhq_rate_limit_hit') {
      if (o.rpc === 'fail') return new Response(JSON.stringify({ message: 'function does not exist' }), { status: 404, headers: { 'content-type': 'application/json' } });
      const a = JSON.parse(init.body); w.hits.push({ key: a.p_key, limit: a.p_limit, window: a.p_window_seconds });
      const n = (w.counts.get(a.p_key) ?? 0) + 1; w.counts.set(a.p_key, n);
      return new Response(JSON.stringify(n <= a.p_limit), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return inner(input, init);
  };
  const mod = await loadModule('app/api/telegram/send/route.ts');
  const { NextRequest } = await import('next/server.js');
  const post = async (token: string | null, body: unknown, extra: Record<string, string> = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const res = await mod.POST(new NextRequest('http://localhost/api/telegram/send', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: raw }));
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { w, post };
}
const M = { message: 'hello' };

test('S1. signed out (no header, an empty bearer, an unknown token) is 401 and sends nothing', async () => {
  const { w, post } = await scenario();
  for (const t of [null, '', 'tok-unknown']) { const r = await post(t, M); assert.equal(r.status, 401, `token ${JSON.stringify(t)}`); }
  assert.equal(w.telegram.attempts.length, 0);
});

test('S2. a Free account is 403 PRO_REQUIRED and sends nothing; a trial account counts as Pro', async () => {
  const { w, post } = await scenario();
  const f = await post('tok-free', M); assert.equal(f.status, 403); assert.equal(f.body.error, 'PRO_REQUIRED'); assert.equal(w.telegram.attempts.length, 0);
  const t = await post('tok-trial', M); assert.equal(t.status, 200); assert.deepEqual(w.telegram.sent.map((m: { chat_id: string }) => m.chat_id), ['3003']);
});

test('S3. a Pro account with no linked chat is 409, and there is NO fallback to the global TELEGRAM_CHAT_ID', async () => {
  const { w, post } = await scenario();
  process.env.TELEGRAM_CHAT_ID = '9999';
  try {
    assert.equal((await post('tok-nolink', M)).status, 409);
    const blank = await scenario({ chat: { 'u-nolink': '   ' } }); assert.equal((await blank.post('tok-nolink', M)).status, 409);
    assert.equal(w.telegram.attempts.length + blank.w.telegram.attempts.length, 0, 'something was sent');
  } finally { delete process.env.TELEGRAM_CHAT_ID; }
});

test('S4. a Pro account\'s message goes to ITS OWN chat only; the caller cannot pick the chat', async () => {
  const { w, post } = await scenario();
  assert.equal((await post('tok-pro', M)).status, 200); assert.equal((await post('tok-pro2', M)).status, 200);
  assert.deepEqual(w.telegram.sent.map((m: { chat_id: string }) => m.chat_id), ['1001', '1002']);
  const r = await post('tok-pro', { message: 'x', chat_id: '2002' }); assert.equal(r.status, 400); assert.equal(w.telegram.sent.length, 2, 'a chat_id in the body was honoured');
});

test('S5. the body: over 4 KB is 413 (declared, and streamed without a declared size); extra keys, a bad shape, an empty or 1001-character message are 400', async () => {
  const { w, post } = await scenario();
  assert.equal((await post('tok-pro', { message: 'a'.repeat(5000) })).status, 413);
  w.counts.clear(); assert.equal((await post('tok-pro', { message: 'a'.repeat(5000) }, { 'content-length': '9999' })).status, 413);
  w.counts.clear(); assert.equal((await post('tok-pro', { message: 'a'.repeat(1001) })).status, 400, '1001 characters');
  w.counts.clear(); assert.equal((await post('tok-pro', { message: 'a'.repeat(1000) })).status, 200, 'exactly 1000 is allowed');
  for (const b of [{ message: 'x', parse_mode: 'MarkdownV2' }, { message: 'x', extra: 1 }, { msg: 'x' }, {}, [], 'not json {', '"just a string"', 'null', { message: '' }, { message: '   ' }, { message: 5 }, { message: ['x'] }, { message: null }]) {
    w.counts.clear(); const r = await post('tok-pro', b); assert.equal(r.status, 400, JSON.stringify(b));
  }
  assert.equal(w.telegram.sent.length, 1, 'only the valid 1000-character message went out');
});

test('S6. the text is escaped: only <b> and <i> survive; a link, a script and an attribute are inert; the send uses parse_mode HTML', async () => {
  const { w, post } = await scenario();
  await post('tok-pro', { message: '<b>bold</b> <i>it</i> <a href="https://evil.test">x</a> <script>alert(1)</script> <b onclick="x">y</b> a & b' });
  const t = w.telegram.sent[0].text as string;
  assert.match(t, /^<b>bold<\/b> <i>it<\/i> /);
  for (const bad of ['<a ', '<script', '</a>']) assert.equal(t.includes(bad), false, `${bad} survived: ${t}`);
  assert.deepEqual([...t.matchAll(/<[^>]*>/g)].map((m) => m[0]).filter((x) => !['<b>', '</b>', '<i>', '</i>'].includes(x)), [], 'a real tag other than b and i, or one with attributes, is in the text');
  assert.ok(t.includes('&lt;a href=') && t.includes('&lt;script&gt;') && t.includes('a &amp; b'));
});

test('S7. the limit is 10 a minute per user: the 11th is 429, another user is unaffected, and a refused request is not counted as a send', async () => {
  const { w, post } = await scenario();
  for (let i = 1; i <= 10; i++) assert.equal((await post('tok-pro', M)).status, 200, `request ${i}`);
  assert.equal((await post('tok-pro', M)).status, 429, 'the 11th');
  assert.equal((await post('tok-pro2', M)).status, 200, 'a different user');
  assert.equal(w.telegram.sent.filter((m: { chat_id: string }) => m.chat_id === '1001').length, 10);
  const mins = w.hits.filter((h: { key: string }) => h.key === 'telegram-send:user:u-pro'); assert.ok(mins.length >= 11 && mins.every((h: { limit: number; window: number }) => h.limit === 10 && h.window === 60));
});

test('S8. the hourly limit is 100 per user (key, limit and window as the route asks the database)', async () => {
  const { w, post } = await scenario();
  for (let i = 1; i <= 101; i++) { for (const k of [...w.counts.keys()]) if (k.startsWith('telegram-send:user:')) w.counts.delete(k); const r = await post('tok-pro', M); assert.equal(r.status, i <= 100 ? 200 : 429, `request ${i}`); }
  const hr = w.hits.filter((h: { key: string }) => h.key === 'telegram-send:user-hour:u-pro'); assert.ok(hr.length >= 101 && hr.every((h: { limit: number; window: number }) => h.limit === 100 && h.window === 3600));
});

test('S9. where the database function is missing or failing the route still limits (falls back to memory: the 11th is 429), never unlimited', async () => {
  const { post } = await scenario({ rpc: 'fail' });
  const codes: number[] = []; for (let i = 0; i < 11; i++) codes.push((await post('tok-pro', M)).status);
  assert.deepEqual(codes, [...Array(10).fill(200), 429]);
});

test('S10. Telegram refusing the send is 502 with NO Telegram text in the answer; the feature flag off is 503', async () => {
  const a = await scenario(); a.w.telegram.mode = '403';
  const r = await a.post('tok-pro', M); assert.equal(r.status, 502); assert.equal(JSON.stringify(r.body).includes('blocked'), false, 'Telegram\'s own description was echoed');
  const b = await scenario({ flagOff: true }); const f = await b.post('tok-pro', M); assert.equal(f.status, 503); assert.equal(b.w.telegram.attempts.length, 0);
});

test('S11. the three browser-triggered sends are gone from the app (no fetch of /api/telegram/send outside the route itself)', () => {
  const hits: string[] = [];
  const walk = (dir: string) => { for (const n of readdirSync(dir)) { if (n === 'node_modules' || n === '.next' || n.startsWith('.')) continue; const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|mts|jsx?)$/.test(n) && readFileSync(p, 'utf8').includes('/api/telegram/send')) hits.push(p.split('\\').join('/')); } };
  for (const d of ['app', 'components', 'lib', 'hooks']) { try { walk(d); } catch { /* a folder that does not exist */ } }
  assert.deepEqual(hits.filter((p) => !p.startsWith('app/api/telegram/send/')), [], 'a caller of /api/telegram/send is still in the app');
});
