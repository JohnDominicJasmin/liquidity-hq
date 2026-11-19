import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installFakeFetch, loadRoute, loadModule } from '../telegramWorld.mjs';

/* QA cells for PR #2572 (opt-in DAILY SUMMARY at the user's hour): the REAL alert route, a fake network, nothing leaves the machine. The clock is a ticking fake Date moved by setTime(); every scenario is shifted 5 days FORWARD from the one before (no scenario spans more than 3 days, and 22 scenarios stay clear of the March DST change) so time never runs backwards inside one process (the route's exchange guard keeps timestamps in globalThis and waits out a past-dated 'future' until its own 28 s timeout).
 *   H1  ON at hour 9 (UTC): 08:55 none, 09:00 one, a second cron run at 09:10 none more, 10:00 none; the NEXT day's 09:05 one more (cooldown is 23 h)
 *   H2  OFF = no 'daily_summary_on' row: none, even with the OLD 'daily_summary' mute row absent/present; ON with no stored hour = 07:00; control: the ON user in the same run gets it
 *   H3  hour edges: hour 23 and hour 0 (UTC); the 30-minute window (09:30 in, 09:31 out); a zone that crosses midnight (Manila hour 0, New York hour 23, Auckland hour 7)
 *   H4  content: the 3 coins with the largest |24 h move| (+9, -12, +3, -1, +7 -> -12, +9, +7), squeeze lines only at or above THIS user's threshold (70 / 40 / 90), a muted coin is left out
 *   H5  no funding / Fear & Greed / price-alert text, no NaN/undefined/null, no advice words
 *   H6  missing data: tickers down -> nothing sent AND nothing marked (the next tick in the window sends); garbage tickers -> nothing; the hours read failing (column missing) -> nothing
 *   H7  a failed send is not marked sent: the next tick inside the window delivers once
 *   H8  a stored timezone that Intl rejects does not stop other users' summaries
 * WHAT IT CANNOT PROVE: Telegram's own delivery, real timing of the 5-minute cron, the Bybit payload beyond the fields the route reads. */
/* A TICKING fake clock (node's mock.timers freezes Date, and the route's exchange guard then waits forever and the run hits its own 28 s timeout): new Date() / Date.now() = real time + an offset. */
const RealDate = Date; let offset = 0;
class FakeDate extends RealDate { constructor(...a: unknown[]) { if (a.length === 0) super(RealDate.now() + offset); else super(...(a as [number])); } static now() { return RealDate.now() + offset; } }
let weeks = 0; const shift = (iso: string) => new RealDate(RealDate.parse(iso) + weeks * 5 * 86_400_000).toISOString();
const clock = { set: (iso: string) => { iso = shift(iso); offset = RealDate.parse(iso) - RealDate.now(); (globalThis as { Date: unknown }).Date = FakeDate; }, reset: () => { offset = 0; (globalThis as { Date: unknown }).Date = RealDate; } };
type World = ReturnType<typeof makeWorld>;
type Msg = { chat_id: string; text: string };
const coins = await loadModule('lib/coins.ts');
const SYM: Record<string, string> = coins.BYBIT_SYMS; const BN: Record<string, string> = coins.BINANCE_SYMS; const factor = coins.symbolDenominationFactor as (s: string) => number;
const PRO = { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 400 * 86_400_000).toISOString() };

type U = { plan?: 'pro' | 'free' | 'trial'; id: string; chat: string; tz?: string | null; hour?: number | null; on?: boolean; legacyMute?: boolean; threshold?: number; muted?: string[] };
type Mkt = { pct?: Record<string, number>; fr?: Record<string, number>; ls?: Record<string, number>; tickersDown?: boolean; garbage?: boolean; hoursReadFails?: boolean };
function market(w: World, m: Mkt) {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const u = new URL(String(input?.url ?? input));
    if (u.host === 'api.bybit.com' && u.pathname === '/v5/market/tickers') {
      if (m.tickersDown) return new Response('{}', { status: 500 });
      const list = Object.entries(SYM).map(([coin, sym]) => {
        const f = factor(sym); const base = 100;
        const pct = m.garbage ? 'abc' : String(m.pct?.[coin] ?? 0.0001);
        return { symbol: sym, lastPrice: m.garbage ? 'abc' : String(base / f), price24hPcnt: pct, highPrice24h: String((base * 1.05) / f), lowPrice24h: String((base * 0.95) / f), fundingRate: String(m.fr?.[coin] ?? 0), volume24h: '1000', turnover24h: '1000000' };
      });
      return new Response(JSON.stringify({ retCode: 0, result: { category: u.searchParams.get('category'), list } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.host === 'fapi.binance.com' && u.pathname === '/futures/data/globalLongShortAccountRatio') {
      const coin = Object.entries(BN).find(([, s]) => s === u.searchParams.get('symbol'))?.[0];
      const v = coin ? m.ls?.[coin] : undefined;
      return new Response(JSON.stringify(v == null ? [] : [{ longAccount: String(v) }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (m.hoursReadFails && u.host === 'stub.supabase.test' && u.search.includes('daily_summary_hour')) return new Response(JSON.stringify({ message: 'column lhq_user_settings.daily_summary_hour does not exist' }), { status: 400, headers: { 'content-type': 'application/json' } });
    return inner(input, init);
  }) as typeof fetch;
}
async function scenario(users: U[], m: Mkt = {}, at = '2026-11-18T09:00:00Z') {
  weeks++; clock.set(at);
  const tables: Record<string, unknown[]> = {
    lhq_user_subscriptions: users.map((u) => ({ user_id: u.id, ...(u.plan === 'free' ? { role: 'free', trial_ends_at: null, current_period_end: null } : u.plan === 'trial' ? { role: 'free', trial_ends_at: new Date(Date.now() + 400 * 86_400_000).toISOString(), current_period_end: null } : PRO) })),
    lhq_user_settings: users.map((u) => ({ user_id: u.id, telegram_chat_id: u.chat, timezone: u.tz === undefined ? 'UTC' : u.tz, ...(u.hour != null ? { daily_summary_hour: u.hour } : {}), ...(u.threshold != null ? { squeeze_threshold: u.threshold } : {}) })),
    lhq_muted_alerts: users.flatMap((u) => [...(u.on ? [{ user_id: u.id, key: 'daily_summary_on' }] : []), ...(u.legacyMute ? [{ user_id: u.id, key: 'daily_summary' }] : []), ...(u.muted ?? []).map((k) => ({ user_id: u.id, key: k }))]),
    lhq_price_alerts: users.map((u, i) => ({ id: i + 1, user_id: u.id, coin: 'btc', target_price: 123_456, direction: 'above', active: true, label: 'MYTARGET' })),
  };
  const w = makeWorld({ tables }) as World;
  w.series = {}; installFakeFetch(w); market(w, m); const route = await loadRoute();
  return { w, setTime: (iso: string) => clock.set(iso), run: () => route.run() as Promise<{ status: number; body: Record<string, unknown> | null }> };
}
const summaries = (w: World, chat?: string): Msg[] => w.telegram.sent.filter((x: Msg) => x.text.startsWith('☀️') && (chat == null || x.chat_id === chat));
const ON = (id: string, chat: string, extra: Partial<U> = {}): U => ({ id, chat, on: true, ...extra });
const done = () => clock.reset();

test('H1. ON at hour 9: 08:55 none, 09:00 one, a 2nd cron run in the same hour none more, 10:00 none; the next day 09:05 one more', async () => {
  const { w, run, setTime } = await scenario([ON('a', '1001', { hour: 9 })], { pct: { btc: 0.05 } }, '2026-11-18T08:55:00Z');
  try {
    await run(); assert.equal(summaries(w).length, 0, '08:55 is before the hour');
    setTime('2026-11-18T09:00:00Z'); await run(); assert.equal(summaries(w).length, 1, 'CONTROL: 09:00 sends');
    setTime('2026-11-18T09:10:00Z'); await run(); assert.equal(summaries(w).length, 1, 'a second cron run in the same hour sent it again');
    setTime('2026-11-18T10:00:00Z'); await run(); assert.equal(summaries(w).length, 1, '10:00 is another hour');
    setTime('2026-11-19T09:05:00Z'); await run(); assert.equal(summaries(w).length, 2, 'the next day it did not send again');
  } finally { done(); }
});

test('H2. OFF (no daily_summary_on row) gets none, with or without the old daily_summary mute row; ON with no stored hour gets it at 07:00', async () => {
  const { w, run } = await scenario([{ id: 'off', chat: '1001', hour: 7 }, { id: 'off2', chat: '1002', hour: 7, legacyMute: true }, ON('on', '1003'), ON('on2', '1004', { legacyMute: true })], {}, '2026-11-18T07:05:00Z');
  try {
    await run();
    assert.equal(summaries(w, '1003').length, 1, 'CONTROL: ON with no stored hour gets it at 07:00 UTC');
    assert.equal(summaries(w, '1001').length, 0, 'a user with no ON row got the summary'); assert.equal(summaries(w, '1002').length, 0, 'the old mute row switched someone ON');
    assert.equal(summaries(w, '1004').length, 1, 'an ON row beside a legacy mute row is ON (the legacy mute is ignored by design)');
  } finally { done(); }
});

test('H3a. hour 23 and hour 0 in UTC; the window is 30 minutes (09:30 in, 09:31 out)', async () => {
  const { w, run, setTime } = await scenario([ON('h23', '1023', { hour: 23 }), ON('h0', '1000', { hour: 0 }), ON('h9', '1009', { hour: 9 }), ON('h11', '1011', { hour: 11 }), ON('h12', '1012', { hour: 12 })], {}, '2026-11-18T22:55:00Z');
  try {
    await run(); assert.equal(summaries(w).length, 0, '22:55: nobody is due');
    setTime('2026-11-18T23:05:00Z'); await run(); assert.deepEqual(summaries(w).map((m) => m.chat_id), ['1023'], '23:05 is hour 23 only');
    setTime('2026-11-19T00:05:00Z'); await run(); assert.deepEqual(summaries(w).map((m) => m.chat_id).sort(), ['1000', '1023'], '00:05 is hour 0 (and 23 is not repeated)');
    setTime('2026-11-19T09:30:00Z'); await run(); assert.equal(summaries(w, '1009').length, 1, '09:30 is inside the 30-minute window');
    setTime('2026-11-19T11:31:00Z'); await run(); assert.equal(summaries(w, '1011').length, 0, '11:31 is outside the 30-minute window');
    setTime('2026-11-19T12:30:00Z'); await run(); assert.equal(summaries(w, '1012').length, 1, '12:30 is inside it');
  } finally { done(); }
});

test('H3b. a zone that crosses midnight: Manila hour 0 = 16:05Z, New York hour 23 = 04:05Z next day, Auckland hour 7 = 18:05Z the day before; the date line is the user\'s own', async () => {
  const { w, run, setTime } = await scenario([ON('m', '2001', { tz: 'Asia/Manila', hour: 0 }), ON('n', '2002', { tz: 'America/New_York', hour: 23 }), ON('z', '2003', { tz: 'Pacific/Auckland', hour: 7 })], {}, '2026-11-18T16:05:00Z');
  try {
    await run(); assert.deepEqual(summaries(w).map((m) => m.chat_id), ['2001'], '16:05Z is 00:05 in Manila only (New York is 11:05, Auckland 05:05)');
    const dom = (t: string) => Number(/Daily Summary - \w+,? (\d+)/.exec(t)?.[1]);
    setTime('2026-11-18T18:05:00Z'); await run(); assert.equal(summaries(w, '2003').length, 1, '18:05Z is 07:05 NZDT on the 19th');
    setTime('2026-11-19T04:05:00Z'); await run(); assert.deepEqual(summaries(w, '2002').length, 1, '04:05Z is 23:05 the day before in New York');
    assert.ok(dom(summaries(w, '2001')[0].text) > 0); assert.equal(dom(summaries(w, '2002')[0].text), dom(summaries(w, '2001')[0].text) - 1, 'Manila is one calendar day ahead of New York (its 00:05 is their 23:05 the evening before)');
    assert.equal(summaries(w).length, 3);
  } finally { done(); }
});

const MOVES = { btc: 0.09, eth: -0.12, sol: 0.03, xrp: -0.01, doge: 0.07 };
const idx = (t: string, s: string) => t.indexOf(s);
test('H4a. the three coins with the largest ABSOLUTE 24 h move, in that order: +9 -12 +3 -1 +7 -> ETH -12, BTC +9, DOGE +7; SOL and XRP are out', async () => {
  const { w, run } = await scenario([ON('a', '1001', { hour: 9 })], { pct: MOVES });
  try {
    await run(); const t = summaries(w, '1001')[0]?.text ?? ''; assert.ok(t, 'no summary sent');
    const L = coins.COIN_LABELS as Record<string, string>;
    const part = t.split('Squeeze setups')[0];
    const at = { eth: idx(part, `<b>${L.eth}</b>`), btc: idx(part, `<b>${L.btc}</b>`), doge: idx(part, `<b>${L.doge}</b>`) };
    assert.ok(at.eth >= 0 && at.btc > at.eth && at.doge > at.btc, `order must be ETH, BTC, DOGE: ${JSON.stringify(at)}`);
    assert.ok(part.includes('-12.00%') && part.includes('+9.00%') && part.includes('+7.00%'), 'the signed percentages');
    assert.equal(idx(part, `<b>${L.sol}</b>`), -1, 'SOL (+3) is not in the top 3'); assert.equal(idx(part, `<b>${L.xrp}</b>`), -1, 'XRP (-1) is not in the top 3');
    assert.equal((part.match(/in 24 h/g) ?? []).length, 3, 'exactly three movers');
  } finally { done(); }
});

const SQ = { fr: { eth: 0.0005, sol: -0.0004, xrp: 0.0003 }, ls: { eth: 0.66, xrp: 0.6 } };   // eth 40+40=80 LONG_LIQ, xrp 22+22=44 LONG_LIQ, sol 40 SHORT_SQ
test('H4b. squeeze lines only at or above THAT user\'s threshold: 70 -> ETH; 40 -> ETH, XRP, SOL (strongest first); a stored 90 is CLAMPED to 80, the highest score there is (Settings range 40-80, lib/alertThresholdRanges SQUEEZE_SCORE_MAX), and the heading names the number in force', async () => {
  const { w, run } = await scenario([ON('a', '1001', { hour: 9, threshold: 70 }), ON('b', '1002', { hour: 9, threshold: 40 }), ON('c', '1003', { hour: 9, threshold: 90 })], { ...SQ });
  try {
    await run(); const L = coins.COIN_LABELS as Record<string, string>;
    const sq = (chat: string) => (summaries(w, chat)[0]?.text ?? '').split('Squeeze setups')[1] ?? 'NO SUMMARY';
    const a = sq('1001'), b = sq('1002'), c = sq('1003');
    assert.match(a, /score 70\+/); assert.ok(a.includes(`<b>${L.eth}</b> long-heavy positioning, score 80/100`), a); assert.ok(!a.includes(`<b>${L.xrp}</b>`) && !a.includes(`<b>${L.sol}</b>`), `threshold 70 let a weaker setup through: ${a}`);
    assert.match(b, /score 40\+/); assert.ok(idx(b, `<b>${L.eth}</b>`) >= 0 && idx(b, `<b>${L.xrp}</b>`) > idx(b, `<b>${L.eth}</b>`) && idx(b, `<b>${L.sol}</b>`) > idx(b, `<b>${L.xrp}</b>`), `threshold 40: ETH 80, XRP 44, SOL 40 in that order: ${b}`);
    assert.ok(b.includes('short-heavy positioning, score 40/100'), b);
    /* a legacy stored 90 can never fire (40 funding + 40 long/short = 80 at most): the route reads it as 80 and says so in the heading; ETH (80) therefore shows, the weaker ones do not */
    assert.match(c, /score 80\+/); assert.ok(c.includes(`<b>${L.eth}</b> long-heavy positioning, score 80/100`), c); assert.ok(!c.includes(`<b>${L.xrp}</b>`) && !c.includes(`<b>${L.sol}</b>`), `a stored 90 (read as 80) let a weaker setup through: ${c}`);
  } finally { done(); }
});

test('H4c. a coin the user muted on /alerts is left out of BOTH lists', async () => {
  const { w, run } = await scenario([ON('a', '1001', { hour: 9, threshold: 40, muted: ['coin:eth'] })], { pct: MOVES, ...SQ });
  try {
    await run(); const t = summaries(w, '1001')[0]?.text ?? ''; const L = coins.COIN_LABELS as Record<string, string>;
    assert.ok(t, 'no summary'); assert.equal(idx(t, `<b>${L.eth}</b>`), -1, 'a muted coin is in the summary');
    assert.ok(idx(t, `<b>${L.btc}</b>`) >= 0 && idx(t, `<b>${L.doge}</b>`) >= 0 && idx(t, `<b>${L.sol}</b>`) >= 0, 'with ETH out the next movers move up: BTC +9, DOGE +7, SOL +3');
  } finally { done(); }
});

test('H5. no funding / Fear & Greed / price-alert-list text; no NaN, undefined, null, Infinity; no advice words; short', async () => {
  const { w, run } = await scenario([ON('a', '1001', { hour: 9, threshold: 10 }), ON('b', '1002', { hour: 9, threshold: 70 })], { pct: MOVES, fr: { ...SQ.fr, btc: 0.0006 }, ls: SQ.ls });
  try {
    await run(); assert.equal(summaries(w).length, 2);
    for (const m of summaries(w)) {
      const t = m.text;
      for (const bad of [/Funding Rates/i, /F&amp;G/, /Fear/i, /Greed/i, /Active Price Alerts/i, /MYTARGET/, /123,?456/, /Morning Briefing/, /NaN/, /undefined/, /null/i, /Infinity/]) assert.doesNotMatch(t, bad, `chat ${m.chat_id}: ${bad} in\n${t}`);
      for (const adv of [/\bbuy\b/i, /\bsell\b/i, /\bshould\b/i, /\brecommend/i, /\bavoid\b/i, /\benter\b/i, /\btake profit\b/i, /\bgo (long|short)\b/i, /guarantee/i]) assert.doesNotMatch(t, adv, `advice-like word in\n${t}`);
      assert.ok(t.length < 1500, `length ${t.length}`);
      const body = t.replace(/<[^>]+>/g, ''); const words = body.split(/\s+/).filter(Boolean).length; assert.ok(words <= 140, `${words} words`);
      assert.match(t, /Daily Summary - /); assert.match(t, /Biggest 24 h moves/); assert.match(t, /Squeeze setups \(score \d+\+\)/);
    }
  } finally { done(); }
});

test('H6a. tickers down: nothing is sent AND nothing is marked: when the data returns inside the same window the summary goes out once', async () => {
  const { w, run, setTime } = await scenario([ON('a', '1001', { hour: 9 })], { tickersDown: true }, '2026-11-18T09:00:00Z');
  try {
    const r = await run(); assert.equal(summaries(w).length, 0, 'a summary was sent with no market data'); assert.ok(r.status < 500, `the cron crashed: ${r.status}`);
    assert.equal(w.telegram.sent.filter((m: Msg) => /NaN|undefined/.test(m.text)).length, 0, 'garbage went out');
    market(w, {}); setTime('2026-11-18T09:05:00Z'); await run(); assert.equal(summaries(w).length, 1, 'the failed tick marked the day as sent, so the data coming back did not deliver');
  } finally { done(); }
});

test('H6b. garbage tickers (unparseable numbers) send nothing and never print NaN', async () => {
  const { w, run } = await scenario([ON('a', '1001', { hour: 9 })], { garbage: true });
  try { await run(); assert.equal(summaries(w).length, 0); assert.equal(w.telegram.sent.filter((m: Msg) => /NaN|undefined/.test(m.text)).length, 0); } finally { done(); }
});

test('H6c. the hour read failing (the column is missing: migration v not applied): NO summary to anyone, never a fallback to everyone at 07:00; no crash', async () => {
  const { w, run } = await scenario([ON('a', '1001'), ON('b', '1002', { hour: 7 })], { hoursReadFails: true }, '2026-11-18T07:05:00Z');
  try { const r = await run(); assert.ok(r.status < 500, `status ${r.status}`); assert.equal(summaries(w).length, 0, 'a summary went out although the hour could not be read'); } finally { done(); }
});

test('H7. a failed send is not marked: with every send failing at 09:00 nothing is delivered, at 09:05 (network healed) it is delivered once, and 09:10 does not repeat it', async () => {
  const { w, run, setTime } = await scenario([ON('a', '1001', { hour: 9 })], {}, '2026-11-18T09:00:00Z');
  try {
    w.telegram.mode = 'throw'; await run(); assert.equal(summaries(w).length, 0, 'CONTROL: nothing delivered while sends fail');
    assert.ok(w.telegram.attempts.some((a: Msg) => a.text.startsWith('☀️')), 'CONTROL: the summary was ATTEMPTED in run 1 (otherwise this cell proves nothing)');
    w.telegram.mode = 'ok'; setTime('2026-11-18T09:05:00Z'); await run(); assert.equal(summaries(w).length, 1, 'a failed send consumed the day');
    setTime('2026-11-18T09:10:00Z'); await run(); assert.equal(summaries(w).length, 1, 'delivered twice');
  } finally { done(); }
});

test('H7b. one chat failing while ANOTHER chat is delivered in the same run: the failed chat is not marked (the run-level discard does not cover it) and gets its summary on the next tick; the delivered chat is not repeated', async () => {
  const { w, run, setTime } = await scenario([ON('a', '1001', { hour: 9 }), ON('b', '1002', { hour: 9 })], {}, '2026-11-18T09:00:00Z');
  try {
    const real = globalThis.fetch; let healed = false; let tried = 0;
    globalThis.fetch = (async (input: unknown, init?: { body?: string }) => { const u = String((input as { url?: string })?.url ?? input); if (!healed && u.endsWith('/sendMessage') && init?.body && JSON.parse(init.body).chat_id === '1001') { tried++; throw new Error('network down'); } return real(input as never, init as never); }) as typeof fetch;
    await run(); assert.equal(summaries(w, '1002').length, 1, 'CONTROL: the other chat was delivered in run 1 (so the run is committed)'); assert.equal(summaries(w, '1001').length, 0, 'CONTROL: chat 1001 failed');
    assert.ok(tried >= 1, 'CONTROL: 1001 was attempted and failed');
    healed = true; setTime('2026-11-18T09:05:00Z'); await run();
    assert.equal(summaries(w, '1001').length, 1, 'a failed send was marked as sent: the chat lost its summary for the day'); assert.equal(summaries(w, '1002').length, 1, 'the delivered chat got it twice');
  } finally { done(); }
});

test('H8. a stored timezone Intl rejects does not stop anyone else; that user is judged in UTC', async () => {
  const { w, run } = await scenario([ON('bad', '1001', { tz: 'Not/AZone', hour: 9 }), ON('ok', '1002', { tz: 'UTC', hour: 9 })], {}, '2026-11-18T09:05:00Z');
  try { await run(); assert.equal(summaries(w, '1002').length, 1, 'the good user got nothing'); assert.equal(summaries(w, '1001').length, 1, 'the bad-zone user is judged in UTC'); } finally { done(); }
});

test('H9. who is a recipient: a Free account with an ON row (the backfill gives them one) gets nothing; a trial account gets the summary, limited to the Free coin ladder (BTC / ETH / SOL)', async () => {
  const { w, run } = await scenario([ON('free', '1001', { hour: 9, plan: 'free' }), ON('trial', '1002', { hour: 9, plan: 'trial', threshold: 10 }), ON('pro', '1003', { hour: 9, threshold: 10 })], { pct: { btc: 0.02, eth: -0.03, sol: 0.01, doge: 0.5, xrp: -0.4 }, fr: { doge: 0.0006, btc: 0.0006 }, ls: { doge: 0.7, btc: 0.7 } });
  try {
    await run(); const L = coins.COIN_LABELS as Record<string, string>;
    assert.equal(summaries(w, '1001').length, 0, 'a Free account got the summary'); assert.equal(summaries(w, '1003').length, 1, 'CONTROL: the Pro user got it');
    const tr = summaries(w, '1002')[0]?.text ?? ''; assert.ok(tr, 'the trial user got none');
    assert.equal(tr.includes('<b>' + L.doge + '</b>'), false, 'a trial user saw a coin outside BTC/ETH/SOL'); assert.equal(tr.includes('<b>' + L.xrp + '</b>'), false);
    assert.ok(summaries(w, '1003')[0].text.includes('<b>' + L.doge + '</b>'), 'CONTROL: the Pro user sees DOGE (the biggest mover)');
  } finally { done(); }
});

/* F1 (found by QA, fixed in 4fb7bbe1): "already sent" is the user's LOCAL DATE (lib/dailySummaryPrefs.ts summaryDueNow), not a 23 h cooldown. */
function setHour(w: World, userId: string, hour: number | null) { for (const r of w.tables.lhq_user_settings as Array<{ user_id: string; daily_summary_hour?: number | null }>) if (r.user_id === userId) r.daily_summary_hour = hour; }

test('F1. moving the hour EARLIER by more than 1 h still sends the next morning: received 09:05, hour changed to 07:00 -> next day 07:05 IS sent (22 h later, an earlier local date)', async () => {
  const { w, run, setTime } = await scenario([ON('a', '1001', { hour: 9 })], {}, '2026-11-18T09:05:00Z');
  try {
    await run(); assert.equal(summaries(w).length, 1, 'CONTROL: sent at 09:05');
    setHour(w, 'a', 7); setTime('2026-11-19T07:05:00Z'); await run();
    assert.equal(summaries(w).length, 2, 'the new 07:00 hour did not send the next morning');
    setTime('2026-11-19T07:20:00Z'); await run(); assert.equal(summaries(w).length, 2, 'a second run inside the same local date sent again');
  } finally { done(); }
});

test('F2. one send per LOCAL date: after today\'s send, moving the hour LATER does not send again today, but does tomorrow', async () => {
  const { w, run, setTime } = await scenario([ON('a', '1001', { hour: 9 })], {}, '2026-11-18T09:05:00Z');
  try {
    await run(); assert.equal(summaries(w).length, 1, 'CONTROL');
    setHour(w, 'a', 11); setTime('2026-11-18T11:05:00Z'); await run(); assert.equal(summaries(w).length, 1, 'sent twice on the same local date');
    setTime('2026-11-19T11:05:00Z'); await run(); assert.equal(summaries(w).length, 2, 'the next day at the new hour it was not sent');
  } finally { done(); }
});

test('F3. the date is the USER\'s local date, not UTC: Manila (UTC+8) got today\'s summary at 07:20 local = 23:20Z the day before; moving to 08:00 is the same LOCAL date (no send) although the UTC date differs; the next local day sends', async () => {
  const { w, run, setTime } = await scenario([ON('m', '2001', { tz: 'Asia/Manila', hour: 7 })], {}, '2026-11-17T23:20:00Z');   // 07:20 Manila on the 18th
  try {
    await run(); assert.equal(summaries(w).length, 1, 'CONTROL: sent at 07:20 Manila (the 18th local)');
    setHour(w, 'm', 8); setTime('2026-11-18T00:10:00Z'); await run();   // 08:10 Manila, still the 18th local, but a different UTC date
    assert.equal(summaries(w).length, 1, 'a UTC-date rule would send again here: the user\'s local date has not changed');
    setTime('2026-11-18T00:20:00Z'); await run(); assert.equal(summaries(w).length, 1);
    setTime('2026-11-19T00:10:00Z'); await run(); assert.equal(summaries(w).length, 2, 'the next local day (19th, 08:10 Manila) sends');
  } finally { done(); }
});

test('F4. a late send and an early next one: hour 23 UTC sent at 23:25, hour changed to 0 -> the next day 00:10 (45 min later, an earlier local date) IS sent', async () => {
  const { w, run, setTime } = await scenario([ON('a', '1001', { hour: 23 })], {}, '2026-11-18T23:25:00Z');
  try {
    await run(); assert.equal(summaries(w).length, 1, 'CONTROL: sent at 23:25');
    setHour(w, 'a', 0); setTime('2026-11-19T00:10:00Z'); await run(); assert.equal(summaries(w).length, 2, 'the 00:10 send on the next local date was blocked');
  } finally { done(); }
});

test('F5. a zone that crosses midnight uses the user\'s own date: Auckland hour 7 and New York hour 23 each get exactly one per local day over two days, ticking every 30 minutes around their window', async () => {
  const { w, run, setTime } = await scenario([ON('z', '3001', { tz: 'Pacific/Auckland', hour: 7 }), ON('n', '3002', { tz: 'America/New_York', hour: 23 })], {}, '2026-11-17T17:50:00Z');
  try {
    // Auckland 07:00 NZDT = 18:00Z the day before; New York 23:00 EST = 04:00Z the next day. Run at the start of each window and again 20 minutes later, for two days.
    const ticks: string[] = []; for (let d = 0; d < 2; d++) { const day = 17 + d; ticks.push(`2026-11-${day}T18:05:00Z`, `2026-11-${day}T18:25:00Z`, `2026-11-${day + 1}T04:05:00Z`, `2026-11-${day + 1}T04:25:00Z`); }
    ticks.sort();
    for (const t of ticks) { setTime(t); await run(); }
    assert.equal(summaries(w, '3001').length, 2, 'Auckland: one per local day for three days'); assert.equal(summaries(w, '3002').length, 2, 'New York: one per local day for three days');
  } finally { done(); }
});

test('F6. the UTC fallback: no stored timezone (null) and a zone Intl rejects are both judged in UTC, one send per UTC date', async () => {
  const { w, run, setTime } = await scenario([ON('n', '4001', { tz: null, hour: 9 }), ON('b', '4002', { tz: 'Not/AZone', hour: 9 })], {}, '2026-11-18T09:05:00Z');
  try {
    await run(); assert.deepEqual(summaries(w).map((m) => m.chat_id).sort(), ['4001', '4002']);
    setTime('2026-11-18T09:20:00Z'); await run(); assert.equal(summaries(w).length, 2, 'repeated inside the same UTC date');
    setTime('2026-11-19T09:05:00Z'); await run(); assert.equal(summaries(w).length, 4, 'the next UTC date did not send');
  } finally { done(); }
});
