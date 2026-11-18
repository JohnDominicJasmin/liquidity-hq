import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { makeWorld, installFakeFetch, loadRoute, loadModule } from '../telegramWorld.mjs';

/* QA's cells for PR #2574 (Telegram "Mute 1 h / Mute 4 h" under OI, CVD and rapid-move alerts). The REAL webhook route and the REAL alert route, in-process, a fake Supabase and a fake Telegram (qa/telegramWorld.mjs): nothing leaves the machine.
 * The callback_data a button carries is `tmute:<ruleKey>:<hours>` (hours 1 or 4), not "mute:oi:1h".
 *   W1  a tap from a LINKED chat mutes ONLY that chat's account, for exactly 1 h / 4 h (clock moved by hand), the callback is answered, nothing else is written (the /alerts switches, other users)
 *   W2  hostile data / chats are no-ops: nothing written, still answered, always 200, never a throw
 *   W3  replay: the same tap again restarts the hour (extends); a 1 h tap after a 4 h one SHORTENS it (STATED, not asserted as right)
 *   W4  the column missing (migration not applied yet): the tap answers "Could not mute", nothing breaks; the database failing does the same
 *   C1  cron: during a short mute that user gets no alert of THAT type, another user still does, the user's other types still arrive; after expiry it resumes
 *   C2  cron: a short mute never un-mutes a permanent mute (union), and writes nothing to the /alerts mute table
 *   C3  Web Push shares the decision (source pin: the merge runs before dispatchPush, which decides through isEligibleFor on the same map)
 *   D1-D4  OI alert direction: price up = long, price down = short, flat / NaN / no candles = none; the Long / Short signals mutes silence OI, CVD and rapid-move of that direction and never the opposite
 *   B1-B3  the buttons: exactly two on a single OI / CVD / rapid alert with the right labels and data, none on RSI or price alerts, the text unchanged
 * WHAT IT CANNOT PROVE: Telegram's real rendering of the keyboard, the /alerts page line (browser cell), or the SQL grants (migrationsSqlShape + a read of the file). */

type World = ReturnType<typeof makeWorld> & { markups: Array<{ chat_id: string; text: string; reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }>; tgCalls: Array<{ method: string; body: Record<string, unknown> }>; oi?: 'up' | 'down'; cvd?: 'bear' | 'bull'; dbMode?: 'ok' | 'nocolumn' | 'fail' };
const PRO = { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() };
const H = 3_600_000;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

/* The clock is moved by hand: both the webhook (applyTypeMuteTap) and the cron read Date.now(). */
const realNow = Date.now; let base = 0, since = 0, frozen = true;
const setNow = (ms: number, tick = false) => { base = ms; since = realNow(); frozen = !tick; Date.now = () => frozen ? base : base + (realNow() - since); };   /* frozen: the same instant for every read in a step (webhook cells); tick: starts at ms and runs (the cron has its own time budget) */
const resetNow = () => { Date.now = realNow; };
const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);

type U = { id: string; chat: string };
function layers(w: World) {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: string }) => {
    const u = new URL(String((input as { url?: string })?.url ?? input));
    if (u.host === 'api.telegram.org') {
      const method = u.pathname.split('/').pop()!; const b = init?.body ? JSON.parse(init.body) : {};
      if (method === 'sendMessage') w.markups.push({ chat_id: String(b.chat_id), text: b.text, reply_markup: b.reply_markup });
      else { w.tgCalls.push({ method, body: b }); return json({ ok: true, result: true }); }
    }
    if (u.host === 'stub.supabase.test' && u.pathname === '/rest/v1/lhq_user_settings') {
      const touches = u.search.includes('alert_type_mutes') || String(init?.body ?? '').includes('alert_type_mutes');
      if (w.dbMode === 'nocolumn' && touches) return json({ code: '42703', message: 'column lhq_user_settings.alert_type_mutes does not exist', details: null, hint: null }, 400);
      if (w.dbMode === 'fail') return json({ message: 'db down' }, 500);
    }
    if (u.host === 'api.bybit.com' && u.pathname === '/v5/market/open-interest' && u.searchParams.get('symbol') === 'BTCUSDT' && w.oi) {
      const n = 13; const list = Array.from({ length: n }, (_, i) => ({ openInterest: String(w.oi === 'up' ? 120_000 - i * (20_000 / 12) : 100_000 + i * (20_000 / 12)), timestamp: String(Date.now() - i * 300_000) }));
      return json({ retCode: 0, result: { list } });
    }
    if (u.host === 'api.binance.com' && u.pathname === '/api/v3/klines' && u.searchParams.get('symbol') === 'BTCUSDT' && w.cvd) {
      const [a, b] = w.cvd === 'bear' ? [100, 102] : [100, 98];   // bearish divergence = price UP with sellers; bullish = price DOWN with buyers
      return json([[0, '1', '1', '1', String(a), '1'], [0, '1', '1', '1', String(b), '1']]);
    }
    if (u.host === 'fapi.binance.com' && u.pathname === '/futures/data/takerlongshortRatio' && u.searchParams.get('symbol') === 'BTCUSDT' && w.cvd) {
      return json(Array.from({ length: 12 }, (_, i) => ({ buyVol: w.cvd === 'bear' ? '10' : '50', sellVol: w.cvd === 'bear' ? '50' : '10', timestamp: i })));
    }
    return inner(input as never, init as never);
  }) as typeof fetch;
}

const flat = (n = 60, v = 100) => Array.from({ length: n }, () => v);
const slope = (n: number, step: number) => Array.from({ length: n }, (_, i) => 100 + i * step);
async function world(o: { users?: U[]; muted?: Array<{ user_id: string; key: string }>; settings?: Record<string, Record<string, unknown>>; series5?: number[] | null; noKlines?: boolean; oi?: 'up' | 'down'; cvd?: 'bear' | 'bull'; rsi?: boolean; alerts?: unknown[]; dbMode?: 'ok' | 'nocolumn' | 'fail' } = {}) {
  const users = o.users ?? [{ id: 'u-a', chat: '1001' }, { id: 'u-b', chat: '2002' }];
  const tables: Record<string, unknown[]> = {
    lhq_price_alerts: o.alerts ?? [], lhq_muted_alerts: o.muted ?? [],
    lhq_user_subscriptions: users.map(u => ({ user_id: u.id, ...PRO })),
    lhq_user_settings: users.map(u => ({ user_id: u.id, telegram_chat_id: u.chat, timezone: 'UTC', ...(o.settings?.[u.id] ?? {}) })),
  };
  const w = makeWorld({ tables }) as World; w.markups = []; w.tgCalls = []; w.oi = o.oi; w.cvd = o.cvd; w.dbMode = o.dbMode ?? 'ok'; w.noKlines = o.noKlines as never;
  w.series = {}; if (o.series5) w.series['BTCUSDT:5'] = o.series5; if (o.rsi) w.series['BTCUSDT:60'] = slope(300, 1);
  installFakeFetch(w); layers(w);
  process.env.TELEGRAM_WEBHOOK_SECRET = 'qa-hook-secret';
  const cron = await loadRoute(); const hook = await loadModule('app/api/telegram/webhook/route.ts');
  const { NextRequest } = await import('next/server.js');
  const tap = async (chatId: number | null, data: unknown, extra: { chatType?: string; noMessage?: boolean; id?: string } = {}) => {
    const cb: Record<string, unknown> = { id: extra.id ?? `cb-${w.tgCalls.length + 1}`, from: { id: 1001 }, data };
    if (!extra.noMessage) cb.message = { message_id: 7, chat: { id: chatId, type: extra.chatType ?? 'private' } };
    const res = await hook.POST(new NextRequest('http://localhost/api/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'qa-hook-secret' }, body: JSON.stringify({ update_id: 1, callback_query: cb }) }));
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const settingsWrites = () => w.writes.filter(x => x.table === 'lhq_user_settings');
  const row = (id: string) => (w.tables.lhq_user_settings as Array<Record<string, unknown>>).find(r => r.user_id === id)!;
  return { w, run: () => cron.run() as Promise<{ status: number; body: Record<string, unknown> | null }>, tap, settingsWrites, row };
}
const mine = (w: World, chat: string) => w.markups.filter(m => m.chat_id === chat);
const has = (w: World, chat: string, re: RegExp) => mine(w, chat).some(m => re.test(m.text));
const OI = /Open Interest (Spike|Drop)/, CVD = /CVD Divergence/, RAPID = /Rapid (Pump|Dump)/;
const iso = (ms: number) => new Date(ms).toISOString();
const answered = (w: World) => w.tgCalls.filter(c => c.method === 'answerCallbackQuery');

/* ───────── W: the webhook ───────── */
test('W1. a tap from a linked chat mutes ONLY that chat\'s account, for exactly 1 h / 4 h, and the callback is answered; nothing else is written', async () => {
  setNow(T0);
  try {
    const { w, tap, settingsWrites, row } = await world({ muted: [{ user_id: 'u-a', key: 'rsi' }] });
    const mutedBefore = JSON.stringify(w.tables.lhq_muted_alerts);
    const r1 = await tap(1001, 'tmute:oi_spike:1', { id: 'cb-A' });
    assert.equal(r1.status, 200);
    assert.deepEqual(row('u-a').alert_type_mutes, { oi_spike: iso(T0 + H) }, '1 h exactly, for the tapping chat\'s account');
    assert.equal('alert_type_mutes' in row('u-b'), false, 'the OTHER account was touched');
    assert.equal(answered(w).length, 1, 'the button would keep spinning'); assert.equal(answered(w)[0].body.callback_query_id, 'cb-A'); assert.equal(answered(w)[0].body.text, 'Open interest alerts muted for 1 h.');
    const r2 = await tap(1001, 'tmute:cvd:4'); assert.equal(r2.status, 200);
    assert.deepEqual(row('u-a').alert_type_mutes, { oi_spike: iso(T0 + H), cvd: iso(T0 + 4 * H) }, 'a second type adds; the first is kept');
    await tap(1001, 'tmute:rapid_move:4'); assert.equal((row('u-a').alert_type_mutes as Record<string, string>).rapid_move, iso(T0 + 4 * H));
    assert.equal(JSON.stringify(w.tables.lhq_muted_alerts), mutedBefore, 'the /alerts mute table changed');
    assert.deepEqual(w.writes.filter(x => x.table !== 'lhq_user_settings'), [], 'something other than user_settings was written');
    assert.ok(settingsWrites().every(x => x.method === 'PATCH' && Object.keys(x.body as object).join() === 'alert_type_mutes' && /user_id=eq\.u-a/.test(x.query) && /telegram_chat_id=eq\.1001/.test(x.query)), 'a write touched more than alert_type_mutes of u-a: ' + JSON.stringify(settingsWrites()));
    assert.equal(row('u-a').telegram_chat_id, '1001'); assert.equal(row('u-a').timezone, 'UTC');
  } finally { resetNow(); }
});

test('W2. hostile data and chats are no-ops: nothing written, no mute for anyone, still answered, always 200', async () => {
  setNow(T0);
  try {
    const { w, tap, settingsWrites } = await world();
    const hostile: unknown[] = ['tmute:foo:1', 'tmute:oi_spike:0', 'tmute:oi_spike:-1', 'tmute:oi_spike:99999', 'tmute:oi_spike:NaN', 'tmute:oi_spike:1h', 'tmute:oi_spike:1; drop', 'tmute:oi_spike:1' + 'x'.repeat(5000), 'tmute:', 'tmute:rsi:4', 'tmute:oi_spike:1:u-b', 'tmute:oi_spike:1:2002', 'mute:oi_spike:1', 'TMUTE:oi_spike:1', '', undefined, null];
    let n = 0;
    for (const d of hostile) { const r = await tap(1001, d); n++; assert.equal(r.status, 200, `data ${JSON.stringify(d)?.slice(0, 40)}`); }
    assert.deepEqual(settingsWrites(), [], 'a hostile callback wrote something'); assert.equal(w.writes.length, 0);
    assert.equal(answered(w).length, n, 'every callback must be answered (or the button spins)'); assert.ok(answered(w).every(c => c.body.text === undefined), 'a refused tap must not claim a mute');
    for (const r of w.tables.lhq_user_settings as Array<Record<string, unknown>>) assert.equal('alert_type_mutes' in r, false);
    for (const d of [5, {}, ['tmute:oi_spike:1']]) assert.equal((await tap(1001, d)).status, 200, 'non-string data: the route must still answer 200 (it logs in handleConfirm, an existing path, and does not answer the callback; Telegram never sends non-string data)');
    assert.deepEqual(settingsWrites(), []);
    // other chats: unlinked private chat, an unlinked group / supergroup, a chat id forged to be the other user's inside the DATA, no message at all
    const before = answered(w).length;
    for (const [id, type] of [[9999, 'private'], [-100123456, 'supergroup'], [-5555, 'group']] as const) { const r = await tap(id, 'tmute:oi_spike:1', { chatType: type }); assert.equal(r.status, 200); }
    assert.equal((await tap(1001, 'tmute:oi_spike:1:2002')).status, 200);
    assert.equal((await tap(null, 'tmute:oi_spike:1', { noMessage: true })).status, 200);
    assert.deepEqual(settingsWrites(), [], 'an unlinked chat, a group, a forged chat id or a message-less callback wrote something');
    assert.equal(answered(w).length - before, 5, 'those five were answered too'); assert.equal(answered(w).slice(before).every(c => c.body.text === undefined), true);
    // a callback_data copied from another chat's message: the chat of the BUTTON decides, never the data
    const w2 = await world(); await w2.tap(2002, 'tmute:cvd:1'); // u-b taps a button whose data was copied from u-a's message: it mutes u-b only
    assert.equal('alert_type_mutes' in w2.row('u-a'), false, 'u-a was muted by u-b\'s tap'); assert.deepEqual(w2.row('u-b').alert_type_mutes, { cvd: iso(T0 + H) });
  } finally { resetNow(); }
});

test('W3. replay: the same tap restarts the hour (extends); a 1 h tap after a 4 h one shortens it (stated); an expired entry is dropped', async () => {
  try {
    setNow(T0); const { tap, row } = await world();
    await tap(1001, 'tmute:cvd:1'); assert.equal((row('u-a').alert_type_mutes as Record<string, string>).cvd, iso(T0 + H));
    setNow(T0 + 30 * 60_000); await tap(1001, 'tmute:cvd:1'); assert.equal((row('u-a').alert_type_mutes as Record<string, string>).cvd, iso(T0 + 90 * 60_000), 'a replay EXTENDS (restarts the hour)');
    setNow(T0 + 40 * 60_000); await tap(1001, 'tmute:cvd:4'); const four = (row('u-a').alert_type_mutes as Record<string, string>).cvd; assert.equal(four, iso(T0 + 40 * 60_000 + 4 * H));
    setNow(T0 + 41 * 60_000); await tap(1001, 'tmute:cvd:1'); const after = (row('u-a').alert_type_mutes as Record<string, string>).cvd;
    assert.equal(after, iso(T0 + 41 * 60_000 + H), 'STATED: a 1 h tap after a 4 h one SHORTENS the mute (latest tap wins, it never keeps the longer)'); assert.ok(Date.parse(after) < Date.parse(four));
    setNow(T0 + 10 * H); await tap(1001, 'tmute:rapid_move:1'); assert.deepEqual(Object.keys(row('u-a').alert_type_mutes as object), ['rapid_move'], 'expired cvd entry dropped on the next write');
  } finally { resetNow(); }
});

test('W4. the column missing (migration not applied) or the database failing: the tap answers "Could not mute", no throw, nothing half-written', async () => {
  setNow(T0);
  try {
    for (const dbMode of ['nocolumn', 'fail'] as const) {
      const { w, tap } = await world({ dbMode }); const r = await tap(1001, 'tmute:oi_spike:1'); assert.equal(r.status, 200, dbMode);
      assert.equal(answered(w).length, 1); assert.equal(answered(w)[0].body.text, 'Could not mute. Try again.', dbMode); assert.deepEqual(w.writes, [], dbMode);
    }
  } finally { resetNow(); }
});

/* ───────── C: the cron ───────── */
const SHORT_ALL = { series5: [...flat(60), 95], oi: 'up' as const, cvd: 'bear' as const };   // rapid dump (-5%), OI spike into a falling price, bearish CVD

test('C3. Web Push shares the decision: the short mutes are merged into the run\'s mute map BEFORE dispatchPush, and dispatchPush decides through isEligibleFor on that map (source pin)', () => {
  const src = readFileSync('app/api/telegram/alert/route.ts', 'utf8');
  const merge = src.indexOf('loadTypeMutesByUser()'); const push = src.indexOf('void dispatchPush(signalQueue, mutedByUser,'); const flush = src.indexOf('await flushSignals(token, recipients, mutedByUser,');
  assert.ok(merge > 0 && push > merge && flush > merge, `merge ${merge}, flush ${flush}, push ${push}: the merge must come first`);
  const fn = src.slice(src.indexOf('async function dispatchPush('), src.indexOf('async function dispatchPush(') + 4000);
  assert.match(fn, /isEligibleFor\(mutedByUser, sub\.user_id, e\)/, 'dispatchPush does not decide through isEligibleFor(mutedByUser, ...)');
});

/* ───────── D: the direction ───────── */
const THREE: U[] = [{ id: 'u-a', chat: '1001' }, { id: 'u-b', chat: '2002' }, { id: 'u-c', chat: '3003' }];
const M3 = [{ user_id: 'u-a', key: 'dir:short' }, { user_id: 'u-b', key: 'dir:long' }];   // A muted "Short signals", B muted "Long signals", C nothing
async function dir3(o: Parameters<typeof world>[0]) { const s = await world({ users: THREE, muted: M3, ...o }); const r = await s.run(); if (process.env.QA_DEBUG) console.log("RUN", JSON.stringify(r.body).slice(0, 300), "MSGS", JSON.stringify(s.w.markups.map(m => [m.chat_id, m.text.slice(0, 40)]))); return s; }
const OI_ONLY = (series5: number[] | null, extra: Partial<Parameters<typeof world>[0]> = {}) => ({ series5, oi: 'up' as const, ...extra });

test('D1. OI with the price UP over the hour is a LONG-direction alert: "Short signals" muter still gets it, "Long signals" muter does not (control: nobody muted gets it)', async () => {
  const { w } = await dir3(OI_ONLY(slope(60, 0.02)));
  const m = mine(w, '3003').find(x => OI.test(x.text));
  if (process.env.QA_DUMP) writeFileSync(process.env.QA_DUMP + '-oi.json', JSON.stringify({ oi: m?.text ?? null }));
  assert.ok(m, 'CONTROL: the unmuted user got the OI alert');
  assert.ok(has(w, '1001', OI), 'a "Short signals" mute silenced a price-UP OI alert'); assert.equal(has(w, '2002', OI), false, 'a "Long signals" mute did NOT silence a price-UP OI alert');
  /* B1 on the same run: a single OI alert carries exactly two buttons with the right labels and data */
  assert.deepEqual(m!.reply_markup, { inline_keyboard: [[{ text: 'Mute 1 h', callback_data: 'tmute:oi_spike:1' }, { text: 'Mute 4 h', callback_data: 'tmute:oi_spike:4' }]] });
});
test('D2. OI with the price DOWN is a SHORT-direction alert: the "Short signals" muter does not get it, the "Long signals" muter does', async () => {
  const { w } = await dir3(OI_ONLY(slope(60, -0.02)));
  assert.ok(has(w, '3003', OI), 'CONTROL: the unmuted user got the OI alert'); assert.equal(has(w, '1001', OI), false, 'a "Short signals" mute did not silence a price-DOWN OI alert'); assert.ok(has(w, '2002', OI), 'a "Long signals" mute silenced a price-DOWN OI alert');
});
test('D3. OI with NO usable price (flat, a NaN at the start of the hour, no candles at all) carries no direction: it is delivered to everyone, the direction mutes do not apply, and nothing crashes', async () => {
  for (const [name, o] of [['flat', OI_ONLY(flat(60))], ['NaN at the start of the hour', OI_ONLY(flat(60).map((v, i) => (i === 60 - 13 || i === 60 - 14 ? NaN : v)))], ['no candles', OI_ONLY(null, { noKlines: true })]] as const) {
    const s = await dir3(o as never);
    assert.equal(s.w.markups.length > 0, true, `${name}: the run delivered nothing at all`);
    for (const chat of ['1001', '2002', '3003']) assert.ok(has(s.w, chat, OI), `${name}: chat ${chat} did not get a direction-less OI alert (a direction mute applied, or the run broke)`);
  }
});
test('D4. rapid-move and CVD carry their own direction: a long world is silenced for the "Long signals" muter only, a short world for the "Short signals" muter only', async () => {
  const L = await dir3({ series5: [...flat(60), 105], oi: 'up', cvd: 'bull' }); const S = await dir3(SHORT_ALL);
  for (const re of [OI, CVD, RAPID]) {
    assert.ok(has(L.w, '3003', re), `CONTROL long world: ${re}`); assert.ok(has(L.w, '1001', re), `long world: "Short signals" muter lost ${re}`); assert.equal(has(L.w, '2002', re), false, `long world: "Long signals" muter still got ${re}`);
    assert.ok(has(S.w, '3003', re), `CONTROL short world: ${re}`); assert.equal(has(S.w, '1001', re), false, `short world: "Short signals" muter still got ${re}`); assert.ok(has(S.w, '2002', re), `short world: "Long signals" muter lost ${re}`);
  }
});

/* ───────── B: the buttons ───────── */
const LABELS2 = [['Mute 1 h', 'Mute 4 h']];
test('B1. a single CVD alert and a single rapid-move alert each carry exactly the two buttons (right labels, right data), the text unchanged', async () => {
  const c = await world({ cvd: 'bear', series5: flat(60) }); await c.run(); const r = await world({ series5: [...flat(60), 95] }); await r.run();
  const cm = mine(c.w, '1001').filter(m => CVD.test(m.text)); const rm = mine(r.w, '1001').filter(m => RAPID.test(m.text));
  if (process.env.QA_DUMP) writeFileSync(process.env.QA_DUMP + '-cvd-rapid.json', JSON.stringify({ cvd: cm[0]?.text ?? null, rapid: rm.map(x => x.text) }));
  assert.equal(cm.length, 1, 'one CVD message'); assert.equal(rm.length >= 1, true, 'a rapid message');
  assert.equal(mine(c.w, '1001').length, 1, 'the CVD world should send only the CVD alert: ' + mine(c.w, '1001').map(m => m.text.slice(0, 40)).join(' | '));
  assert.deepEqual(cm[0].reply_markup!.inline_keyboard.map(r => r.map(b => b.text)), LABELS2); assert.deepEqual(cm[0].reply_markup!.inline_keyboard[0].map(b => b.callback_data), ['tmute:cvd:1', 'tmute:cvd:4']);
  for (const m of rm.filter(x => mine(r.w, '1001').length > 0 && !/Signals/.test(x.text))) { assert.deepEqual(m.reply_markup!.inline_keyboard.map(r2 => r2.map(b => b.text)), LABELS2); assert.deepEqual(m.reply_markup!.inline_keyboard[0].map(b => b.callback_data), ['tmute:rapid_move:1', 'tmute:rapid_move:4']); }
  assert.ok(cm[0].text.startsWith('⚠️ <b>BTC Bearish CVD Divergence</b>') && /Negative<\/b> - sellers dominating volume/.test(cm[0].text), 'text: ' + cm[0].text);
});
test('B2. NO buttons on an RSI alert or a price alert (nor on anything that is not OI / CVD / rapid)', async () => {
  const s = await world({ rsi: true, alerts: [{ id: 1, user_id: 'u-a', coin: 'btc', target_price: 68_000, direction: 'above', active: true }] }); await s.run();
  const msgs = mine(s.w, '1001'); assert.ok(msgs.some(m => /RSI Overbought/.test(m.text)), 'CONTROL: an RSI alert was sent'); assert.ok(msgs.some(m => /Price Alert Triggered|Crossed Above/.test(m.text)), 'CONTROL: a price alert was sent');
  assert.deepEqual(msgs.filter(m => m.reply_markup).map(m => m.text.slice(0, 50)), [], 'a message that is not OI / CVD / rapid carries buttons');
});
test('B3. a confluence message names the types it can mute (one row per type); buttons on it come only from OI / CVD / rapid entries (STATED)', async () => {
  const s = await world(SHORT_ALL); await s.run(); const g = mine(s.w, '1001').find(m => /Signals/.test(m.text));
  assert.ok(g, 'a confluence message exists in this world'); const rows = g!.reply_markup!.inline_keyboard;
  assert.deepEqual(rows.map(r => r.map(b => b.callback_data)).flat().sort(), ['tmute:cvd:1', 'tmute:cvd:4', 'tmute:oi_spike:1', 'tmute:oi_spike:4', 'tmute:rapid_move:1', 'tmute:rapid_move:4'], 'rows: ' + JSON.stringify(rows));
  for (const r of rows) assert.equal(r.length, 2); assert.ok(rows.every(r => /^Mute (Open interest|CVD divergence|Rapid move) [14] h$/.test(r[0].text)), JSON.stringify(rows));
});

/* ───────── C1 / C2 run LAST: the alert module keeps cooldowns and a run budget in memory, so the clock they move must only ever go forward across the cells of this file (TC = now; C2 starts 3 h later). ───────── */
let TCv = 0; const tc = () => (TCv ||= realNow());   /* read at the first C cell, i.e. after every real-clock cell above has run */
test('C1. during a short mute that user gets no alert of that TYPE, another user still does, the user\'s other types arrive; after expiry it resumes', async () => {
  try {
    setNow(tc()); const s = await world(SHORT_ALL); await s.tap(1001, 'tmute:cvd:1');
    const { w, run } = s; setNow(tc() + 60_000, true); const r1 = await run(); if (process.env.QA_DEBUG) console.log("RUN1", JSON.stringify(r1).slice(0, 600));
    assert.ok(has(w, '2002', CVD) && has(w, '2002', OI) && has(w, '2002', RAPID), 'CONTROL: B (not muted) got all three: ' + mine(w, '2002').map(m => m.text.slice(0, 50)).join(' | '));
    assert.equal(has(w, '1001', CVD), false, 'A was sent the CVD alert during the mute'); assert.ok(has(w, '1001', OI) && has(w, '1001', RAPID), 'A\'s other types were silenced too');
    const before = w.markups.length; setNow(tc() + 62 * 60_000, true); await run();
    const later = w.markups.slice(before);
    assert.ok(later.some(m => m.chat_id === '1001' && CVD.test(m.text)), 'after the mute ended (+62 min, the CVD cooldown 60 min also over) A did not get the CVD alert again: ' + later.map(m => `${m.chat_id}:${m.text.slice(0, 40)}`).join(' | '));
  } finally { resetNow(); }
});

test('C2. a short mute never un-mutes a permanent mute (union), and writes nothing to the /alerts mute table', async () => {
  try {
    setNow(tc() + 3 * H); const s = await world({ ...SHORT_ALL, muted: [{ user_id: 'u-a', key: 'cvd' }, { user_id: 'u-a', key: 'oi_spike' }] }); const mutedBefore = JSON.stringify(s.w.tables.lhq_muted_alerts);
    await s.tap(1001, "tmute:cvd:1"); setNow(tc() + 3 * H + 60_000, true); const rr = await s.run(); if (process.env.QA_DEBUG) console.log("C2RUN", JSON.stringify(rr.body).slice(0, 400), JSON.stringify(s.w.markups.map(m => [m.chat_id, m.text.slice(0, 30)])));
    assert.equal(has(s.w, '1001', CVD), false, 'permanent + short: CVD reached A'); assert.equal(has(s.w, '1001', OI), false, 'a PERMANENT mute of another type (oi_spike) was lost when the short mute was merged in (union became replace)'); assert.ok(has(s.w, '2002', OI), 'CONTROL: B got OI'); assert.ok(has(s.w, '2002', CVD), 'CONTROL: B got it');
    const before = s.w.markups.length; setNow(tc() + 3 * H + 62 * 60_000, true); await s.run();
    assert.equal(s.w.markups.slice(before).some(m => m.chat_id === '1001' && CVD.test(m.text)), false, 'the short mute ENDING un-muted the permanent mute');
    assert.ok(s.w.markups.slice(before).some(m => m.chat_id === '2002' && CVD.test(m.text)), 'CONTROL: B got the CVD alert again (so the cooldown was over and the silence for A is the permanent mute)');
    assert.equal(JSON.stringify(s.w.tables.lhq_muted_alerts), mutedBefore, 'the /alerts mute table changed'); assert.deepEqual(s.w.writes.filter(x => x.table === 'lhq_muted_alerts'), []);
  } finally { resetNow(); }
});


test('C4. the cron BEFORE the column exists (migration not applied yet): every alert still goes out to everyone, the run answers 200 and reads no type mutes', async () => {
  setNow(tc() + 6 * H, true);
  try {
    const { w, run } = await world({ ...SHORT_ALL, dbMode: 'nocolumn' }); const r = await run();
    assert.equal(r.status, 200); assert.ok(w.writes.length === 0 || w.writes.every(x => x.table !== 'lhq_user_settings'));
    for (const chat of ['1001', '2002']) assert.ok(has(w, chat, CVD) && has(w, chat, OI) && has(w, chat, RAPID), `chat ${chat} lost an alert because the column is missing: ` + mine(w, chat).map(m => m.text.slice(0, 40)).join(' | '));
  } finally { resetNow(); }
});
