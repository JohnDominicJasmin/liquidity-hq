import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeWorld, installFakeFetch, loadRoute, loadModule } from '../telegramWorld.mjs';

/* QA's DAILY SUMMARY cell for #2590 (the summary's date line and text in the reader's saved language): the REAL alert route, a fake network, a ticking fake clock, nothing leaves the machine. The label table is the PROD block of the held migration 20261119z5.
 *   D1  one cron run at the users' hour: the ko / zh / ru readers get the summary in their language WITH a date line in their language; the ar (English since PM 2026-11-18), en / no-language / "ko-KR" readers get the English summary with the English date line; tags equal the English tags; no marker; a coin symbol and every number survive
 * WHAT IT CANNOT PROVE: Telegram rendering (RTL), the words being good. */
const RealDate = Date; let offset = 0;
class FakeDate extends RealDate { constructor(...a: unknown[]) { if (a.length === 0) super(RealDate.now() + offset); else super(...(a as [number])); } static now() { return RealDate.now() + offset; } }
const clock = { set: (iso: string) => { offset = RealDate.parse(iso) - RealDate.now(); (globalThis as { Date: unknown }).Date = FakeDate; }, reset: () => { offset = 0; (globalThis as { Date: unknown }).Date = RealDate; } };
type World = ReturnType<typeof makeWorld>; type Msg = { chat_id: string; text: string };
const coins = await loadModule('lib/coins.ts');
const SYM: Record<string, string> = coins.BYBIT_SYMS; const BN: Record<string, string> = coins.BINANCE_SYMS; const factor = coins.symbolDenominationFactor as (s: string) => number;
const sql = readFileSync(new URL('../../supabase/migrations/20261119z5_labels_telegram_language.sql', import.meta.url), 'utf8');
const ROW = /\('([A-Za-z0-9_]+)','([a-z]{2})',(E?)'((?:[^']|'')*)'\)/g;
const labelRows: Array<{ key: string; locale: string; value: string }> = []; const LAB: Record<string, Record<string, string>> = { en: {}, ko: {}, zh: {}, ru: {}, ar: {} };
for (const m of sql.slice(sql.indexOf('===================== PROD'), sql.indexOf('===================== DEV')).matchAll(ROW)) { let v = m[4].replace(/''/g, "'"); if (m[3] === 'E') v = v.replace(/\\n/g, '\n'); labelRows.push({ key: m[1], locale: m[2], value: v }); LAB[m[2]][m[1]] = v; }
const markup = (s: string) => (s.match(/<[^>]*>|&[a-z]+;/g) ?? []).sort().join('');
const PRO = { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 400 * 86_400_000).toISOString() };
const USERS = [{ id: 'u-ko', chat: '1001', lang: 'ko' }, { id: 'u-zh', chat: '1002', lang: 'zh' }, { id: 'u-ru', chat: '1003', lang: 'ru' }, { id: 'u-ar', chat: '1004', lang: 'ar' }, { id: 'u-en', chat: '1005', lang: 'en' }, { id: 'u-null', chat: '1006', lang: null }, { id: 'u-region', chat: '1007', lang: 'ko-KR' }];
const DATE_RE: Record<string, RegExp> = { ko: /\d+월 \d+일 \([^)]+\)/, zh: /\d+月\d+日/, ru: /[а-яё]+\.?,? \d+ [а-яё]+/i, ar: /[؀-ۿ]+[،,]? 19 [؀-ۿ]+|[؀-ۿ]+[،,]? \d+ [؀-ۿ]+/, en: /Daily Summary - [A-Z][a-z]{2},? \d+ [A-Z][a-z]{2}</ };

test('D1. the daily summary: own language and own date line per reader; unsupported languages read English; tags equal the English tags; no marker', async () => {
  clock.set('2026-11-19T09:00:00Z');
  try {
    const w = makeWorld({ tables: {
      lhq_user_subscriptions: USERS.map((u) => ({ user_id: u.id, ...PRO })),
      lhq_user_settings: USERS.map((u) => ({ user_id: u.id, telegram_chat_id: u.chat, timezone: 'UTC', daily_summary_hour: 9, ...(u.lang === undefined ? {} : { language: u.lang }) })),
      lhq_muted_alerts: USERS.map((u) => ({ user_id: u.id, key: 'daily_summary_on' })), lhq_price_alerts: [], lhq_labels: labelRows.map((r) => ({ ...r })),
    } }) as World;
    (w as unknown as { series: object }).series = {}; installFakeFetch(w);
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: unknown) => {
      const u = new URL(String((input as { url?: string })?.url ?? input));
      if (u.host === 'api.bybit.com' && u.pathname === '/v5/market/tickers') {
        const pct: Record<string, number> = { btc: 0.09, eth: -0.12, sol: 0.03 };
        const list = Object.entries(SYM).map(([coin, sym]) => { const f = factor(sym); return { symbol: sym, lastPrice: String(100 / f), price24hPcnt: String(pct[coin] ?? 0.0001), highPrice24h: String(105 / f), lowPrice24h: String(95 / f), fundingRate: '0', volume24h: '1000', turnover24h: '1000000' }; });
        return new Response(JSON.stringify({ retCode: 0, result: { category: u.searchParams.get('category'), list } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.host === 'fapi.binance.com' && u.pathname === '/futures/data/globalLongShortAccountRatio') { const coin = Object.entries(BN).find(([, s]) => s === u.searchParams.get('symbol'))?.[0]; return new Response(JSON.stringify(coin ? [{ longAccount: '0.2' }] : []), { status: 200, headers: { 'content-type': 'application/json' } }); }
      return inner(input as never, init as never);
    }) as typeof fetch;
    (await loadModule('lib/labelsServer.ts')).__labelsTestSeam();
    const route = await loadRoute(); const res = await route.run() as { status: number };
    assert.equal(res.status, 200);
    const sums = (c: string) => (w.telegram.sent as Msg[]).filter((m) => m.chat_id === c && m.text.startsWith('☀️'));
    const en = sums('1005'); assert.equal(en.length, 1, 'CONTROL: the English reader got the summary'); assert.match(en[0].text, DATE_RE.en, `CONTROL: English date line: ${en[0].text}`);
    assert.match(en[0].text, /Biggest 24 h moves/);
    for (const u of USERS) {
      const got = sums(u.chat); assert.equal(got.length, 1, `${u.id} got ${got.length} summaries`); const t = got[0].text;
      assert.ok(!t.includes('⁣'), `${u.id}: marker`); assert.equal(markup(t), markup(en[0].text), `${u.id}: tags differ from English`);
      assert.ok(/<b>ETH<\/b>/.test(t) && /-12\.00%/.test(t), `${u.id}: a coin or number was altered: ${t}`);
      const lang = ['ko', 'zh', 'ru'].includes(u.lang ?? '') ? u.lang! : 'en';
      if (lang === 'en') { assert.equal(t.replace(/\d{2}:\d{2}/g, 'HH:MM'), en[0].text.replace(/\d{2}:\d{2}/g, 'HH:MM'), `${u.id}: must be the English summary`); assert.doesNotMatch(t, /[؀-ۿ]/, `${u.id}: Arabic text reached an English reader`); continue; }
      assert.ok(t.includes(LAB[lang].TG_DS_TITLE) && t.includes(LAB[lang].TG_DS_MOVES), `${u.id}: not in ${lang}: ${t}`);
      assert.match(t, DATE_RE[lang], `${u.id}: date line not in ${lang}: ${t.split('\n')[0]}`);
      assert.doesNotMatch(t.split('\n')[0], /Nov|Thu/, `${u.id}: the English date stayed in the title line`);
    }
    console.log(`# D1 title lines: ${USERS.map((u) => `${u.id}=${JSON.stringify(sums(u.chat)[0].text.split('\n')[0])}`).join(' ')}`);
  } finally { clock.reset(); }
});
