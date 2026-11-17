/* #2455: the Telegram link no longer binds a chat by itself. THE REAL /api/telegram/webhook ROUTE runs (and setup-webhook) with a stand-in network: the link-code and settings tables, the Auth admin lookup and the Telegram API, whose every call is recorded.
 *   L1  /start CODE only LOOKS the code up: nothing is linked, the code is not spent, the chat is told a MASKED address (mi***@example.com) and gets a Confirm button
 *   L2  an unknown, expired or used code gets one identical "expired or already used" message (the route cannot be used to probe which codes exist), and no button
 *   L3  Confirm links THIS chat to the code's account and spends the code; a second Confirm (a double tap or a redelivery) says "Connected", never "expired"
 *   L4  a failed save PUTS THE CODE BACK and says so, so Confirm can be pressed again
 *   L5  a Confirm for an expired code, or from a chat that is not linked, says expired; a callback with other data does nothing
 *   S1  /stop clears ONLY the chat it is sent from, and answers
 *   S2  the route answers 200 whatever happens inside (a throwing Telegram call, a malformed body), 401 without the secret header, and refuses (401) when the secret env is unset
 *   W1  setup-webhook refuses (500) when the webhook secret is not set and never calls setWebhook; with it, setWebhook carries secret_token
 * WHAT IT CANNOT PROVE: that Telegram really redelivers or that the real inline keyboard renders. */
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
process.env.TELEGRAM_BOT_TOKEN = 'qa-bot-token'; process.env.TELEGRAM_WEBHOOK_SECRET = 'qa-webhook-secret';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';

type Code = { code: string; user_id: string; used_at: string | null; expires_at: string };
type Setting = { user_id: string; telegram_chat_id: string | null };
const db = { codes: new Map<string, Code>(), settings: new Map<string, Setting>(), emails: new Map<string, string>(), tg: [] as { method: string; body: Record<string, unknown> }[], failUpsert: false, tgThrows: false, dbThrows: false, tgCalls: [] as string[], stray: [] as string[] };
const reset = () => { db.codes.clear(); db.settings.clear(); db.emails.clear(); db.tg = []; db.failUpsert = false; db.tgThrows = false; db.dbThrows = false; db.stray = []; db.emails.set(U1, 'michael@example.test'); db.emails.set(U2, 'sam@example.test'); };
const code = (c: string, over: Partial<Code> = {}) => db.codes.set(c, { code: c, user_id: U1, used_at: null, expires_at: new Date(Date.now() + 3_600_000).toISOString(), ...over });
const filt = (u: URL, k: string) => { const v = u.searchParams.get(k); return v === null ? null : v; };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.host === 'api.telegram.org') {
    const method = url.pathname.split('/').pop()!; const body = req.method === 'POST' ? JSON.parse(await req.text() || '{}') : {};
    db.tg.push({ method, body }); if (db.tgThrows) throw new Error('telegram down');
    return json(200, { ok: true, result: true });
  }
  if (url.origin !== SUPABASE) { db.stray.push(url.host); throw new Error(`stray request ${req.method} ${req.url}`); }
  const p = url.pathname; const one = (row: unknown) => ((req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? (row == null ? json(406, { code: 'PGRST116', message: 'no rows', details: '', hint: '' }) : json(200, row)) : json(200, row == null ? [] : [row]));
  if (p.startsWith('/auth/v1/admin/users/')) { const id = p.split('/').pop()!; const e = db.emails.get(id); return e ? json(200, { id, email: e }) : json(404, { message: 'User not found' }); }
  if (db.dbThrows && p.endsWith('telegram_link_codes')) throw new Error('stand-in: network down');
  if (p.endsWith('telegram_link_codes')) {
    const c = db.codes.get((filt(url, 'code') ?? '').replace(/^eq\./, ''));
    const live = c && c.used_at === null && Date.parse(c.expires_at) > Date.now();
    if (req.method === 'GET') return one(live ? { user_id: c!.user_id } : null);
    if (req.method === 'PATCH') {
      const body = JSON.parse(await req.text()) as Partial<Code>;
      if (body.used_at === null) { if (c) c.used_at = null; return one(c ? { user_id: c.user_id } : null); }   // the "put it back" write
      if (!live) return one(null);
      c!.used_at = body.used_at ?? new Date().toISOString(); return one({ user_id: c!.user_id });
    }
  }
  if (p.endsWith('user_settings')) {
    if (req.method === 'GET') { const chat = (filt(url, 'telegram_chat_id') ?? '').replace(/^eq\./, ''); return json(200, [...db.settings.values()].filter((s) => s.telegram_chat_id === chat).map((s) => ({ user_id: s.user_id }))); }
    if (req.method === 'PATCH') {                                                  // /stop: clears the chat id where telegram_chat_id = this chat
      const chat = (filt(url, 'telegram_chat_id') ?? '').replace(/^eq\./, ''); const notUser = (filt(url, 'user_id') ?? '').replace(/^neq\./, '');   /* #2484: the filter may carry user_id=neq.<id> (clear OTHER accounts only) and select=user_id (answer the rows it cleared) */
      const cleared: { user_id: string }[] = []; for (const s of db.settings.values()) if (s.telegram_chat_id === chat && (!notUser || s.user_id !== notUser)) { s.telegram_chat_id = null; cleared.push({ user_id: s.user_id }); }
      return url.searchParams.get('select') ? json(200, cleared) : json(204, null);
    }
    if (req.method === 'POST') {                                                   // the upsert
      if (db.failUpsert) return json(500, { code: 'XX000', message: 'stand-in: write failed', details: '', hint: '' });
      const b = JSON.parse(await req.text()) as Setting; db.settings.set(b.user_id, { user_id: b.user_id, telegram_chat_id: b.telegram_chat_id }); return new Response(null, { status: 201 });
    }
  }
  return json(200, []);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

const { POST: WEBHOOK } = await import('../app/api/telegram/webhook/route.ts');
const { GET: SETUP, POST: SETUP_POST } = (await import('../app/api/telegram/setup-webhook/route.ts')) as { GET?: (r: NextRequest) => Promise<Response>; POST?: (r: NextRequest) => Promise<Response> };
let ip = 0;
const send = (update: unknown, secret: string | null = 'qa-webhook-secret') => WEBHOOK(new NextRequest('http://localhost/api/telegram/webhook', {
  method: 'POST', body: typeof update === 'string' ? update : JSON.stringify(update), headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${++ip}`, ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) },
}));
const start = (chat: number, text: string) => ({ message: { chat: { id: chat }, text } });
const confirm = (chat: number, data: string) => ({ callback_query: { id: 'cb1', data, message: { chat: { id: chat }, message_id: 7 } } });
const sent = (method = 'sendMessage') => db.tg.filter((t) => t.method === method).map((t) => t.body);
const textOf = (b: Record<string, unknown>) => String(b.text ?? '');
beforeEach(reset);

test('L1. /start CODE only LOOKS the code up: nothing linked, code not spent, a MASKED address is named, a Confirm button carries the code', async () => {
  code('ABC123');
  const r = await send(start(555, '/start abc123'));
  assert.equal(r.status, 200); assert.equal(db.settings.size, 0, 'the chat was linked by the link alone (a forwarded link would link a stranger)'); assert.equal(db.codes.get('ABC123')!.used_at, null, 'the code was spent by a lookup');
  const [msg] = sent(); assert.ok(msg, 'the chat was told nothing');
  assert.match(textOf(msg), /mi\*\*\*@example\.test/, 'the account is not named in masked form'); assert.doesNotMatch(textOf(msg), /michael@example\.test/, 'the full address was disclosed to whoever opened the link');
  assert.deepEqual((msg.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard[0][0], { text: 'Confirm', callback_data: 'link:ABC123' });
});
test('L2. an unknown, expired or already-used code gets the SAME message and no button (no probing which codes exist)', async () => {
  code('USED', { used_at: new Date().toISOString() }); code('OLD', { expires_at: new Date(Date.now() - 1000).toISOString() });
  const texts: string[] = [];
  for (const c of ['NOPE', 'USED', 'OLD']) { db.tg = []; await send(start(555, `/start ${c}`)); const [m] = sent(); texts.push(textOf(m)); assert.equal(m.reply_markup, undefined, `${c}: a button was offered`); }
  assert.equal(new Set(texts).size, 1, 'the three cases answer differently: the route can be used to probe codes'); assert.match(texts[0], /expired or was already used/);
  assert.equal(db.settings.size, 0);
});
test('L3. Confirm links THIS chat to the code\'s account and spends the code; a second Confirm (double tap / redelivery) says Connected, never expired', async () => {
  code('ABC123');
  await send(confirm(555, 'link:ABC123'));
  assert.equal(db.settings.get(U1)?.telegram_chat_id, '555', 'Confirm did not link the chat'); assert.notEqual(db.codes.get('ABC123')!.used_at, null, 'the code was not spent');
  assert.match(textOf(sent().at(-1)!), /Connected/);
  db.tg = []; const r = await send(confirm(555, 'link:ABC123'));
  assert.equal(r.status, 200); assert.match(textOf(sent().at(-1)!), /Connected/, 'a redelivered Confirm told a linked user the link had expired'); assert.doesNotMatch(textOf(sent().at(-1)!), /expired/);
  assert.equal(db.settings.get(U1)?.telegram_chat_id, '555');
});
test('L3b. a DIFFERENT chat pressing Confirm for a spent code is told it expired and is not linked', async () => {
  code('ABC123'); await send(confirm(555, 'link:ABC123')); db.tg = [];
  await send(confirm(777, 'link:ABC123'));
  assert.match(textOf(sent().at(-1)!), /expired or was already used/); assert.equal([...db.settings.values()].some((s) => s.telegram_chat_id === '777'), false, 'a second chat was linked with a spent code');
});
test('L4. a FAILED save puts the code back (Confirm can be pressed again) and says so; the retry then links', async () => {
  code('ABC123'); db.failUpsert = true;
  await send(confirm(555, 'link:ABC123'));
  assert.equal(db.codes.get('ABC123')!.used_at, null, 'the code stayed burned after a failed save: the user cannot retry'); assert.equal(db.settings.size, 0);
  assert.match(textOf(sent().at(-1)!), /Could not finish connecting/); assert.ok(sent('answerCallbackQuery').length >= 1);
  db.failUpsert = false; db.tg = []; await send(confirm(555, 'link:ABC123'));
  assert.equal(db.settings.get(U1)?.telegram_chat_id, '555'); assert.match(textOf(sent().at(-1)!), /Connected/);
});
test('L5. an expired code on Confirm says expired; a callback with other data does nothing but answer', async () => {
  code('OLD', { expires_at: new Date(Date.now() - 1000).toISOString() });
  await send(confirm(555, 'link:OLD')); assert.match(textOf(sent().at(-1)!), /expired or was already used/); assert.equal(db.settings.size, 0);
  db.tg = []; await send(confirm(555, 'something:else')); assert.equal(sent().length, 0, 'an unrelated callback produced a message'); assert.equal(sent('answerCallbackQuery').length, 1);
});

test('S1. /stop clears ONLY the chat it is sent from, and answers', async () => {
  db.settings.set(U1, { user_id: U1, telegram_chat_id: '555' }); db.settings.set(U2, { user_id: U2, telegram_chat_id: '777' });
  await send(start(555, '/stop'));
  assert.equal(db.settings.get(U1)!.telegram_chat_id, null, '/stop did not unlink the chat'); assert.equal(db.settings.get(U2)!.telegram_chat_id, '777', '/stop unlinked ANOTHER chat');
  assert.match(textOf(sent().at(-1)!), /Disconnected/);
  db.tg = []; await send(start(555, '/stop@LiquidityHQBot')); assert.match(textOf(sent().at(-1)!), /Disconnected/, '/stop@Bot is not understood');
});
test('S2. the route answers 200 whatever happens inside (a throwing Telegram, a malformed body); 401 without the secret header; 401 when the secret env is unset', async () => {
  code('ABC123'); db.tgThrows = true;
  assert.equal((await send(start(555, '/start ABC123'))).status, 200, 'a Telegram failure became a non-2xx: Telegram redelivers and the second pass says expired');
  assert.equal((await send('not json {')).status, 200);
  db.tgThrows = false; db.dbThrows = true;
  assert.equal((await send(start(555, '/start ABC123'))).status, 200, 'a database failure inside the handler became a non-2xx (Telegram redelivers it)'); assert.equal((await send(confirm(555, 'link:ABC123'))).status, 200);
  db.dbThrows = false;
  assert.equal((await send(start(555, '/start ABC123'), null)).status, 401); assert.equal((await send(start(555, '/start ABC123'), 'wrong')).status, 401);
  const saved = process.env.TELEGRAM_WEBHOOK_SECRET; delete process.env.TELEGRAM_WEBHOOK_SECRET;
  try { assert.equal((await send(start(555, '/start ABC123'), 'qa-webhook-secret')).status, 401, 'an unset secret did not fail closed'); } finally { process.env.TELEGRAM_WEBHOOK_SECRET = saved; }
});

test('W1. setup-webhook refuses to register without the secret (never calls setWebhook); with it, setWebhook carries secret_token', async () => {
  const fn = SETUP ?? SETUP_POST; assert.ok(fn, 'CONTROL: the route exports neither GET nor POST');
  const req = () => new NextRequest('http://localhost/api/telegram/setup-webhook', { method: SETUP ? 'GET' : 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '', authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` } });
  process.env.CRON_SECRET = 'qa-cron'; const saved = process.env.TELEGRAM_WEBHOOK_SECRET; delete process.env.TELEGRAM_WEBHOOK_SECRET;
  try {
    const r = await fn!(new NextRequest('http://localhost/api/telegram/setup-webhook', { method: SETUP ? 'GET' : 'POST', headers: { 'x-cron-secret': 'qa-cron' } }));
    assert.equal(db.tg.some((t) => t.method === 'setWebhook'), false, 'setWebhook was called without a secret_token'); assert.ok(r.status === 500 || r.status === 401 || r.status === 403, `status ${r.status}`);
    process.env.TELEGRAM_WEBHOOK_SECRET = 'qa-webhook-secret'; db.tg = [];
    const ok = await fn!(new NextRequest('http://localhost/api/telegram/setup-webhook', { method: SETUP ? 'GET' : 'POST', headers: { 'x-cron-secret': 'qa-cron' } }));
    void req; void ok;
    const set = db.tg.find((t) => t.method === 'setWebhook'); assert.ok(set, 'CONTROL: with the secret set the route never registered the webhook, so the secret_token below was not measured'); assert.equal(set!.body.secret_token, 'qa-webhook-secret', 'setWebhook does not carry the secret_token');
  } finally { if (saved) process.env.TELEGRAM_WEBHOOK_SECRET = saved; else delete process.env.TELEGRAM_WEBHOOK_SECRET; }
});

/* ── #2484: ONE CHAT, ONE ACCOUNT. Confirming proves control of THIS chat, so any OTHER account holding it loses the link; the stand-in honours user_id=neq and select=user_id ─────────────────────────────────────── */

const press = (chat: number, data: string) => send({ callback_query: { id: 'cb9', data, message: { chat: { id: chat, type: 'private' }, message_id: 7 } } });
const doneText = () => sent('editMessageText').map(textOf).concat(sent('sendMessage').map(textOf)).join(' | ');

test('O1. a chat already linked to ANOTHER account: Confirm links the confirming account, clears the other one, and tells the chat', async () => {
  code('ABC123'); db.settings.set(U2, { user_id: U2, telegram_chat_id: '555' });
  await press(555, 'link:ABC123');
  assert.equal(db.settings.get(U1)?.telegram_chat_id, '555', 'the confirming account must be linked (a clear that ignored neq would strip it too)');
  assert.equal(db.settings.get(U2)?.telegram_chat_id, null, 'the other account must lose the chat');
  assert.match(doneText(), /linked to another LiquidityHQ account, which no longer receives alerts here/);
});

test('O2. nobody else held the chat: linked, and the message does NOT claim another account was displaced', async () => {
  code('ABC123'); db.settings.set(U2, { user_id: U2, telegram_chat_id: '999' });
  await press(555, 'link:ABC123');
  assert.equal(db.settings.get(U1)?.telegram_chat_id, '555');
  assert.equal(db.settings.get(U2)?.telegram_chat_id, '999', 'an account on a DIFFERENT chat must be left alone');
  assert.doesNotMatch(doneText(), /another LiquidityHQ account/);
});

test('O3. a FAILED save strips nobody: the other account keeps its link (the clear runs only after the new link is written)', async () => {
  code('ABC123'); db.settings.set(U2, { user_id: U2, telegram_chat_id: '555' }); db.failUpsert = true;
  await press(555, 'link:ABC123');
  assert.equal(db.settings.get(U2)?.telegram_chat_id, '555', 'the other account was stripped although the new link was never written');
  assert.notEqual(db.settings.get(U1)?.telegram_chat_id, '555');
});
