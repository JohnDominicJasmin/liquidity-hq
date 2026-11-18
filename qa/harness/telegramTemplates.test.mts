import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installFakeFetch, loadRoute } from '../telegramWorld.mjs';

/* QA's Telegram TEMPLATE check (PM 2026-11-18): the REAL alert route, a fake network, nothing sent anywhere. Every message the route queues in several worlds (a normal market, a price alert, a market with MISSING inputs: no candles / no prices / no funding or open interest) is read as the USER reads it:
 *   T1  no "NaN", "undefined", "null", "[object", "Infinity" or empty "$" / "%" value anywhere in a message
 *   T2  at most 40 words (HTML tags and the time stamp stripped): an alert is read on a lock screen
 *   T3  no advice or forecast wording: buy now, sell now, you should, must, guaranteed, will (go|rise|fall|pump|dump), to the moon, sure
 *   T4  the removed footer ("Signals, not predictions. Past alerts moved…") is NOT in any message (owner order 2026-11-18, #2551)
 *   T5  CONTROL: the normal world really produced messages of three kinds (RSI, Signals Aligned, a price alert), so the checks above are not satisfied by an empty list; and the starved world did not crash the route
 * WHAT IT CANNOT PROVE: Telegram's own rendering, delivery, or the wording a real model-free template would take for inputs this world never produces. */

type World = ReturnType<typeof makeWorld>;
type Msg = { chat_id: string; text: string };
const rising = Array.from({ length: 300 }, (_, i) => 100 + i);
async function scenario(o: { alerts?: unknown[]; series?: Record<string, number[]>; prices?: Record<string, number> | null; fresh?: boolean } = {}) {
  const tables: Record<string, unknown[]> = {
    lhq_price_alerts: o.alerts ?? [], lhq_muted_alerts: [],
    lhq_user_subscriptions: [{ user_id: 'u-pro', role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() }],
    lhq_user_settings: [{ user_id: 'u-pro', telegram_chat_id: '1001', timezone: 'UTC' }],
  };
  const w: World = makeWorld({ tables }); w.series = o.series ?? { 'BTCUSDT:60': rising }; w.freshSignals = o.fresh === false ? null : /PEPE|BONK/; if (o.prices === null) w.prices = {}; else if (o.prices) w.prices = o.prices;
  installFakeFetch(w); const route = await loadRoute();
  let status = 0; try { const r = await route.run(); status = r.status; } catch { status = -1; }
  return { w, status };
}
const plain = (t: string) => t.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const words = (t: string) => plain(t).split(' ').filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
const BROKEN = /\bNaN\b|undefined|\bnull\b|\[object|Infinity|\$\s*(?![\d])\s|%\s*[,.)]|\(\s*\)|\{\w+\}/;
const ADVICE = /\b(buy now|sell now|you should|you must|must buy|must sell|guaranteed|will (?:go|rise|fall|pump|dump|moon|crash)|to the moon|sure thing|can'?t lose|risk-?free)\b/i;
const FOOT_ANY = /not predictions|past alerts moved|about half the time/i;

const BASE_ALERT = [{ id: 1, user_id: 'u-pro', coin: 'btc', target_price: 68_000, direction: 'above', active: true }];
async function allMessages() {
  const out: Array<{ world: string; text: string; kind: string }> = [];
  const worlds: Array<[string, Parameters<typeof scenario>[0]]> = [
    ['normal', {}], ['price-alert', { alerts: BASE_ALERT }],
    ['no-candles', { series: {}, fresh: false }], ['no-prices+alert', { alerts: BASE_ALERT, prices: null }],
    ['flat-candles-no-btc', { series: { 'BTCUSDT:60': Array.from({ length: 300 }, () => 100) }, fresh: false }],
  ];
  const statuses: Record<string, number> = {};
  for (const [name, o] of worlds) { const { w, status } = await scenario(o); statuses[name] = status; for (const m of w.telegram.sent as Msg[]) out.push({ world: name, text: m.text, kind: /Price Alert Triggered/.test(m.text) ? 'price' : /Signals Aligned/.test(m.text) ? 'group' : /RSI/.test(m.text) ? 'rsi' : 'other' }); }
  return { out, statuses };
}
let cache: Awaited<ReturnType<typeof allMessages>> | null = null;
const msgs = async () => (cache ??= await allMessages());

test('T5. CONTROL: three message kinds were produced, and the starved worlds did not crash the route', async () => {
  const { out, statuses } = await msgs(); const kinds = new Set(out.map((m) => m.kind));
  for (const k of ['rsi', 'group', 'price']) assert.ok(kinds.has(k), `no "${k}" message was produced (kinds: ${[...kinds].join(',')}): the checks below would pass on nothing`);
  for (const [w, s] of Object.entries(statuses)) assert.ok(s === 200, `the route answered ${s} in the "${w}" world`);
});
test('T1. no broken value (NaN, undefined, null, [object], Infinity, empty $ or %, unfilled {placeholder}) in any message', async () => {
  const { out } = await msgs(); const bad = out.filter((m) => BROKEN.test(plain(m.text))).map((m) => `${m.world}: ${plain(m.text).slice(0, 120)}`);
  assert.deepEqual(bad, [], `broken values in alert text:\n${bad.join('\n')}`);
});
test('T2. at most 40 words per message', async () => {
  const { out } = await msgs(); const long = out.map((m) => ({ n: words(m.text), m })).filter((x) => x.n > 40).map((x) => `${x.m.world} (${x.n} words): ${plain(x.m.text).slice(0, 140)}`);
  assert.deepEqual(long, [], `messages over 40 words:\n${long.join('\n')}`);
});
test('T3. no advice or forecast wording', async () => {
  const { out } = await msgs(); const bad = out.filter((m) => ADVICE.test(plain(m.text))).map((m) => `${m.world}: ${plain(m.text).slice(0, 140)}`);
  assert.deepEqual(bad, [], `advice / forecast wording in alert text:\n${bad.join('\n')}`);
});
test('T4. the removed "Signals, not predictions" footer is in no message', async () => {
  const { out } = await msgs(); const bad = out.filter((m) => FOOT_ANY.test(plain(m.text))).map((m) => `${m.world}: ${plain(m.text).slice(0, 140)}`);
  assert.deepEqual(bad, [], `the removed footer is back:\n${bad.join('\n')}`);
});
