import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installFakeFetch, loadRoute } from '../telegramWorld.mjs';

/* QA's DELIVERY cells for #2560 (owner sweep 2026-11-18): the REAL alert route, a fake network, nothing leaves the machine. Written against the behaviour the owner asked for, not against the code.
 *   D1  a send that fails twice then succeeds is DELIVERED (retry), exactly once; a 400 (chat not found) is final after 1 attempt
 *   D2  an alert is marked sent only AFTER Telegram accepts it: every attempt fails in run 1 (nothing delivered), the network heals, run 2 delivers it (never a silent loss)
 *   D3  the "Price Level Alerts" switch (muted key price_alerts) stops price alerts and the alert STAYS active; switched back on, it fires
 *   D4  the RSI cooldown is PER RECIPIENT: run 1 reaches only user A (B has RSI muted), run 2 reaches B (A is on cooldown and is not sent it again)
 *   D5  two overlapping cron runs send once (the second answers "a run is already in progress")
 *   D6  a signal more than 3 candles old is NOT sent (the flat market's cross is on its oldest bar); a fresh one is (control)
 *   D7  "Aligned" only when the signals point the same way: a bundle that carries a bearish RSI reading beside BUY signals says "mixed directions"; a pure BUY bundle says "Aligned"
 * WHAT IT CANNOT PROVE: Telegram's own delivery, real timing of the retry waits under a platform timeout, or the macro-headline switch (no news feed in this world: read in the code and pinned in __tests__). */
type World = ReturnType<typeof makeWorld>;
type Msg = { chat_id: string; text: string };
const rising = Array.from({ length: 300 }, (_, i) => 100 + i);
const PRO = { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString() };
async function scenario(o: { users?: Array<{ id: string; chat: string }>; muted?: Array<{ user_id: string; key: string }>; alerts?: unknown[]; fresh?: boolean; freshHourly?: boolean } = {}) {
  const users = o.users ?? [{ id: 'u-pro', chat: '1001' }];
  const tables: Record<string, unknown[]> = {
    lhq_price_alerts: o.alerts ?? [], lhq_muted_alerts: o.muted ?? [],
    lhq_user_subscriptions: users.map((u) => ({ user_id: u.id, ...PRO })), lhq_user_settings: users.map((u) => ({ user_id: u.id, telegram_chat_id: u.chat, timezone: 'UTC' })),
  };
  const w = makeWorld({ tables }) as World & { freshSignals?: RegExp; freshHourly?: boolean };
  w.series = { 'BTCUSDT:60': rising }; if (o.fresh) w.freshSignals = /PEPE|BONK/; if (o.freshHourly) w.freshHourly = true;
  installFakeFetch(w); const route = await loadRoute();
  return { w, route, run: () => route.run() as Promise<{ status: number; body: Record<string, unknown> | null }> };
}
const to = (w: World, chat: string): Msg[] => w.telegram.sent.filter((m: Msg) => m.chat_id === chat);
const btcRsi = (m: Msg) => /BTC RSI Overbought/.test(m.text);
const isSend = (i: unknown) => String((i as { url?: string })?.url ?? i).endsWith('/sendMessage');
/** The first `n` Telegram sends fail ('throw' = network, '500'); everything else passes through to the world. */
function failSends(n: number, kind: 'throw' | '500') {
  const real = globalThis.fetch; let c = 0;
  globalThis.fetch = (async (input: unknown, init?: unknown) => { if (isSend(input) && c < n) { c++; if (kind === 'throw') throw new Error('network down'); return new Response('{"ok":false,"error_code":500}', { status: 500 }); } return real(input as never, init as never); }) as typeof fetch;
  return { restore: () => { globalThis.fetch = real; }, count: () => c };
}

test('D1a. a send that fails twice (network, then 500) and succeeds on the third attempt is delivered exactly once', async () => {
  const { w, run } = await scenario(); const real = globalThis.fetch; let c = 0;
  globalThis.fetch = (async (i: unknown, init?: unknown) => { if (isSend(i) && c < 2) { c++; if (c === 1) throw new Error('network down'); return new Response('{"ok":false}', { status: 500 }); } return real(i as never, init as never); }) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = real; }
  assert.equal(c, 2, 'CONTROL: the two failures were injected'); assert.equal(to(w, '1001').filter(btcRsi).length, 1, 'the alert was lost or doubled after the retries');
});
test('D1b. a 400 (chat not found) is final: one attempt, no retry, nothing delivered', async () => {
  const { w, run } = await scenario(); w.telegram.mode = '400'; await run();
  assert.equal(w.telegram.attempts.filter((a: Msg) => btcRsi(a)).length, 1, 'a 400 was retried'); assert.equal(to(w, '1001').length, 0);
});
test('D2. nothing delivered in run 1 (every send fails): run 2, after the network heals, DELIVERS the BUY/SELL bundles and the RSI alert (none was marked seen before delivery)', async () => {
  const { w, run } = await scenario({ fresh: true }); const f = failSends(Infinity, 'throw');
  try { await run(); } finally { f.restore(); }
  const bundles = () => to(w, '1001').filter((m) => /BUY Signal/.test(m.text)).length;
  assert.ok(f.count() >= 3, 'CONTROL: the sends were failing in run 1'); assert.equal(w.telegram.sent.length, 0, 'CONTROL: nothing was delivered in run 1');
  await run(); assert.equal(bundles(), 2, 'a BUY/SELL signal was silently lost: run 2 did not deliver the PEPE and BONK bundles'); assert.equal(to(w, '1001').filter(btcRsi).length, 1, 'the RSI alert was silently lost');
});
test('D3. the Price Level Alerts switch stops price alerts and leaves the alert active; switched back on it fires', async () => {
  const alert = { id: 1, user_id: 'u-pro', coin: 'btc', target_price: 68_000, direction: 'above', active: true };
  const { w, run } = await scenario({ alerts: [alert], muted: [{ user_id: 'u-pro', key: 'price_alerts' }] }); await run();
  const priced = () => to(w, '1001').filter((m) => /Crossed Above|Price Alert/.test(m.text)).length;
  assert.equal(priced(), 0, 'a price alert was sent with the switch OFF'); assert.equal((w.tables.lhq_price_alerts as Array<{ active: boolean }>)[0]?.active, true, 'the alert was consumed while the switch was off');
  (w.tables.lhq_muted_alerts as unknown[]).length = 0; await run(); assert.equal(priced(), 1, 'the alert did not fire after the switch went back ON');
});
test('D4. the RSI cooldown is per recipient: B (RSI muted in run 1) still gets the alert in run 2, A is not sent it twice', async () => {
  const { w, run } = await scenario({ users: [{ id: 'u-a', chat: '1001' }, { id: 'u-b', chat: '2002' }], muted: [{ user_id: 'u-b', key: 'rsi' }] }); await run();
  assert.equal(to(w, '1001').filter(btcRsi).length, 1, 'CONTROL: A got the alert in run 1'); assert.equal(to(w, '2002').filter(btcRsi).length, 0, 'CONTROL: B (muted) did not');
  (w.tables.lhq_muted_alerts as unknown[]).length = 0; await run();
  assert.equal(to(w, '2002').filter(btcRsi).length, 1, "B was silenced by A's cooldown (a shared key)"); assert.equal(to(w, '1001').filter(btcRsi).length, 1, 'A was sent the same alert again inside its cooldown');
});
test('D5. two overlapping runs send once and the second says a run is in progress', async () => {
  const { w, run } = await scenario(); const [a, b] = await Promise.all([run(), run()]); const notes = [JSON.stringify(a.body ?? {}), JSON.stringify(b.body ?? {})];
  assert.equal(to(w, '1001').filter(btcRsi).length, 1, 'the same alert went out twice'); assert.ok(notes.some((t) => /already in progress/i.test(t)), `neither answer says a run is in progress: ${notes.map((t) => t.slice(0, 80)).join(' | ')}`);
});
test('D6. an old signal (the flat market crosses on its OLDEST bar) is not sent; a fresh one is, in the same kind of world', async () => {
  const stale = await scenario(); await stale.run(); const fresh = await scenario({ fresh: true }); await fresh.run();
  const bundles = (w: World) => to(w, '1001').filter((m) => /BUY Signal|Signals/.test(m.text)).length;
  assert.equal(bundles(fresh.w), 2, 'CONTROL: the fresh world produced its PEPE and BONK signal bundles'); assert.equal(bundles(stale.w), 0, 'an old signal was sent');
});
test('D7. "Aligned" only when the signals point the same way: BUY + a bearish RSI reading = "mixed directions"; a pure BUY bundle = "Aligned"', async () => {
  const pure = await scenario({ fresh: true }); await pure.run(); const mixed = await scenario({ fresh: true, freshHourly: true }); await mixed.run();
  const head = (w: World, coin: string) => to(w, '1001').find((m) => new RegExp(`<b>${coin} - `).test(m.text))?.text ?? '';
  assert.match(head(pure.w, 'PEPE'), /Signals Aligned/, 'CONTROL: a same-direction bundle is Aligned'); assert.doesNotMatch(head(pure.w, 'PEPE'), /mixed/);
  assert.match(head(mixed.w, 'PEPE'), /mixed directions/, 'BUY signals plus a bearish RSI reading were titled Aligned'); assert.doesNotMatch(head(mixed.w, 'PEPE'), /Signals Aligned/);
});
