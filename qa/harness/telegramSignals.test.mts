import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain .mjs helper under qa/
import { makeWorld, installFakeFetch, loadRoute } from '../telegramWorld.mjs';

/* QA's Telegram cron harness, SIGNAL half: the real route, a fake network (see qa/telegramWorld.mjs). The world's BTC hourly candles rise without a pause, so BTC reads RSI 100 and the cron
 * queues "RSI Overbought"; the flat default candles make PEPE and BONK fire EMA BUY signals on every timeframe, which the cron bundles into "N Signals Aligned". Those two are an artefact
 * of the synthetic market, used here on purpose: they give one single-signal message and two confluence messages to read, in every scenario.
 * Covers: message text and the signals footer (signal alerts yes, price alerts no), per-type and per-coin mute, repeat/cooldown, trial coin ladder, Free exclusion, send failure. */

type World = ReturnType<typeof makeWorld>;
const rising = Array.from({ length: 300 }, (_, i) => 100 + i);
const TRIAL = { user_id: 'u-trial', role: 'free', trial_ends_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), current_period_end: null };
async function scenario(o: { alerts?: unknown[]; muted?: Array<{ user_id: string; key: string }>; trial?: boolean; mode?: 'ok' | '403' | '400' | 'throw' } = {}) {
  const tables: Record<string, unknown[]> = {
    lhq_price_alerts: o.alerts ?? [], lhq_muted_alerts: o.muted ?? [],
    lhq_user_subscriptions: [{ user_id: 'u-pro', role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() }, { user_id: 'u-free', role: 'free', trial_ends_at: null, current_period_end: null }, ...(o.trial ? [TRIAL] : [])],
    lhq_user_settings: [{ user_id: 'u-pro', telegram_chat_id: '1001', timezone: 'UTC' }, { user_id: 'u-free', telegram_chat_id: '2002', timezone: 'UTC' }, ...(o.trial ? [{ user_id: 'u-trial', telegram_chat_id: '3003', timezone: 'UTC' }] : [])],
  };
  const w: World = makeWorld({ tables }); w.series = { 'BTCUSDT:60': rising }; if (o.mode) w.telegram.mode = o.mode;
  installFakeFetch(w);
  const route = await loadRoute();
  return { w, run: route.run };
}
type Msg = { chat_id: string; text: string };
const to = (w: World, chat: string): Msg[] => w.telegram.sent.filter((m: Msg) => m.chat_id === chat);
const isRsi = (m: Msg) => /RSI Overbought/.test(m.text);
const isGroup = (m: Msg) => /Signals Aligned/.test(m.text);
const FOOT = /<i>Signals, not predictions\. Past alerts moved the alert's way about half the time at 24 hours\.<\/i>$/;

test('(2a) a single signal alert reads as a signal and ENDS with the signals-not-predictions footer', async () => {
  const { w, run } = await scenario();
  const r = await run(); assert.equal(r.status, 200);
  const rsi = to(w, '1001').filter(isRsi); assert.equal(rsi.length, 1, 'one BTC RSI message');
  assert.match(rsi[0].text, /BTC RSI Overbought \(1H\)/); assert.match(rsi[0].text, /RSI: <b>100\.0<\/b>/); assert.match(rsi[0].text, FOOT);
});

test('(2b) a confluence message ("N Signals Aligned") lists its signals and ENDS with the footer', async () => {
  const { w, run } = await scenario(); await run();
  const groups = to(w, '1001').filter(isGroup); assert.ok(groups.length >= 1, 'no Signals Aligned message');
  for (const g of groups) { assert.match(g.text, /\d+ Signals Aligned/); assert.match(g.text, /• BUY Signal \(1M\)/); assert.match(g.text, FOOT); }
});

test('(2c) every signal message carries the footer once; a PRICE alert in the same pass does not carry it', async () => {
  const { w, run } = await scenario({ alerts: [{ id: 1, user_id: 'u-pro', coin: 'btc', target_price: 68_000, direction: 'above', active: true }] });
  await run();
  const msgs = to(w, '1001'); const price = msgs.filter((m: Msg) => /Price Alert Triggered/.test(m.text)); const signals = msgs.filter((m: Msg) => !/Price Alert Triggered/.test(m.text));
  assert.equal(price.length, 1, 'the price alert was sent'); assert.doesNotMatch(price[0].text, /Signals, not predictions/);
  assert.ok(signals.length >= 2); for (const s of signals) { assert.match(s.text, FOOT); assert.equal(s.text.split('Signals, not predictions').length - 1, 1, 'exactly one footer'); }
});

test('(3) MUTE by type: muting "rsi" stops the RSI alert only, the other signals still arrive', async () => {
  const { w, run } = await scenario({ muted: [{ user_id: 'u-pro', key: 'rsi' }] }); await run();
  assert.equal(to(w, '1001').filter(isRsi).length, 0, 'the muted type was delivered');
  assert.ok(to(w, '1001').filter(isGroup).length >= 1, 'the unmuted signals were also dropped');
});

test('(3b) MUTE by coin: muting coin:pepe drops PEPE\'s confluence message, BONK\'s and the RSI alert still arrive', async () => {
  const { w, run } = await scenario({ muted: [{ user_id: 'u-pro', key: 'coin:pepe' }] }); await run();
  const m = to(w, '1001'); assert.equal(m.filter((x: Msg) => /PEPE/.test(x.text)).length, 0, 'PEPE was delivered');
  assert.ok(m.filter((x: Msg) => /BONK/.test(x.text)).length >= 1); assert.equal(m.filter(isRsi).length, 1);
});

test('(3c) CONTROL: with no mute every one of those arrives (so (3)/(3b) are the mute, not an empty world)', async () => {
  const { w, run } = await scenario(); await run();
  const m = to(w, '1001'); assert.equal(m.filter(isRsi).length, 1); assert.ok(m.some((x: Msg) => /PEPE/.test(x.text))); assert.ok(m.some((x: Msg) => /BONK/.test(x.text)));
});

test('(4) COOLDOWN / DEDUPE: the next 5-minute passes send nothing new for the same conditions', async () => {
  const { w, run } = await scenario(); await run(); const first = w.telegram.sent.length; assert.ok(first >= 3);
  const r2 = await run(); const r3 = await run();
  assert.equal(w.telegram.sent.length, first, `a repeat pass re-sent ${w.telegram.sent.length - first} message(s): ${JSON.stringify(w.telegram.sent.slice(first).map((m: Msg) => m.text.slice(0, 60)))}; run2 note=${JSON.stringify(r2.body?.note ?? null)} fired=${JSON.stringify(r2.body?.fired)}; run3 note=${JSON.stringify(r3.body?.note ?? null)} fired=${JSON.stringify(r3.body?.fired)}`);
});

test('(5) TRIAL gating: a trial user gets BTC / ETH / SOL signals only; Pro gets every coin', async () => {
  const { w, run } = await scenario({ trial: true }); await run();
  const trial = to(w, '3003'); assert.ok(trial.some(isRsi), 'the trial user did not get the BTC RSI alert (BTC is on the free ladder)');
  assert.equal(trial.filter((m: Msg) => /PEPE|BONK/.test(m.text)).length, 0, `a trial user received a non-ladder coin: ${trial.map((m: Msg) => m.text.slice(0, 40)).join(' | ')}`);
  assert.ok(to(w, '1001').some((m: Msg) => /PEPE/.test(m.text)), 'CONTROL: Pro did get PEPE');
});

test('(5b) a Free user receives nothing at all, however their chat id got saved', async () => {
  const { w, run } = await scenario(); await run();
  assert.deepEqual(w.telegram.attempts.filter((a: Msg) => a.chat_id === '2002'), [], 'a Free user\'s chat was messaged');
});

test('(6) FAILURE: a blocked bot on a signal send does not crash the run and is counted with Telegram\'s reason', async () => {
  const { w, run } = await scenario({ mode: '403' });
  const r = await run(); assert.equal(r.status, 200);
  assert.equal(w.telegram.sent.length, 0); assert.ok(w.telegram.attempts.length >= 3);
  assert.ok(r.body.delivery.failed >= 3, `failed=${r.body.delivery.failed}`); assert.ok((r.body.delivery.reasons as string[]).some(x => /blocked by the user/.test(x)));
});
