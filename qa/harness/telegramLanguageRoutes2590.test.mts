import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeWorld, installControlsWorld } from '../telegramControlsWorld.mjs';
import { loadModule, loadRoute } from '../telegramWorld.mjs';

/* QA's ROUTE cells for #2590 (Telegram in the reader's saved language, #1651): the REAL webhook, test-alert and alert (plan-ended notice) routes in-process, a fake network and database, nothing leaves the machine.
 * The label table the fake database serves is the PROD block of the held migration 20261119z5.
 *   R1  webhook: /help /status /pause /resume /stop and an unknown command reply in the language of the account linked to the chat (ko, zh, ru); ar (English by PM decision), en, no language, "ko-KR", "pt-BR" read English
 *   R2  webhook: /stop replies in the account's language (it is read BEFORE the chat is unlinked), the chat IS unlinked, and the next /status from that chat is English (no account, no language)
 *   R3  webhook: a chat that is not linked yet (welcome, /status, expired code) reads English; a valid code: the Confirm question and button are in the language of the account the code belongs to
 *   R4  webhook: a Mute tap answers in the chat's language with the same callback data semantics; English chat gets the English reply (byte-identical to the pre-PR text)
 *   R5  test-alert route: the test message is in the account's language (ko), English for en / none / "ko-KR"
 *   R6  plan-ended notice: in the account's saved language; English when none; only ONE notice per lapse still
 *   R7  held: with NO label rows every route above answers English and does not throw
 * WHAT IT CANNOT PROVE: Telegram's rendering, the real database, and whether the Korean / Chinese / Russian / Arabic is good. */
type Row = Record<string, unknown>;
const KEEP = '⁣';
const NOW = Date.now(); const DAY = 86_400_000; const iso = (ms: number) => new Date(ms).toISOString();
const PRO = { role: 'pro', trial_ends_at: null, current_period_end: iso(NOW + 30 * DAY) };
const LAPSED = { role: 'pro', trial_ends_at: null, current_period_end: iso(NOW - 5 * DAY) };

const sql = readFileSync(new URL('../../supabase/migrations/20261119z5_labels_telegram_language.sql', import.meta.url), 'utf8');
const prodSql = sql.slice(sql.indexOf('===================== PROD'), sql.indexOf('===================== DEV'));
const ROW = /\('([A-Za-z0-9_]+)','([a-z]{2})',(E?)'((?:[^']|'')*)'\)/g;
const labelRows: Array<{ key: string; locale: string; value: string }> = [];
const LAB: Record<string, Record<string, string>> = { en: {}, ko: {}, zh: {}, ru: {}, ar: {} };
for (const m of prodSql.matchAll(ROW)) { let v = m[4].replace(/''/g, "'"); if (m[3] === 'E') v = v.replace(/\\n/g, '\n'); labelRows.push({ key: m[1], locale: m[2], value: v }); LAB[m[2]][m[1]] = v; }

type Cap = { method: string; body: Record<string, unknown> };
async function scenario(users: Array<{ id: string; chat: string | null; lang?: string | null; sub?: Row; extra?: Row }>, o: { labels?: boolean; codes?: Row[] } = {}) {
  const w = makeWorld({ tables: {
    lhq_price_alerts: [], lhq_muted_alerts: [],
    lhq_user_subscriptions: users.map((u) => ({ user_id: u.id, ...(u.sub ?? PRO) })),
    lhq_user_settings: users.map((u) => ({ user_id: u.id, telegram_chat_id: u.chat, timezone: 'UTC', ...(u.lang === undefined ? {} : { language: u.lang }), ...(u.extra ?? {}) })),
    lhq_telegram_link_codes: o.codes ?? [],
    lhq_labels: o.labels === false ? [] : labelRows.map((r) => ({ ...r })),
  } }) as ReturnType<typeof makeWorld> & { patches: unknown[] };
  installControlsWorld(w);
  const inner = globalThis.fetch; const caps: Cap[] = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const u = new URL(String((input as { url?: string })?.url ?? input));
    if (u.host === 'api.telegram.org') caps.push({ method: u.pathname.split('/').pop() ?? '', body: init?.body ? JSON.parse(init.body) : {} });
    return inner(input as never, init as never);
  }) as typeof fetch;
  (await loadModule('lib/labelsServer.ts')).__labelsTestSeam();
  process.env.TELEGRAM_WEBHOOK_SECRET = 'harness-webhook-secret';
  const hook = await loadModule('app/api/telegram/webhook/route.ts');
  const { NextRequest } = await import('next/server.js');
  const post = async (payload: unknown) => {
    const res = await hook.POST(new NextRequest('http://localhost/api/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'harness-webhook-secret' }, body: JSON.stringify(payload) }));
    return res.status;
  };
  const say = async (chat: string, text: string) => {
    const before = caps.length; const status = await post({ update_id: 1, message: { chat: { id: Number(chat), type: 'private' }, text } });
    return { status, calls: caps.slice(before) };
  };
  const tap = async (chat: string, data: string) => {
    const before = caps.length; const status = await post({ update_id: 2, callback_query: { id: 'cb1', from: { id: 1 }, data, message: { message_id: 5, chat: { id: Number(chat), type: 'private' } } } });
    return { status, calls: caps.slice(before) };
  };
  const row = (id: string) => (w.tables.lhq_user_settings as Row[]).find((r) => r.user_id === id)!;
  return { w, say, tap, caps, row };
}
const text = (calls: Cap[]) => calls.filter((c) => c.method === 'sendMessage').map((c) => String(c.body.text));
const noMarker = (calls: Cap[]) => assert.ok(calls.every((c) => !JSON.stringify(c.body).includes(KEEP)), 'U+2063 reached Telegram');

const USERS = [
  { id: 'u-ko', chat: '1001', lang: 'ko' }, { id: 'u-zh', chat: '1002', lang: 'zh' }, { id: 'u-ru', chat: '1003', lang: 'ru' }, { id: 'u-ar', chat: '1004', lang: 'ar' },
  { id: 'u-en', chat: '1005', lang: 'en' }, { id: 'u-null', chat: '1006', lang: null }, { id: 'u-region', chat: '1007', lang: 'ko-KR' }, { id: 'u-ptbr', chat: '1008', lang: 'pt-BR' },
];
const LANG: Record<string, string> = { '1001': 'ko', '1002': 'zh', '1003': 'ru', '1004': 'en' /* ar: ENGLISH since PM 2026-11-18, head 2a18e5e6 */, '1005': 'en', '1006': 'en', '1007': 'en', '1008': 'en' };
const EN = { help: LAB.en.TG_BOT_HELP, paused: LAB.en.TG_BOT_PAUSED, resumed: LAB.en.TG_BOT_RESUMED };

test('R1. /help /pause /resume /status in the language of the linked account (ko zh ru); ar / en / none / ko-KR / pt-BR read English; tags fine; no marker', async () => {
  const { say } = await scenario(USERS);
  for (const chat of Object.keys(LANG)) {
    const lang = LANG[chat], L = LAB[lang];
    const help = await say(chat, '/help'), pause = await say(chat, '/pause'), status = await say(chat, '/status'), resume = await say(chat, '/resume'), unknown = await say(chat, '/frobnicate');
    for (const r of [help, pause, status, resume, unknown]) { assert.equal(r.status, 200); noMarker(r.calls); if (lang === 'en') assert.doesNotMatch(JSON.stringify(r.calls), /[؀-ۿ]/, `${chat}: Arabic text reached an English reader (ar is English)`); }
    assert.deepEqual(text(help.calls), [L.TG_BOT_HELP], `${chat} /help`);
    assert.deepEqual(text(unknown.calls), [L.TG_BOT_HELP], `${chat} unknown command gets the /help list`);
    assert.deepEqual(text(pause.calls), [L.TG_BOT_PAUSED], `${chat} /pause`);
    assert.deepEqual(text(resume.calls), [L.TG_BOT_RESUMED], `${chat} /resume`);
    const s = text(status.calls)[0];
    assert.ok(s.includes(L.TG_ST_CONNECTED) && s.includes(L.TG_ST_PLAN), `${chat} /status is not in ${lang}: ${s}`);
    assert.equal(s.split('\n').length, 4, `${chat} /status layout`);
    assert.ok(s.includes('Plan: ') === (lang === 'en'), `${chat} /status plan label language (${lang}): ${s}`);
  }
});

test('R2. /stop replies in the account\'s language (read BEFORE the unlink), the chat IS unlinked, and the next /status from it is English', async () => {
  const { say, row } = await scenario([{ id: 'u-ko', chat: '1001', lang: 'ko' }, { id: 'u-ru', chat: '1003', lang: 'ru' }]);
  const stop = await say('1001', '/stop');
  assert.deepEqual(text(stop.calls), [LAB.ko.TG_WH_DISCONNECTED], '/stop reply is not Korean');
  assert.equal(row('u-ko').telegram_chat_id, null, 'the chat was not unlinked'); assert.equal(row('u-ru').telegram_chat_id, '1003', 'another account was unlinked');
  const after = await say('1001', '/status');
  assert.deepEqual(text(after.calls), [LAB.en.TG_BOT_NOT_LINKED], 'an unlinked chat must read English (no account, no language)');
});

test('R3. an unlinked chat reads English; a valid link code: the Confirm question + button are in the language of the account the code belongs to', async () => {
  const codes = [{ code: 'KO1234', user_id: 'u-ko', used_at: null, expires_at: iso(NOW + 600_000) }, { code: 'EN1234', user_id: 'u-en', used_at: null, expires_at: iso(NOW + 600_000) }];
  const { say, caps } = await scenario([{ id: 'u-ko', chat: null, lang: 'ko' }, { id: 'u-en', chat: null, lang: 'en' }], { codes });
  assert.deepEqual(text((await say('5001', '/start')).calls)[0].includes('Welcome to'), true, 'welcome is English by design');
  assert.deepEqual(text((await say('5001', '/status')).calls), [LAB.en.TG_BOT_NOT_LINKED]);
  assert.match(text((await say('5001', '/start NOPE99')).calls)[0], /expired or was already used/);
  const ko = await say('5002', '/start KO1234'); const q = ko.calls.find((c) => c.method === 'sendMessage')!;
  assert.ok(String(q.body.text).includes(LAB.ko.TG_WH_CONNECT_Q) && String(q.body.text).includes(LAB.ko.TG_WH_CONNECT_WARN), `the question is not Korean: ${q.body.text}`);
  const btn = (q.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard[0][0];
  assert.equal(btn.text, LAB.ko.TG_WH_CONFIRM); assert.equal(btn.callback_data, 'link:KO1234', 'the callback data must not change');
  const en = await say('5003', '/start EN1234'); const qe = en.calls.find((c) => c.method === 'sendMessage')!;
  assert.match(String(qe.body.text), /Connect this chat to <b>/); assert.equal((qe.body.reply_markup as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard[0][0].text, 'Confirm');
  noMarker(caps);
});

test('R4. a Mute tap answers in the chat\'s language; the English chat gets the pre-PR English reply', async () => {
  for (const [chat, lang] of [['1001', 'ko'], ['1003', 'ru'], ['1004', 'en'], ['1005', 'en'], ['1007', 'en']] as const) {
    const { tap, row, caps } = await scenario(USERS);
    const r = await tap(chat, 'tmute:oi_spike:4'); assert.equal(r.status, 200); noMarker(caps);
    const ans = r.calls.find((c) => c.method === 'answerCallbackQuery')!; assert.ok(ans, `${chat}: the callback was not answered`);
    const want = lang === 'en' ? 'Open interest alerts muted for 4 h.' : LAB[lang].TG_MUTED_FOR.replace('{type}', LAB[lang].TG_TYPE_OI).replace('{h}', '4');
    assert.equal(ans.body.text, want, `${chat} (${lang}) mute reply`);
    assert.ok(row(USERS.find((u) => u.chat === chat)!.id).alert_type_mutes, `${chat}: the mute was not stored`);
  }
});

test('R5. test alert: in the account language (ko), English for ar / en / none / ko-KR', async () => {
  const results: Record<string, string> = {};
  for (const [user, lang] of [['u-ko', 'ko'], ['u-ar', 'en'], ['u-en', 'en'], ['u-null', 'en'], ['u-region', 'en']] as const) {
    const s = await scenario(USERS);
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: { headers?: unknown }) => {
      const u = new URL(String((input as { url?: string })?.url ?? input));
      if (u.host === 'stub.supabase.test' && u.pathname === '/auth/v1/user') return new Response(JSON.stringify({ id: user, email: `${user}@example.test`, aud: 'authenticated', role: 'authenticated' }), { status: 200, headers: { 'content-type': 'application/json' } });
      return inner(input as never, init as never);
    }) as typeof fetch;
    (globalThis as { __lhqRateLimit?: { buckets: Map<string, unknown> } }).__lhqRateLimit?.buckets.clear();
    const mod = await loadModule('app/api/telegram/test-alert/route.ts'); const { NextRequest } = await import('next/server.js');
    const res = await mod.POST(new NextRequest('http://localhost/api/telegram/test-alert', { method: 'POST', headers: { authorization: 'Bearer tok' } }));
    assert.equal(res.status, 200, `${user}: ${res.status}`);
    const t = String(s.caps.filter((c) => c.method === 'sendMessage').pop()?.body.text); results[user] = t;
    assert.ok(!t.includes(KEEP));
    if (lang === 'en') assert.match(t, /^🔔 <b>Test alert<\/b>\n\nThis is a test from LiquidityHQ\. Your alerts arrive in this chat\.\n\n<i>⏰ /, `${user} English text changed`);
    else { assert.ok(t.includes(LAB[lang].TG_TEST_TITLE) && t.includes(LAB[lang].TG_TEST_BODY), `${user}: not in ${lang}: ${t}`); assert.ok(/<b>.*<\/b>/.test(t) && /<i>⏰ /.test(t), `${user}: tags or stamp lost: ${t}`); }
    globalThis.fetch = inner;
  }
});

test('R6. plan-ended notice: in the account language (zh, ru), English for none; one notice per lapse', async () => {
  const settle = () => new Promise((r) => setTimeout(r, 400));
  const { w } = await scenario([{ id: 'u-hold', chat: '9001', sub: PRO, extra: { alert_paused: true } }, { id: 'u-zh', chat: '1002', lang: 'zh', sub: LAPSED }, { id: 'u-null', chat: '1006', lang: null, sub: LAPSED }, { id: 'u-ru', chat: '1003', lang: 'ru', sub: { role: 'free', trial_ends_at: iso(NOW - 5 * DAY), current_period_end: null } }]);
  const route = await loadRoute(); for (let i = 0; i < 2; i++) { await route.run(); await settle(); }
  const to = (chat: string) => (w.telegram.sent as Array<{ chat_id: string; text: string }>).filter((m) => m.chat_id === chat).map((m) => m.text);
  assert.equal(to('1002').length, 1, 'one notice per lapse'); assert.equal(to('1006').length, 1); assert.equal(to('1003').length, 1);
  assert.ok(to('1002')[0].includes(LAB.zh.TG_PLAN_ENDED_PRO) && to('1002')[0].includes(LAB.zh.TG_PLAN_UPGRADE), `zh notice: ${to('1002')[0]}`);
  assert.ok(to('1003')[0].includes(LAB.ru.TG_PLAN_ENDED_TRIAL), `ru trial notice: ${to('1003')[0]}`);
  assert.match(to('1006')[0], /^Your Pro plan has ended, so Telegram alerts are paused\.\nUpgrade to turn them back on: /, 'no saved language must read English');
  assert.ok(!to('1002')[0].includes(KEEP));
});

test('R7. held: with NO label rows every route answers English and does not throw', async () => {
  const { say, tap, row } = await scenario(USERS, { labels: false });
  for (const chat of ['1001', '1003', '1004']) {
    const h = await say(chat, '/help'); assert.equal(h.status, 200); assert.deepEqual(text(h.calls), [LAB.en.TG_BOT_HELP], `${chat}`);
    const s = await say(chat, '/status'); assert.match(text(s.calls)[0], /^<b>Connected<\/b>\nAlerts: on\nQuiet hours: off\nPlan: Pro$/);
    const t = await tap(chat, 'tmute:cvd:1'); assert.equal(t.calls.find((c) => c.method === 'answerCallbackQuery')!.body.text, 'CVD divergence alerts muted for 1 h.');
  }
  void row;
});
