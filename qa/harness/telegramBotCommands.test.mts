import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installControlsWorld } from '../telegramControlsWorld.mjs';
import { loadModule } from '../telegramWorld.mjs';

/* QA's cells for #2567 (bot commands), the REAL /api/telegram/webhook handler in-process, a fake network and fake database, nothing leaves the machine.
 *   B1  /status of a linked chat: plan, alerts on / paused / snoozed, quiet hours (window and zone); Free and trial and a lapsed Pro read right
 *   B2  /status from an unlinked chat says how to connect and discloses nothing about any account (no id, plan, zone)
 *   B3  /pause and /resume change ONLY the account linked to THIS chat; a second /pause changes nothing more; /resume clears the pause and a snooze but keeps quiet hours
 *   B4  /help lists the commands, in English, no AI vendor or model name
 *   B5  an unknown command, "/startfoo" and plain private text get /help and link nothing; plain talk in a group is not answered
 *   B6  /stop still unlinks, and the chat is then "not connected" for /status
 *   B7  a group cannot link (/start CODE) and cannot pause or resume any account
 *   B8  every reply: no NaN / undefined / null, 40 words or fewer, no advice words
 *   B9  the columns missing (migration q not applied): /status and /pause fail CLEARLY ("could not ...") and change nothing
 *   B10 an invalid stored timezone, a null timezone, equal quiet start and end: no crash, honest text
 * WHAT IT CANNOT PROVE: a real Telegram delivery, the real database's column grants, the bot's rendering of the HTML. */
type Row = Record<string, unknown>;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const PRO = { role: 'pro', trial_ends_at: null, current_period_end: iso(NOW + 30 * 86_400_000) };
const TRIAL = { role: 'free', trial_ends_at: iso(NOW + 5 * 86_400_000), current_period_end: null };
const FREE = { role: 'free', trial_ends_at: null, current_period_end: null };
const LAPSED_PRO = { role: 'pro', trial_ends_at: null, current_period_end: iso(NOW - 10 * 86_400_000) };
let chatSeq = 7000;
async function scenario(users: Array<Row & { id: string; chat: string | null; sub?: Row }> = []) {
  const list = users.length ? users : [{ id: 'u-a', chat: '1001', timezone: 'Asia/Manila', sub: PRO }, { id: 'u-b', chat: '2002', timezone: 'Europe/London', sub: PRO }];
  const w = makeWorld({ tables: {
    lhq_user_subscriptions: list.map((u) => ({ user_id: u.id, ...(u.sub ?? PRO) })),
    lhq_user_settings: list.map((u) => { const { id, chat, sub, ...rest } = u; return { user_id: id, telegram_chat_id: chat, timezone: 'UTC', ...rest }; }),
    lhq_telegram_link_codes: [],
  } }) as ReturnType<typeof makeWorld> & { patches: Array<{ table: string; query: string; body: Row; hit: number }>; failTable: Record<string, string>; missingColumns: Record<string, string[]> };
  installControlsWorld(w);
  process.env.TELEGRAM_WEBHOOK_SECRET = 'harness-webhook-secret';
  const mod = await loadModule('app/api/telegram/webhook/route.ts');
  const { NextRequest } = await import('next/server.js');
  const post = async (chat: string, text: string, type: 'private' | 'group' | 'supergroup' | undefined = 'private') => {
    const before = w.telegram.sent.length;
    const res = await mod.POST(new NextRequest('http://localhost/api/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'harness-webhook-secret' }, body: JSON.stringify({ message: { chat: { id: Number(chat), ...(type ? { type } : {}) }, text } }) }));
    const replies = w.telegram.sent.slice(before).map((m: { text: string }) => m.text);
    return { status: res.status, replies, reply: replies[0] as string | undefined };
  };
  const row = (id: string) => (w.tables.lhq_user_settings as Row[]).find((r) => r.user_id === id)!;
  return { w, post, row };
}
const plain = (s: string) => s.replace(/<[^>]*>/g, '');

test('B1a. /status of a linked Pro chat: Connected, Alerts on, Quiet hours off, Plan Pro', async () => {
  const { post } = await scenario(); const r = await post('1001', '/status');
  assert.equal(r.status, 200); assert.match(r.reply!, /Connected/); assert.match(r.reply!, /Alerts: on/); assert.match(r.reply!, /Quiet hours: off/); assert.match(r.reply!, /Plan: Pro$/m);
});
test('B1b. /status shows paused, snoozed (in the account timezone), quiet window with its zone, trial, Free and a lapsed Pro', async () => {
  const until = NOW + 3 * 3_600_000;
  const { post } = await scenario([
    { id: 'u-pause', chat: '3001', timezone: 'Asia/Manila', sub: PRO, alert_paused: true },
    { id: 'u-snooze', chat: '3002', timezone: 'Asia/Manila', sub: PRO, alert_snooze_until: iso(until) },
    { id: 'u-quiet', chat: '3003', timezone: 'America/New_York', sub: TRIAL, alert_quiet_start: 22, alert_quiet_end: 7 },
    { id: 'u-free', chat: '3004', timezone: 'UTC', sub: FREE },
    { id: 'u-lapsed', chat: '3005', timezone: 'UTC', sub: LAPSED_PRO },
    { id: 'u-both', chat: '3006', timezone: 'UTC', sub: PRO, alert_paused: true, alert_snooze_until: iso(until) },
  ]);
  const t = async (c: string) => (await post(c, '/status')).reply!;
  assert.match(await t('3001'), /Alerts: paused \(send \/resume\)/);
  const sn = await t('3002'); assert.match(sn, /Alerts: snoozed until \w{3},? \d\d:\d\d \(Asia\/Manila\)/, sn);
  const manila = new Date(until).toLocaleString('en-GB', { timeZone: 'Asia/Manila', weekday: 'short', hour: '2-digit', minute: '2-digit' }); assert.ok(sn.includes(manila), `the snooze end is not shown in the account's own zone: ${sn} vs ${manila}`);
  const q = await t('3003'); assert.match(q, /Quiet hours: 22:00-07:00 \(America\/New_York\)/); assert.match(q, /Plan: Pro trial/);
  assert.match(await t('3004'), /Plan: Free \(Telegram alerts need Pro\)/);
  assert.match(await t('3005'), /Plan: Free/, 'a Pro whose period ended 10 days ago (past the 48 h grace) must read Free');
  assert.match(await t('3006'), /Alerts: paused/, 'paused must win over a snooze');
});
test('B2. /status, /pause and /resume from an UNLINKED chat say how to connect and disclose nothing about any account', async () => {
  const { post, w } = await scenario();
  for (const cmd of ['/status', '/pause', '/resume']) {
    const r = await post('9999', cmd); assert.equal(r.reply, 'This chat is not connected. Open Alerts in the app and press Connect Telegram.', `${cmd}: ${r.reply}`);
    for (const leak of ['u-a', 'u-b', 'Manila', 'London', 'Pro', 'Free', 'Quiet', '1001', '2002']) assert.equal(String(r.reply).includes(leak), false, `${cmd} leaked "${leak}"`);
  }
  assert.deepEqual((w.writes as Array<{ method: string; body: Row }>).filter((x) => x.method === 'PATCH' && ('alert_paused' in x.body)).length, 2, 'CONTROL: /pause and /resume did try a write (that matched nothing)');
  assert.equal((w.tables.lhq_user_settings as Row[]).some((r) => r.alert_paused === true), false, 'an unlinked chat paused somebody');
});
test('B3. /pause and /resume act ONLY on the account of THIS chat; repeated /pause is harmless; /resume clears pause and snooze but keeps quiet hours', async () => {
  const { post, row } = await scenario([{ id: 'u-a', chat: '1001', timezone: 'UTC', sub: PRO, alert_quiet_start: 22, alert_quiet_end: 7, alert_snooze_until: iso(NOW + 3_600_000) }, { id: 'u-b', chat: '2002', timezone: 'UTC', sub: PRO }]);
  const p1 = await post('1001', '/pause'); assert.match(p1.reply!, /Alerts paused/); assert.equal(row('u-a').alert_paused, true); assert.equal(row('u-b').alert_paused, undefined, 'B was paused by A');
  const p2 = await post('1001', '/pause'); assert.match(p2.reply!, /Alerts paused/); assert.equal(row('u-a').alert_paused, true);
  const r1 = await post('1001', '/resume'); assert.match(r1.reply!, /Alerts are on/); assert.equal(row('u-a').alert_paused, false); assert.equal(row('u-a').alert_snooze_until, null, 'resume left the snooze');
  assert.equal(row('u-a').alert_quiet_start, 22, 'resume cleared quiet hours'); assert.equal(row('u-a').alert_quiet_end, 7);
  const r2 = await post('1001', '/resume'); assert.match(r2.reply!, /Alerts are on/);
  await post('2002', '/pause'); assert.equal(row('u-b').alert_paused, true); assert.equal(row('u-a').alert_paused, false, 'B paused A');
});
test('B3b. command forms: /PAUSE, /pause@BotName, /pause with trailing text and a newline all work; /pausex and /paused do NOT pause', async () => {
  const { post, row } = await scenario();
  for (const form of ['/PAUSE', '/pause@LiquidityHQ_bot', '/pause now', '/pause\nplease']) { await post('1001', '/resume'); await post('1001', form); assert.equal(row('u-a').alert_paused, true, `${JSON.stringify(form)} did not pause`); }
  await post('1001', '/resume');
  for (const form of ['/pausex', '/paused', 'pause', 'please /pause', '/pause_all']) { const r = await post('1001', form); assert.notEqual(row('u-a').alert_paused, true, `${JSON.stringify(form)} paused`); assert.match(r.reply ?? '', /Commands:/, `${JSON.stringify(form)}: ${r.reply}`); }
});
test('B4. /help lists /status /pause /resume /stop /help, in English, with no AI vendor or model name', async () => {
  const { post } = await scenario(); const r = await post('1001', '/help');
  for (const c of ['/status', '/pause', '/resume', '/stop', '/help']) assert.ok(r.reply!.includes(c), `/help does not list ${c}`);
  assert.doesNotMatch(r.reply!, /claude|anthropic|openai|gpt|gemini|grok|xai|llama|mistral|deepseek|chatgpt/i); assert.match(r.reply!, /^Commands:/); assert.ok(/^[\x20-\x7E\n]+$/.test(r.reply!), 'non-ASCII (non-English?) text in /help');
});
test('B5. an unknown command, "/startfoo" and plain private text get /help, link nothing and look no code up; plain talk in a group is not answered, an unknown /command in a group gets /help', async () => {
  const { post, w } = await scenario(); (w.tables.lhq_telegram_link_codes as Row[]).push({ code: 'ABC123', user_id: 'u-a', used_at: null, expires_at: iso(NOW + 3_600_000) });
  for (const t of ['/foo', '/startfoo ABC123', '/starting', 'hello', 'what is btc doing']) { const r = await post('5555', t); assert.match(r.reply ?? '', /^Commands:/, `${JSON.stringify(t)} -> ${r.reply}`); assert.equal(r.replies.length, 1); }
  assert.equal((w.tables.lhq_user_settings as Row[]).some((r) => r.telegram_chat_id === '5555'), false, 'a chat was linked by /startfoo');
  assert.equal(w.log.some((l: string) => /telegram_link_codes/.test(l)), false, 'a link code was looked up for /startfoo');
  const g = await post('-100200', 'hello everyone', 'group'); assert.equal(g.replies.length, 0, 'the bot answered ordinary group talk');
  const g2 = await post('-100200', '/foo', 'group'); assert.match(g2.reply ?? '', /^Commands:/);
  const none = await post('5556', 'hi', undefined); assert.match(none.reply ?? '', /^Commands:/, 'a chat with no type is treated as private (documented)');
});
test('B6. /stop still unlinks this chat (and only it), then /status says not connected', async () => {
  const { post, row } = await scenario(); const r = await post('1001', '/stop'); assert.match(r.reply!, /Disconnected/);
  assert.equal(row('u-a').telegram_chat_id, null); assert.equal(row('u-b').telegram_chat_id, '2002', 'B was unlinked by A');
  assert.match((await post('1001', '/status')).reply!, /not connected/); assert.match((await post('1001', '/stop@LiquidityHQ_bot')).reply!, /Disconnected/);
});
test('B7. a group cannot link (/start CODE) and cannot pause or resume an account', async () => {
  const { post, w, row } = await scenario(); (w.tables.lhq_telegram_link_codes as Row[]).push({ code: 'ABC123', user_id: 'u-a', used_at: null, expires_at: iso(NOW + 3_600_000) });
  for (const type of ['group', 'supergroup'] as const) {
    const s = await post('-100300', '/start ABC123', type); assert.match(s.reply!, /private chat/i); assert.equal(w.telegram.sent.at(-1)?.text.includes('Confirm'), false);
    for (const c of ['/pause', '/resume', '/status']) { const r = await post('-100300', c, type); assert.match(r.reply!, /not connected/, `${type} ${c}: ${r.reply}`); }
  }
  assert.equal(row('u-a').alert_paused, undefined); assert.equal(row('u-b').alert_paused, undefined); assert.equal((w.tables.lhq_user_settings as Row[]).some((r) => r.telegram_chat_id === '-100300'), false);
  assert.equal((w.tables.lhq_telegram_link_codes as Row[])[0].used_at, null, 'the code was spent');
});
test('B8. every reply: no NaN/undefined/null, 40 words or fewer, no advice words (statuses in every state, resume, pause, help, not-linked, errors)', async () => {
  const { post, w } = await scenario([
    { id: 'u-1', chat: '4001', timezone: 'Asia/Manila', sub: PRO, alert_paused: true, alert_quiet_start: 22, alert_quiet_end: 7 },
    { id: 'u-2', chat: '4002', timezone: 'Pacific/Kiritimati', sub: TRIAL, alert_snooze_until: iso(NOW + 4 * 3_600_000), alert_quiet_start: 0, alert_quiet_end: 23 },
    { id: 'u-3', chat: '4003', timezone: null, sub: FREE },
    { id: 'u-4', chat: '4004', timezone: 'Not/AZone', sub: PRO, alert_quiet_start: 9, alert_quiet_end: 17 },
  ]);
  const all: string[] = [];
  for (const c of ['4001', '4002', '4003', '4004', '9999']) for (const cmd of ['/status', '/pause', '/resume', '/help', '/foo', '/status']) all.push(...(await post(c, cmd)).replies);
  w.missingColumns.lhq_user_settings = ['alert_paused', 'alert_quiet_start']; for (const cmd of ['/status', '/pause']) all.push(...(await post('4001', cmd)).replies);
  assert.ok(all.length >= 30, `CONTROL: only ${all.length} replies`);
  for (const t of all) { const p = plain(t); assert.doesNotMatch(p, /\bNaN\b|undefined|\bnull\b|\[object/i, `bad token in: ${t}`); const words = p.trim().split(/\s+/).length; if (!/^Commands:/.test(p)) assert.ok(words <= 40, `${words} words: ${t}`); assert.doesNotMatch(p, /\b(buy|sell|should|recommend|guarantee|profit|invest(ment)?|advice|signal to)\b/i, `advice word in: ${t}`); }
  const help = all.find((t) => /^Commands:/.test(t))!; assert.ok(plain(help).trim().split(/\s+/).length <= 40, `/help is ${plain(help).trim().split(/\s+/).length} words`);
});
test('B9. migration q not applied: /status says "Could not read", /pause says "Could not save" and changes nothing; a failing table says the same; /help still works', async () => {
  const { post, w, row } = await scenario(); w.missingColumns.lhq_user_settings = ['alert_paused', 'alert_snooze_until', 'alert_quiet_start', 'alert_quiet_end'];
  assert.match((await post('1001', '/status')).reply!, /Could not read your settings\. Try again\./); const p = await post('1001', '/pause'); assert.match(p.reply!, /Could not save that\. Try again\./); assert.equal(row('u-a').alert_paused, undefined);
  assert.match((await post('1001', '/help')).reply!, /^Commands:/);
  delete w.missingColumns.lhq_user_settings; w.failTable.lhq_user_subscriptions = 'GET'; assert.match((await post('1001', '/status')).reply!, /Could not read your settings/); delete w.failTable.lhq_user_subscriptions;
  w.missingColumns.lhq_user_settings = ['alert_paused']; assert.match((await post('1001', '/stop')).reply!, /Disconnected/, '/stop must not depend on the new columns'); assert.equal(row('u-a').telegram_chat_id, null);
});
test('B10. odd settings: an invalid stored timezone, a null timezone and equal start/end do not crash and read honestly', async () => {
  const until = NOW + 2 * 3_600_000;
  const { post } = await scenario([
    { id: 'u-bad', chat: '6001', timezone: 'Not/AZone', sub: PRO, alert_snooze_until: iso(until), alert_quiet_start: 5, alert_quiet_end: 5 },
    { id: 'u-nulltz', chat: '6002', timezone: null, sub: PRO, alert_quiet_start: 1, alert_quiet_end: 7 },
    { id: 'u-html', chat: '6003', timezone: '<b>x</b>&', sub: PRO, alert_quiet_start: 1, alert_quiet_end: 7 },
    { id: 'u-badnum', chat: '6004', timezone: 'UTC', sub: PRO, alert_quiet_start: 24, alert_quiet_end: 3 },
  ]);
  const bad = (await post('6001', '/status')).reply!; assert.match(bad, /snoozed until \d{4}-\d\d-\d\d \d\d:\d\d UTC/, `invalid zone snooze: ${bad}`); assert.match(bad, /Quiet hours: off/, 'start == end is "no quiet hours"');
  assert.match((await post('6002', '/status')).reply!, /Quiet hours: 01:00-07:00 \(UTC\)/);
  const h = (await post('6003', '/status')).reply!; assert.ok(!h.includes('<b>x</b>'), `an unescaped zone reached the HTML: ${h}`); assert.ok(h.includes('&lt;b&gt;x&lt;/b&gt;&amp;'));
  assert.match((await post('6004', '/status')).reply!, /Quiet hours: off/, 'an out-of-range stored hour must read as off');
});
test('B11. FINDING: a lapsed (Free) account must not be told "Alerts are on" by /resume or "Alerts: on" by /status, because the cron sends it nothing', async () => {
  const { post } = await scenario([{ id: 'u-free', chat: '4100', timezone: 'UTC', sub: FREE, alert_paused: true }]);
  const r = await post('4100', '/resume'); const s = await post('4100', '/status');
  assert.doesNotMatch(r.reply!, /Alerts are on/, `/resume to a Free account: ${r.reply}`); assert.doesNotMatch(s.reply!, /Alerts: on/, `/status to a Free account: ${s.reply}`);
});
