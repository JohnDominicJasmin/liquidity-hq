import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { makeWorld, installFakeFetch, loadRoute, loadModule } from '../telegramWorld.mjs';

/* QA's LANGUAGE cells for #2590 (Telegram in the reader's saved language, tracker #1651): the REAL alert route, a fake network, nothing leaves the machine. The label table served by the fake database is the PROD block of
 * the held migration 20261119z5 (parsed from the SQL), so these cells read the same words a chat will read once it is applied.
 *   H1  one cron run, eight chats (ko, ru, zh, ar, en, no saved language, "ko-KR", "pt-BR"): each chat gets its own language, no other language's label appears in it, the unsupported ones read English, the tags are the English tags
 *   H2  news: the headline and the source (hostile: they ARE translatable phrases, carry U+2063, HTML and {placeholders}) stay verbatim in ko; "Breaking Alert" and "Source:" translate; no U+2063 reaches Telegram in ANY chat
 *   H3  a user's price-alert note (hostile in the same ways) stays verbatim in ko; the fixed text around it translates; the note of one user is delivered only to that user
 *   H4  held / failed: no label rows, an empty table, or a failing label read: every chat gets ENGLISH, the run answers 200 and the message lands
 *   H5  English parity: the same world with only English chats is dumped (QA_DUMP=<file>) so a run on dev and a run on the PR can be diffed byte for byte (time stamps normalised)
 *   H6  the malformed-body guard: a headline "NaN" is held back in every locale; reports whether a note "null" is held (as before) or now sent
 * WHAT IT CANNOT PROVE: Telegram's own rendering (RTL, emoji), the webhook / test-alert / plan-ended routes (see the unit cells), or the words being good Korean / Chinese / Russian / Arabic. */
type World = ReturnType<typeof makeWorld> & { series?: Record<string, number[]>; freshSignals?: RegExp | null };
type Msg = { chat_id: string; text: string };
const KEEP = '⁣';
const rising = Array.from({ length: 300 }, (_, i) => 100 + i);
const PRO = { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() };

/* the PROD block of the held migration, as lhq_labels rows */
const sql = readFileSync(new URL('../../supabase/migrations/20261119z5_labels_telegram_language.sql', import.meta.url), 'utf8');
const prodSql = sql.slice(sql.indexOf('===================== PROD'), sql.indexOf('===================== DEV'));
const ROW = /\('([A-Za-z0-9_]+)','([a-z]{2})',(E?)'((?:[^']|'')*)'\)/g;
const labelRows: Array<{ key: string; locale: string; value: string }> = [];
const LAB: Record<string, Record<string, string>> = { en: {}, ko: {}, zh: {}, ru: {}, ar: {} };
for (const m of prodSql.matchAll(ROW)) { let v = m[4].replace(/''/g, "'"); if (m[3] === 'E') v = v.replace(/\\n/g, '\n'); labelRows.push({ key: m[1], locale: m[2], value: v }); LAB[m[2]][m[1]] = v; }

interface U { id: string; chat: string; lang?: string | null }
const markup = (s: string) => (s.match(/<[^>]*>|&[a-z]+;/g) ?? []).sort().join('');
const norm = (t: string) => t.replace(/\d{2}:\d{2}/g, 'HH:MM');
type Opts = { users: U[]; alerts?: unknown[]; news?: unknown[]; labels?: 'real' | 'none' | 'fail'; failSends?: number; series?: Record<string, number[]>; noKlines?: boolean };
async function scenario(o: Opts) {
  const tables: Record<string, unknown[]> = {
    lhq_price_alerts: o.alerts ?? [], lhq_muted_alerts: [],
    lhq_user_subscriptions: o.users.map((u) => ({ user_id: u.id, ...PRO })),
    lhq_user_settings: o.users.map((u) => ({ user_id: u.id, telegram_chat_id: u.chat, timezone: 'UTC', ...(u.lang === undefined ? {} : { language: u.lang }) })),
    lhq_labels: o.labels === 'none' ? [] : labelRows.map((r) => ({ ...r })),
  };
  const w = makeWorld({ tables }) as World;
  w.series = o.series ?? { 'BTCUSDT:60': rising }; if (o.noKlines) (w as unknown as { noKlines: boolean }).noKlines = true;
  installFakeFetch(w);
  const base = globalThis.fetch; let labelReads = 0; let failed = 0; const seen: string[] = [];
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (/\/rest\/v1\/lhq_labels/.test(url)) { labelReads++; if (o.labels === 'fail') return new Response('{"message":"boom"}', { status: 500 }); }
    if (/api\.telegram\.org\/bot.*\/sendMessage/.test(url)) { seen.push(String(JSON.parse(String((init as { body?: string })?.body ?? '{}')).text)); if (o.failSends && failed < o.failSends) { failed++; return new Response('{"ok":false,"error_code":500}', { status: 500 }); } }
    if (/finnhub\.io\/api\/v1\/news\?category=crypto/.test(url) && o.news) return new Response(JSON.stringify(o.news), { status: 200, headers: { 'content-type': 'application/json' } });
    return base(input as never, init as never);
  }) as typeof fetch;
  // the label cache lives on globalThis: clear it so each run reads the table this scenario serves
  (await loadModule('lib/labelsServer.ts')).__labelsTestSeam();
  const route = await loadRoute();
  const res = await route.run() as { status: number; body: Record<string, unknown> | null };
  return { w, res, seen, labelReads: () => labelReads, to: (chat: string): Msg[] => w.telegram.sent.filter((m: Msg) => m.chat_id === chat) };
}
const rsi = (m: Msg) => /RSI/.test(m.text) && /BTC/.test(m.text);
const ALL8: U[] = [
  { id: 'u-ko', chat: '1001', lang: 'ko' }, { id: 'u-ru', chat: '1002', lang: 'ru' }, { id: 'u-zh', chat: '1003', lang: 'zh' }, { id: 'u-ar', chat: '1004', lang: 'ar' },
  { id: 'u-en', chat: '1005', lang: 'en' }, { id: 'u-null', chat: '1006', lang: null }, { id: 'u-region', chat: '1007', lang: 'ko-KR' }, { id: 'u-ptbr', chat: '1008', lang: 'pt-BR' },
];
const LANG_OF: Record<string, 'ko' | 'ru' | 'zh' | 'en'> = { '1001': 'ko', '1002': 'ru', '1003': 'zh', '1004': 'en' /* ar: ENGLISH since PM 2026-11-18, head 2a18e5e6 */, '1005': 'en', '1006': 'en', '1007': 'en', '1008': 'en' };
let cache: Awaited<ReturnType<typeof scenario>> | null = null;
const all8 = async () => (cache ??= await scenario({ users: ALL8 }));

test('H1. one cron run, eight chats: each reads its own saved language; unsupported / missing languages read English; no other language leaks in; tags equal the English tags', async () => {
  const { w, res, labelReads, to } = await all8();
  assert.equal(res.status, 200);
  assert.ok(labelReads() >= 1, 'CONTROL: the label table was read');
  const en = to('1005').filter(rsi); assert.equal(en.length, 1, 'CONTROL: the English chat got the BTC RSI message');
  assert.match(en[0].text, /BTC RSI Overbought \(1H\)/, 'CONTROL: it is the English text');
  for (const chat of Object.keys(LANG_OF)) {
    const got = to(chat).filter(rsi); assert.equal(got.length, 1, `chat ${chat} did not get exactly one BTC RSI message`);
    const lang = LANG_OF[chat], t = got[0].text;
    assert.ok(!t.includes(KEEP), `${chat}: U+2063 reached the chat`);
    assert.equal(markup(t), markup(en[0].text), `${chat}: tags differ from English`);
    if (lang === 'en') { assert.equal(norm(t), norm(en[0].text), `${chat}: a chat with no supported language (or ar) must read the English message`); assert.doesNotMatch(t, /[؀-ۿ]/, `${chat}: Arabic text reached an English reader`); }
    else {
      assert.ok(t.includes(LAB[lang].TG_RSI_OB_1H), `${chat} (${lang}) lacks ${LAB[lang].TG_RSI_OB_1H}: ${t}`);
      assert.ok(t.includes(LAB[lang].TG_RSI_OB_LINE), `${chat} (${lang}) lacks the zone line`);
      assert.doesNotMatch(t, /RSI Overbought|Overbought zone/, `${chat} (${lang}) still has the English`);
      for (const other of ['ko', 'ru', 'zh', 'ar'] as const) if (other !== lang) assert.ok(!t.includes(LAB[other].TG_RSI_OB_1H), `${chat} (${lang}) carries ${other}'s label`);
    }
  }
  assert.equal(w.telegram.sent.filter((m: Msg) => m.text.includes(KEEP)).length, 0);
});

const HOSTILE_HEAD = `Signals Aligned in 1h: Hormuz blockade <b>Price:</b> & {list} ${KEEP}Breaking Alert${KEEP}`;
const HOSTILE_SRC = `Price Alert Triggered ${KEEP} Source: {h}`;
const now = () => Math.floor(Date.now() / 1000);
test('H2. news: a headline and source that ARE translatable phrases (and carry U+2063, HTML, {placeholders}) stay verbatim in ko; the fixed text translates; no marker reaches any chat', async () => {
  const items = [{ id: 7001, headline: HOSTILE_HEAD, source: HOSTILE_SRC, datetime: now() }, { id: 7002, headline: 'Breaking Alert blockade', source: 'Price: ', datetime: now() }];
  const { w, to } = await scenario({ users: [{ id: 'u-ko', chat: '1001', lang: 'ko' }, { id: 'u-en', chat: '1005', lang: 'en' }, { id: 'u-ar', chat: '1004', lang: 'ar' }], news: items, noKlines: true });
  const esc = (s: string) => s.replaceAll(KEEP, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  for (const chat of ['1001', '1004', '1005']) {
    const msgs = to(chat); assert.equal(msgs.length, 2, `chat ${chat} got ${msgs.length} news messages (want 2)`);
    for (const m of msgs) assert.ok(!m.text.includes(KEEP), `${chat}: U+2063 reached the chat`);
    const lang = LANG_OF[chat];
    const a = msgs.find((m) => m.text.includes(esc(HOSTILE_HEAD)))!; assert.ok(a, `${chat}: the hostile headline was altered: ${JSON.stringify(msgs.map((m) => m.text))}`);
    assert.ok(a.text.includes(`<b>${esc(HOSTILE_HEAD)}</b>`) && a.text.includes(esc(HOSTILE_SRC)), `${chat}: headline or source not verbatim`);
    const b = msgs.find((m) => !m.text.includes(esc(HOSTILE_HEAD)))!;
    assert.ok(b.text.includes(`<b>Breaking Alert blockade</b>\n${lang === 'en' ? 'Source: ' : LAB[lang].TG_L_SOURCE}Price: \n`),`${chat}: a headline starting with "Breaking Alert" and a source equal to "Price: " were altered: ${JSON.stringify(b.text)}`);
    if (lang === 'en') assert.match(a.text, /Breaking Alert<\/b>\n\n<b>/); else {
      assert.ok(a.text.includes(`<b>${LAB[lang].TG_NEWS_BREAKING}</b>`), `${chat}: "Breaking Alert" not translated`);
      assert.ok(a.text.includes(`${LAB[lang].TG_L_SOURCE}${esc(HOSTILE_SRC)}`), `${chat}: "Source: " not translated`);
    }
  }
  assert.equal(w.telegram.sent.filter((m: Msg) => m.text.includes(KEEP)).length, 0, 'a marker reached Telegram');
});

test('H3. a user price-alert note (hostile) stays verbatim in ko, the fixed text around it translates, and it is delivered to its owner only', async () => {
  const note = `Price Alert Triggered ${KEEP} Crossed Above Note: {type} <i>x</i> & Open interest: `;
  const alerts = [{ id: 11, user_id: 'u-ko', coin: 'btc', target_price: 68_000, direction: 'above', active: true, label: note }];
  const { w, to } = await scenario({ users: [{ id: 'u-ko', chat: '1001', lang: 'ko' }, { id: 'u-ru', chat: '1002', lang: 'ru' }], alerts, noKlines: true });
  const msgs = to('1001'); assert.equal(msgs.length, 1, 'CONTROL: the owner got the price alert'); assert.equal(to('1002').length, 0, "another user got the owner's note");
  const t = msgs[0].text, inner = note.replaceAll(KEEP, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  assert.ok(!t.includes(KEEP), 'U+2063 reached the chat'); assert.ok(t.includes(`${LAB.ko.TG_L_NOTE}${inner}`), `the note was altered or its label not translated: ${t}`);
  assert.ok(t.includes(LAB.ko.TG_PRICE_ALERT) && t.includes(LAB.ko.TG_CROSSED_ABOVE) && t.includes(LAB.ko.TG_L_CURRENT), `the fixed text was not translated: ${t}`);
  assert.equal(w.telegram.sent.filter((m: Msg) => m.text.includes(KEEP)).length, 0);
});

for (const mode of ['none', 'fail'] as const) {
  test(`H4 (${mode === 'none' ? 'migration not applied: no label rows' : 'the label read fails with a 500'}): every chat reads ENGLISH, the run answers 200 and the message lands`, async () => {
    const { res, to, labelReads } = await scenario({ users: ALL8.slice(0, 5), labels: mode });
    assert.equal(res.status, 200); assert.ok(labelReads() >= 1, 'CONTROL: the label table was asked for');
    for (const chat of ['1001', '1002', '1003', '1004', '1005']) {
      const got = to(chat).filter(rsi); assert.equal(got.length, 1, `chat ${chat} got ${got.length} messages`);
      assert.match(got[0].text, /BTC RSI Overbought \(1H\)/, `chat ${chat} is not English`); assert.ok(!got[0].text.includes(KEEP));
    }
  });
}

test('H5. English parity: an English-only world is dumped for a byte comparison with dev (set QA_DUMP=<file>); markers never present', async () => {
  const note = `take profit & <b>x</b>`;
  const news = [{ id: 7101, headline: 'Hormuz blockade: Fed <i>holds</i> & more', source: 'Reuters & Co', datetime: now() }];
  const alerts = [{ id: 21, user_id: 'u-en', coin: 'btc', target_price: 68_000, direction: 'above', active: true, label: note }];
  const { w } = await scenario({ users: [{ id: 'u-en', chat: '1005', lang: 'en' }, { id: 'u-null', chat: '1006', lang: null }], alerts, news });
  const texts = w.telegram.sent.map((m: Msg) => `${m.chat_id}|${norm(m.text)}`).sort();
  if (process.env.QA_DUMP) writeFileSync(process.env.QA_DUMP, JSON.stringify(texts, null, 1));
  assert.ok(texts.length >= 4, `CONTROL: only ${texts.length} messages were produced`);
  assert.ok(texts.some((t: string) => /Breaking Alert/.test(t)) && texts.some((t: string) => /Price Alert Triggered/.test(t)) && texts.some((t: string) => /RSI/.test(t)), 'CONTROL: news, price alert and RSI all present');
  assert.ok(texts.every((t: string) => !t.includes(KEEP)), 'a marker reached an English chat');
});

test('H6. the malformed-body guard still runs: a headline "NaN" is held back in every locale; a note "null" outcome is reported against dev', async () => {
  const news = [{ id: 7201, headline: 'Hormuz blockade NaN', source: 'Reuters', datetime: now() }];
  const { to } = await scenario({ users: [{ id: 'u-ko', chat: '1001', lang: 'ko' }, { id: 'u-en', chat: '1005', lang: 'en' }], news, noKlines: true });
  assert.equal(to('1001').length + to('1005').length, 0, 'a message carrying NaN was sent');
  const alerts = [{ id: 31, user_id: 'u-ko', coin: 'btc', target_price: 68_000, direction: 'above', active: true, label: 'null' }];
  const r = await scenario({ users: [{ id: 'u-ko', chat: '1001', lang: 'ko' }], alerts, noKlines: true });
  console.log(`# H6 price alert with note "null": ${r.to('1001').length} message(s) sent (dev holds it back: 0)`);
});

test('H7. retries: a send that fails twice (500) and then lands is retried with the SAME translated body; no attempt ever carries U+2063; the delivered copy is Korean', async () => {
  const { seen, to } = await scenario({ users: [{ id: 'u-ko', chat: '1001', lang: 'ko' }], failSends: 2 });
  const attempts = seen.filter((t) => /RSI/.test(t));
  assert.ok(attempts.length >= 3, `CONTROL: only ${attempts.length} attempts were made`);
  assert.ok(attempts.every((t) => !t.includes(KEEP)), 'a marker reached a retry attempt');
  assert.equal(new Set(attempts.map(norm)).size, 1, 'the retries carried different bodies');
  const landed = to('1001').filter(rsi); assert.equal(landed.length, 1); assert.ok(landed[0].text.includes(LAB.ko.TG_RSI_OB_1H), 'the delivered copy is not Korean');
});
