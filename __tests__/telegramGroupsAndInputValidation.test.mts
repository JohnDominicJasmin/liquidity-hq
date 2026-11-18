/* #2458 (low validation): the Telegram parts run on the REAL webhook route with the stand-in network; the rest is the real isDateOnly and source anchors.
 *   C9   /start@Bot CODE (how a command arrives from a menu or a group) reads the code; "/startfoo" is not /start; only a PRIVATE chat can be linked: /start CODE from a group answers "Open a private chat..." and looks nothing up; a bare /start in a group still gets the welcome
 *   C10  /api/telegram/status without a session answers 401 (it used to say whether the OWNER's own chat id is set)
 *   B1   lib/dateInput.isDateOnly: only a REAL YYYY-MM-DD (rejects 2026-02-30, 2026-13-01, text, numbers, ISO timestamps, empty)
 *   B2   source anchors: hypotheses POST/PATCH and evidence reject non-text fields and bad dates with 400; thesis check refuses a direction other than LONG/SHORT, a blank thesis and an empty assumption list BEFORE reserving a use; Pine needs 10 characters; /api/telegram/send retries unbalanced tags as plain text
 * WHAT IT CANNOT PROVE: the five route-level 400s end to end (they need the signed-in stand-in world; the source anchors are the guard, stated plainly). */
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

import { readFileSync } from 'node:fs';
import { isDateOnly } from '../lib/dateInput.ts';
const { GET: STATUS } = await import('../app/api/telegram/status/route.ts');
const priv = (id: number, text: string) => ({ message: { chat: { id, type: 'private' }, text } });
const group = (id: number, text: string) => ({ message: { chat: { id, type: 'group' }, text } });

test('C9a. /start@Bot CODE reads the code exactly like /start CODE (a command from a menu or a group)', async () => {
  code('ABC123');
  for (const text of ['/start@LiquidityHQ_bot ABC123', '/START@LiquidityHQ_bot abc123', '/start ABC123']) {
    db.tg = []; await send(priv(555, text)); const [m] = sent(); assert.ok(m, `${text}: no reply`); assert.match(textOf(m), /mi\*\*\*@example\.test/, `${text}: the code was not read`);
  }
});
test('C9b. "/startfoo", "/starting" and "/start-x" are not the start command: nothing is linked or looked up and no Confirm button is offered; since #2567 a private chat is answered with the /help list instead of silence', async () => {
  code('ABC123');
  for (const text of ['/startfoo ABC123', '/starting', '/start-x ABC123']) {
    db.tg = []; await send(priv(555, text)); const m = sent(); assert.equal(m.length, 1, `${text}: one reply (the /help list) expected, got ${m.length}`);
    assert.match(textOf(m[0]), /^Commands:/, `${text}: was treated as /start or answered with something other than /help: ${textOf(m[0])}`); assert.equal(m[0].reply_markup, undefined, `${text}: a Confirm button was offered`);
    assert.doesNotMatch(textOf(m[0]), /Connect this chat|Welcome to|mi\*\*\*@/);
  }
  assert.equal(db.settings.size, 0, 'a chat was linked'); assert.equal(db.codes.get('ABC123')!.used_at, null, 'the code was spent');
});
test('C9c. THE DEFECT: /start CODE from a GROUP links nothing, looks nothing up, and says to open a private chat (a group id would receive one account\'s alerts for everyone in the group)', async () => {
  code('ABC123');
  for (const text of ['/start ABC123', '/start@LiquidityHQ_bot ABC123']) { db.tg = []; await send(group(-100200, text)); assert.match(textOf(sent().at(-1)!), /private chat/i, `${text}: no private-chat instruction`); assert.equal(sent().at(-1)!.reply_markup, undefined, 'a Confirm button was offered in a group'); }
  await send({ message: { chat: { id: -100200, type: 'supergroup' }, text: '/start ABC123' } }); assert.match(textOf(sent().at(-1)!), /private chat/i);
  assert.equal(db.settings.size, 0); assert.equal(db.codes.get('ABC123')!.used_at, null);
  db.tg = []; await send(group(-100200, '/start')); assert.match(textOf(sent().at(-1)!), /Welcome to/i, 'a bare /start in a group lost its welcome');
});
test('C9d. a private chat (and an update with no chat type) still links through Confirm', async () => {
  code('ABC123'); await send({ message: { chat: { id: 555 }, text: '/start ABC123' } }); assert.match(textOf(sent().at(-1)!), /Connect this chat to/);
  await send({ callback_query: { id: 'cb1', data: 'link:ABC123', message: { chat: { id: 555, type: 'private' }, message_id: 7 } } }); assert.equal(db.settings.get(U1)?.telegram_chat_id, '555');
});
test('C10. /api/telegram/status without a session is 401 and does not say whether the owner\'s own chat id is set', async () => {
  process.env.TELEGRAM_CHAT_ID = 'owner-chat';
  const r = await STATUS(new NextRequest('http://localhost/api/telegram/status')); const b = await r.json() as Record<string, unknown>;
  assert.equal(r.status, 401); assert.equal('configured' in b, false, 'the unauthenticated answer still discloses the owner chat configuration'); delete process.env.TELEGRAM_CHAT_ID;
});

test('B1. isDateOnly accepts only a REAL YYYY-MM-DD', () => {
  for (const ok of ['2026-11-17', '2026-02-28', '2028-02-29', '1999-12-31']) assert.equal(isDateOnly(ok), true, ok);
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2027-02-29', 'not a date', '2026-1-5', '2026-11-17T10:00:00Z', ' 2026-11-17', '', '20261117', 20261117, null, undefined, {}, ['2026-11-17']]) assert.equal(isDateOnly(bad), false, String(JSON.stringify(bad)));
});

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('B2. the 400s: hypotheses and evidence reject non-text fields and a bad target_date; thesis check refuses a bad direction / blank thesis / empty assumptions before reserving; Pine needs 10 characters; send retries unbalanced tags as plain text', () => {
  const hyp = read('app/api/hypotheses/route.ts');
  assert.ok(hyp.includes("typeof body.title !== 'string' || typeof body.hypothesis !== 'string' || !body.title.trim() || !body.hypothesis.trim()"), 'a non-text title still throws on .trim() (500)');
  assert.ok(hyp.includes('body.target_date != null && !isDateOnly(body.target_date)'), 'a bad target_date reaches the date column on POST');
  assert.ok(read('app/api/hypotheses/[id]/route.ts').includes("'target_date' in update && update.target_date != null && !isDateOnly(update.target_date)"), 'a bad target_date reaches the date column on PATCH');
  assert.ok(read('app/api/hypotheses/[id]/evidence/route.ts').includes("typeof body.content !== 'string' || !body.content.trim() || typeof body.type !== 'string' || !body.type") && read('app/api/hypotheses/[id]/evidence/route.ts').includes("(body.source != null && typeof body.source !== 'string')"), 'evidence accepts non-text content, type or source');
  const th = read('app/api/thesis-check/route.ts');
  assert.ok(th.includes("(directionWord !== 'LONG' && directionWord !== 'SHORT') || !thesisText.trim() || cleanAssumptions.length === 0"), 'the thesis-check input rule changed');
  assert.ok(th.indexOf("directionWord !== 'LONG'") < th.indexOf("incrementToolUsage(authData.user.id, 'thesisCheck'"), 'the thesis input is validated AFTER the use is reserved');
  assert.ok(read('app/api/pine-script/route.ts').includes('description.length < 10'), 'the Pine description floor is gone');
  const send = read('app/api/telegram/send/route.ts'); assert.ok(send.includes("if (!data?.ok && res.status === 400) {") && send.includes("message.replace(/<\\/?(b|i)>/gi, '')"), 'the plain-text retry for unbalanced tags is gone');
});
