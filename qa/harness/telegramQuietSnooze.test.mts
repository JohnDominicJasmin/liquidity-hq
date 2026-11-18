import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installControlsWorld } from '../telegramControlsWorld.mjs';
import { loadRoute } from '../telegramWorld.mjs';

/* QA's cells for #2567 (quiet hours, snooze, pause in the alert cron), the REAL /api/telegram/alert route in-process, a fake network, nothing leaves the machine.
 * THE CLOCK: every cron run names the instant it starts at; Date.now then ticks from there (a frozen clock hangs the cron's own waits), so a run drifts by under a second and boundaries are probed 10 s either side. The exact-millisecond edge is pinned
 * on the pure rule in __tests__/alertQuietBoundaries.test.mts. THE RUN LOCK (#2560): a cron run that started under 5 minutes ago and has not finished makes the next call a no-op, so the cells never start two runs less than 6 minutes apart on the
 * virtual clock: `plan(when)` moves a requested instant forward by whole days (the hour of day is kept) until it is clear of the previous run, and `run` refuses an instant that is not. Each cell builds its own world and its own route module, so the
 * cells do not depend on each other; the whole file passes in one process (--test-force-exit), and a run that hits the route's own 28 s limit (a loaded machine) fails its own cell with that message instead of silently turning the later ones into no-ops.
 *   Q1  quiet hours that contain this hour: the quiet user gets NOTHING of any kind (RSI, signal bundles, price alert); the other user still gets all of it
 *   Q2  the boundaries of ten windows at 21:59:50, 22:00:00, 06:59:50, 07:00:00 (one cell per instant) match an oracle written from the owner's wording
 *   Q4  the user's own timezone decides the hour (Manila, New York, London, Kolkata, Tokyo, Kiritimati); a null, empty and invalid timezone read as UTC
 *   Q5  RULE FOR THE ALERT ITSELF: a per-recipient alert (RSI) fired during a hold is NOT consumed (delivered at the first run after it, once); an alert with ONE global dedup (the EMA BUY/SELL bundles) is delivered to the others and DROPPED for the held user
 *   Q6  snooze: held while the end is ahead, sent once it has passed; null and unparseable do not hold; Q6b held then sent at the end instant, once
 *   Q7  pause overrides everything: paused + expired snooze + no quiet still holds; paused false + future snooze holds; paused null does not hold
 *   Q8  every user held: the run is NOT the "no recipients" 503, sends nothing, and nothing is consumed: the first run after the hold sends
 *   Q9  a held user's PRICE alert stays active (not consumed, not deleted) and fires after the hold; another user's price alert fires meanwhile
 *   Q10 the hold read failing (migration q not applied): nobody is held, alerts still go, a warning is logged: alerts are never silenced by a missing column
 * WHAT IT CANNOT PROVE: the real database's column types, a real Telegram delivery. (Web Push and the macro-event cron are in telegramMacroAlertHold.test.mts.) */
type World = ReturnType<typeof makeWorld> & { missingColumns: Record<string, string[]>; patches: unknown[] };
type Msg = { chat_id: string; text: string };
type Row = Record<string, unknown>;
const rising = Array.from({ length: 300 }, (_, i) => 100 + i);
const D = '2026-11-18';
const at = (hhmmss: string) => Date.parse(`${D}T${hhmmss}Z`);
const DAY = 86_400_000, GAP = 6 * 60_000, HOUR = 3_600_000;
const PRO = { role: 'pro', trial_ends_at: null, current_period_end: '2027-03-01T00:00:00.000Z' };
const realNow = Date.now.bind(Date);
let lastStart = 0;                                                 // the virtual instant the previous cron run started at (module state, shared by every cell in this file)
const plan = (when: number) => { let t = when; while (t < lastStart + GAP) t += DAY; return t; };
async function scenario(users: Array<Row & { id: string; chat: string }>, o: { alerts?: unknown[]; fresh?: boolean; quick?: boolean; tables?: Record<string, unknown[]> } = {}) {
  const w = makeWorld({ tables: {
    lhq_price_alerts: o.alerts ?? (o.quick ? users.map((u, i) => ({ id: i + 1, user_id: u.id, coin: 'btc', target_price: 68_000, direction: 'above', active: true })) : []), lhq_muted_alerts: [], lhq_user_subscriptions: users.map((u) => ({ user_id: u.id, ...PRO })),
    lhq_user_settings: users.map((u) => { const { id, chat, ...rest } = u; return { user_id: id, telegram_chat_id: chat, ...{ timezone: 'UTC' }, ...rest }; }), ...(o.tables ?? {}),
  } }) as World;
  w.series = { 'BTCUSDT:60': rising }; if (o.quick) (w as unknown as { noKlines: boolean }).noKlines = true; if (o.fresh) (w as unknown as { freshSignals: RegExp }).freshSignals = /PEPE|BONK/;
  installControlsWorld(w); const route = await loadRoute();
  /** sameMarket: the candles stay those of the previous run (w.anchor is not moved), so a signal that was new then is the same signal now and its dedup applies; the virtual clock still advances */
  const run = async (when: number, sameMarket = false) => {
    assert.ok(when >= lastStart + GAP, `the clock must advance at least 6 minutes between cron runs (the 5-minute run lock): ${new Date(when).toISOString()} after ${new Date(lastStart).toISOString()}; use plan()`);
    lastStart = when; if (!sameMarket) w.anchor = when; const t0 = realNow(); Date.now = () => when + (realNow() - t0);
    try {
      const r = await route.run(); assert.equal(r.status, 200, 'the cron did not run: ' + JSON.stringify(r.body).slice(0, 200));
      assert.ok(!(r.body as { note?: string })?.note && typeof (r.body as { skipped?: unknown })?.skipped !== 'string', 'the cron hit its own 28 s limit (a loaded machine) or skipped its checks: ' + JSON.stringify(r.body).slice(0, 200)); return r;
    } finally { Date.now = realNow; }
  };
  return { w, run };
}
const to = (w: World, chat: string): Msg[] => w.telegram.sent.filter((m: Msg) => m.chat_id === chat);
const rsi = (w: World, chat: string) => to(w, chat).filter((m) => /BTC RSI Overbought|Price Alert Triggered|<b>BTC - /.test(m.text)).length;   // quick scenarios (no candles) carry one price alert per user instead of the RSI alert
const A = { id: 'u-a', chat: '1001' }, B = { id: 'u-b', chat: '2002' };

/** A window that contains the hour of day of "now" (the cells that need the full signal world start at the real hour: planned instants keep the hour of day). It wraps midnight when the hour is 21-23. */
const hereWindow = () => { const h = new Date().getUTCHours(); return { alert_quiet_start: h, alert_quiet_end: (h + 3) % 24 }; };
/** n instants for a cell that needs several runs close together in virtual time (a 4 h cooldown must not expire between them): the first is planned, each next is 7 minutes after the one before. */
const spaced = (n: number) => { const t0 = plan(realNow()); return Array.from({ length: n }, (_, i) => t0 + i * 7 * 60_000); };
test('Q1. quiet hours that contain this hour: the quiet user gets NOTHING of any kind (RSI, signal bundles, price alert), the other user still gets all of it', async () => {
  const alerts = [{ id: 1, user_id: 'u-a', coin: 'btc', target_price: 68_000, direction: 'above', active: true }, { id: 2, user_id: 'u-b', coin: 'btc', target_price: 68_000, direction: 'above', active: true }];
  const { w, run } = await scenario([{ ...A, ...hereWindow() }, B], { fresh: true, alerts }); await run(spaced(1)[0]);
  assert.equal(to(w, '1001').length, 0, `something was sent to the quiet user: ${to(w, '1001').map((m) => m.text.slice(0, 40)).join(' | ')}`);
  assert.ok(rsi(w, '2002') >= 1, 'CONTROL: the other user got no BTC alert'); assert.ok(to(w, '2002').filter((m) => /PEPE|BONK/.test(m.text)).length >= 2, 'CONTROL: the other user got no signal bundles'); assert.equal(to(w, '2002').filter((m) => /Price Alert Triggered/.test(m.text)).length, 1, 'CONTROL: no price alert');
  assert.equal((w.tables.lhq_price_alerts as Array<{ id: number; active: boolean }>).find((a) => a.id === 1)?.active, true, 'the quiet user price alert was consumed');
});
/** One cron run at `when` (planned) with one user per cell (each with its own settings and one price alert) plus a control user with no hold; answers which cells were SENT their alert. `cells` may be a function of the planned instant (for cells defined relative to it). Many cells per run: a full cron run is slow. */
async function matrix(when: number, cells: Record<string, Row> | ((t: number) => Record<string, Row>)): Promise<Record<string, boolean>> {
  const t = plan(when); const c = typeof cells === 'function' ? cells(t) : cells;
  const names = Object.keys(c); const users = [{ id: 'u-ctl', chat: '9000' }, ...names.map((n, i) => ({ id: 'u-' + n, chat: String(1100 + i), ...c[n] }))];
  const { w, run } = await scenario(users, { quick: true }); await run(t);
  assert.equal(rsi(w, '9000'), 1, 'CONTROL: the user with no hold got the alert'); return Object.fromEntries(names.map((n, i) => [n, rsi(w, String(1100 + i)) > 0]));
}
/** The owner's wording, written independently of lib/alertQuiet.ts: quiet from the start hour up to but not including the end hour; start later than end crosses midnight; start equal to end is no window. */
const oracle = (start: number, end: number, hour: number) => start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
const WINDOWS: Array<[number, number]> = [[22, 7], [22, 23], [3, 7], [21, 22], [7, 8], [6, 7], [23, 0], [0, 23], [20, 23], [5, 5]];
/** One time point per test (one cron run each). */
const q2 = (t: string, what: string) => test(`Q2${t === '21:59:50.000' ? 'a' : t === '22:00:00.000' ? 'b' : t === '06:59:50.000' ? 'c' : 'd'}. window boundaries in the cron at ${t}Z (${what}): each of 10 windows (wrapping, plain, end-exclusive, start-inclusive, start == end) holds or sends exactly as the owner wording says`, async () => {
  const hour = Number(t.slice(0, 2)); const cells = Object.fromEntries(WINDOWS.map(([a, b]) => [`w${a}_${b}`, { alert_quiet_start: a, alert_quiet_end: b }]));
  const got = await matrix(at(t), cells); const want = Object.fromEntries(WINDOWS.map(([a, b]) => [`w${a}_${b}`, !oracle(a, b, hour)]));
  assert.deepEqual(got, want, `at ${t}Z (sent = true): the cron disagrees with the owner wording`);
});
q2('21:59:50.000', 'ten seconds before 22:00'); q2('22:00:00.000', 'the start of 22-7'); q2('06:59:50.000', 'ten seconds before 07:00'); q2('07:00:00.000', 'the end of 22-7');
test('Q4. the account timezone decides the hour (22-7 window): Manila, New York, London, Kolkata, Tokyo, Kiritimati at 15:00Z and 23:30Z; null, empty and invalid zones read as UTC', async () => {
  const ZONES: Record<string, string | null> = { manila: 'Asia/Manila', ny: 'America/New_York', london: 'Europe/London', kolkata: 'Asia/Kolkata', tokyo: 'Asia/Tokyo', kiri: 'Pacific/Kiritimati', nul: null, empty: '', bad: 'Not/AZone', utc: 'UTC' };
  const OFFSET_MIN: Record<string, number> = { manila: 480, ny: -300, london: 0, kolkata: 330, tokyo: 540, kiri: 840, nul: 0, empty: 0, bad: 0, utc: 0 };   // standard time in force on 2026-11-18 and on the days the planner may move the cell to (up to a few days later, still before any clock change)
  for (const t of ['15:00:00.000', '23:30:00.000']) {
    const cells = Object.fromEntries(Object.entries(ZONES).map(([k, tz]) => [k, { alert_quiet_start: 22, alert_quiet_end: 7, timezone: tz }]));
    const got = await matrix(at(t), cells);
    const want = Object.fromEntries(Object.keys(ZONES).map((k) => [k, !oracle(22, 7, Math.floor((((at(t) / 60_000 + OFFSET_MIN[k]) % 1440) + 1440) % 1440 / 60))]));
    assert.deepEqual(got, want, `at ${t}Z (sent = true)`);
  }
});
test('Q5a. RULE (per-recipient alert, e.g. RSI; needs dev with #2560, where a cooldown is consumed only on delivery): a BTC alert that fires while the person is held is NOT consumed: the first run after the hold delivers it, once, and the next run does not repeat it', async () => {
  const [t1, t2, t3, t4] = spaced(4); const { w, run } = await scenario([{ ...A, ...hereWindow() }]);
  await run(t1); assert.equal(to(w, '1001').length, 0, 'sent during quiet hours'); await run(t2, true); assert.equal(to(w, '1001').length, 0);
  (w.tables.lhq_user_settings as Row[])[0].alert_quiet_start = null; await run(t3, true); assert.equal(rsi(w, '1001'), 1, 'the alert was consumed while the person was held and never delivered');
  await run(t4, true); assert.equal(rsi(w, '1001'), 1, 'the alert repeated inside its cooldown');
});
test('Q5b. RULE (global dedup alert): the EMA BUY/SELL bundles go to the others and are DROPPED for a held user: not delivered once the hold ends', async () => {
  const [t1, t2] = spaced(2); const { w, run } = await scenario([{ ...A, ...hereWindow() }, B], { fresh: true });
  await run(t1); const bundles = (c: string) => to(w, c).filter((m) => /PEPE|BONK/.test(m.text)).length;
  assert.ok(bundles('2002') >= 2, 'CONTROL: the other user got the PEPE and BONK bundles'); assert.equal(bundles('1001'), 0);
  (w.tables.lhq_user_settings as Row[])[0].alert_quiet_start = null; await run(t2, true); assert.equal(bundles('1001'), 0, 'documented rule: dropped for the held user. If this goes red the rule changed (late delivery)');
});
test('Q6. snooze in the cron: held while the end is ahead (+2 h, +30 s), sent once it has passed (-30 s, -1 day), null and an unparseable value do not hold; one run, one user per case', async () => {
  const got = await matrix(at('15:00:00.000'), (T) => { const iso = (d: number) => new Date(T + d).toISOString(); return { ahead2h: { alert_snooze_until: iso(2 * HOUR) }, ahead30s: { alert_snooze_until: iso(30_000) }, passed30s: { alert_snooze_until: iso(-30_000) }, passed1d: { alert_snooze_until: iso(-DAY) }, nul: { alert_snooze_until: null }, junk: { alert_snooze_until: 'not a date' } }; });
  assert.deepEqual(got, { ahead2h: false, ahead30s: false, passed30s: true, passed1d: true, nul: true, junk: true }, 'sent = true');
});
test('Q6b. snooze then resumes: held one hour before its end, the same user is sent at the end instant with no other change, exactly once', async () => {
  const t1 = plan(at('14:00:00.000')), until = t1 + HOUR; const { w, run } = await scenario([{ ...A, alert_snooze_until: new Date(until).toISOString() }], { quick: true });
  await run(t1); assert.equal(to(w, '1001').length, 0); await run(until); assert.equal(rsi(w, '1001'), 1); await run(until + 7 * 60_000); assert.equal(rsi(w, '1001'), 1);
});
test('Q7. pause overrides, in one run: paused + expired snooze, paused alone, paused + quiet outside, resumed (false) + future snooze, paused null, paused false', async () => {
  const got = await matrix(at('15:00:00.000'), (T) => { const past = new Date(T - HOUR).toISOString(), future = new Date(T + HOUR).toISOString(); return { pausedExpiredSnooze: { alert_paused: true, alert_snooze_until: past }, paused: { alert_paused: true }, pausedQuietOutside: { alert_paused: true, alert_quiet_start: 22, alert_quiet_end: 7 }, resumedStillSnoozed: { alert_paused: false, alert_snooze_until: future }, pausedNull: { alert_paused: null }, pausedFalse: { alert_paused: false } }; });
  assert.deepEqual(got, { pausedExpiredSnooze: false, paused: false, pausedQuietOutside: false, resumedStillSnoozed: false, pausedNull: true, pausedFalse: true }, 'sent = true');
});
test('Q8. EVERY user held: not the "no recipients" 503, nothing sent, nothing consumed (the first run after the hold sends the alert)', async () => {
  const t1 = plan(at('23:30:00.000')); const { w, run } = await scenario([{ ...A, alert_paused: true }, { ...B, alert_quiet_start: 22, alert_quiet_end: 7 }], { quick: true });
  const r1 = await run(t1); assert.notEqual(r1.status, 503, `the run answered ${r1.status} ${JSON.stringify(r1.body)}`); assert.equal(w.telegram.sent.length, 0, 'something was sent while everyone was held');
  (w.tables.lhq_user_settings as Row[]).forEach((r) => { r.alert_paused = false; r.alert_quiet_start = null; }); await run(t1 + 10 * 60_000);
  assert.equal(rsi(w, '1001') + rsi(w, '2002'), 2, 'the alert was consumed while everyone was held');
});
test('Q9. a held user\'s PRICE alert stays active during the hold and fires after it; another user\'s price alert fires meanwhile', async () => {
  const t1 = plan(at('14:00:00.000')), until = t1 + HOUR; const alerts = [{ id: 1, user_id: 'u-a', coin: 'btc', target_price: 68_000, direction: 'above', active: true }, { id: 2, user_id: 'u-b', coin: 'btc', target_price: 68_000, direction: 'above', active: true }];
  const { w, run } = await scenario([{ ...A, alert_snooze_until: new Date(until).toISOString() }, B], { alerts, quick: true });
  const priced = (c: string) => to(w, c).filter((m) => /Price Alert Triggered/.test(m.text)).length; const rows = w.tables.lhq_price_alerts as Array<{ id: number; active: boolean }>;
  await run(t1); assert.equal(priced('2002'), 1, 'CONTROL: the other user\'s alert fired'); assert.equal(priced('1001'), 0); assert.equal(rows.find((r) => r.id === 1)?.active, true, 'a held user\'s alert was consumed'); assert.equal(rows.find((r) => r.id === 2)?.active, false);
  await run(until); assert.equal(priced('1001'), 1, 'the held alert never fired after the hold'); assert.equal(rows.find((r) => r.id === 1)?.active, false);
});
test('Q10. the hold read failing (migration q not applied): nobody is held, the alerts still go, and a warning says why', async () => {
  const t1 = plan(at('15:00:00.000')); const { w, run } = await scenario([{ ...A, alert_paused: true }, B], { quick: true }); w.missingColumns.lhq_user_settings = ['alert_paused', 'alert_snooze_until', 'alert_quiet_start', 'alert_quiet_end'];
  const warns: string[] = []; const ow = console.warn; console.warn = (...a: unknown[]) => { warns.push(a.join(' ')); };
  try { await run(t1); } finally { console.warn = ow; }
  assert.equal(rsi(w, '1001'), 1, 'documented fail-open: without the columns the user is not held'); assert.equal(rsi(w, '2002'), 1);
  assert.ok(warns.some((m) => /quiet\/snooze\/pause settings unreadable/.test(m)), `no warning logged: ${warns.join(' | ')}`);
});
