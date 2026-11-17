/* #2478: a chat that can NEVER receive again is unlinked, and the webhook's flood limit is per CHAT, not per caller address.
 *   D1  isDeadChatReason: Telegram's permanent reasons (blocked, deactivated, chat not found, kicked, deleted group, not a member, PEER_ID_INVALID) are dead; every TRANSIENT reason (429, 5xx, timeout, message too long, can't parse entities) is not,
 *       so a flaky send can never unlink anyone
 *   D2  the alert route clears the link only for HTTP 400/403 AND a dead reason, only for the chats that failed (a filtered update, never an unfiltered one), best effort (a failed unlink goes to the tally, never throws)
 *   W1  the REAL webhook route: one chat is limited after 30 updates in a minute while ANOTHER chat from the SAME caller address is not (the old key was the caller address: every user shared one bucket)
 *   W2  a request without the secret is refused (401) BEFORE it can spend any chat's allowance
 *   W3  an update with no chat shares one bucket, and does not touch a real chat's
 * WHAT IT CANNOT PROVE: Telegram's real error wording, or that Telegram sends updates from few addresses (the reason for the change). */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
process.env.TELEGRAM_BOT_TOKEN = 'qa-bot-token'; process.env.TELEGRAM_WEBHOOK_SECRET = 'qa-webhook-secret';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.host === 'api.telegram.org') return json(200, { ok: true, result: true });
  if (url.host === 'supabase.invalid') return json(200, []);
  throw new Error(`stray request ${url.host}`);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

const { isDeadChatReason } = await import('../lib/telegramDeadChat.ts');
const { POST: WEBHOOK } = await import('../app/api/telegram/webhook/route.ts');

test('D1. permanent Telegram reasons are dead; transient ones never are', () => {
  for (const why of ['Forbidden: bot was blocked by the user', 'Forbidden: user is deactivated', 'Bad Request: chat not found', 'Forbidden: bot was kicked from the group chat',
    'Forbidden: the group chat was deleted', 'Forbidden: bot is not a member of the supergroup chat', 'Bad Request: PEER_ID_INVALID']) assert.equal(isDeadChatReason(why), true, why);
  for (const why of ['Too Many Requests: retry after 5', 'HTTP 502', 'HTTP 429', 'Bad Request: message is too long', "Bad Request: can't parse entities: Unsupported start tag", 'The operation was aborted due to timeout', 'fetch failed', '']) assert.equal(isDeadChatReason(why), false, `a transient failure would unlink someone: "${why}"`);
});

test('D2. the alert route unlinks only on 400/403 + a dead reason, only the failed chats, and a failed unlink cannot abort the run', () => {
  const src = readFileSync(new URL('../app/api/telegram/alert/route.ts', import.meta.url), 'utf8');
  assert.match(src, /\(res\.status === 403 \|\| res\.status === 400\) && isDeadChatReason\(why\)\) deadChats\.add\(id\)/, 'the gate: status AND reason');
  assert.match(src, /\.update\(\{ telegram_chat_id: null \}\)\.in\('telegram_chat_id', \[\.\.\.deadChats\]\)/, 'the unlink must be filtered to the dead chats (an unfiltered update would unlink everybody)');
  const at = src.indexOf('if (deadChats.size > 0)'); const block = src.slice(at, at + 520);
  assert.ok(at > 0 && /try \{[\s\S]*\} catch \(e\) \{ sendTally\.reasons\.add\(`unlink failed:/.test(block), 'a failed unlink is reported to the tally inside a try, never thrown');
  assert.ok(src.indexOf('deadChats.add(id)') < at, 'the unlink runs after every send has been tried');
});

const post = (update: unknown, o: { secret?: string | null; ip?: string } = {}) => WEBHOOK(new NextRequest('http://localhost/api/telegram/webhook', {
  method: 'POST', body: JSON.stringify(update), headers: { 'content-type': 'application/json', 'x-forwarded-for': o.ip ?? '149.154.167.1', ...(o.secret === null ? {} : { 'x-telegram-bot-api-secret-token': o.secret ?? 'qa-webhook-secret' }) },
}));
const hello = (chat: number) => ({ message: { chat: { id: chat }, text: 'hello' } });

test('W1. the limit is per CHAT: chat 7001 is limited after 30 updates, chat 7002 from the SAME address still gets through', async () => {
  let last = 200; for (let i = 0; i < 31; i++) last = (await post(hello(7001))).status;
  assert.equal(last, 429, 'the 31st update from one chat must be limited');
  assert.equal((await post(hello(7002))).status, 200, 'another chat from the same address was limited: the bucket is still per address');
  assert.equal((await post(hello(7001))).status, 429, 'chat 7001 stays limited within the minute');
});

test('W2. a request without (or with a wrong) secret is 401 and spends nobody\'s allowance', async () => {
  for (let i = 0; i < 40; i++) assert.equal((await post(hello(7003), { secret: i % 2 ? null : 'wrong' })).status, 401);
  assert.equal((await post(hello(7003))).status, 200, 'unauthenticated traffic used up the chat\'s allowance');
});

test('W3. updates with no chat share ONE bucket and never touch a real chat\'s', async () => {
  let last = 200; for (let i = 0; i < 31; i++) last = (await post({ my_chat_member: { x: i } }, { ip: '149.154.167.2' })).status;
  assert.equal(last, 429, 'the shared no-chat bucket is limited too');
  assert.equal((await post(hello(7004))).status, 200, 'a real chat was limited by chat-less traffic');
});
