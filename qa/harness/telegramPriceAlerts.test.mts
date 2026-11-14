import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain .mjs helper under qa/
import { makeWorld, installFakeFetch, loadRoute } from '../telegramWorld.mjs';

/* QA's Telegram cron harness (owner ask 2026-11-14: "test Telegram alerts heavily"). The REAL route handler runs in-process; only the network is fake (see qa/telegramWorld.mjs):
 * a fake Supabase, a fake Telegram Bot API that records every sendMessage, fake exchange endpoints. Nothing leaves the machine, no real chat, no real secret.
 * This file covers the PRICE-ALERT path end to end (above/below, ownership and Free/Pro gating, consume-once, failure paths and held retries, health). Signal alerts (footer, mute,
 * cooldown) are in qa/harness/telegramSignals.test.mts. */

type World = ReturnType<typeof makeWorld>;
const alert = (over: Record<string, unknown> = {}) => ({ id: 1, user_id: 'u-pro', coin: 'btc', target_price: 68_000, direction: 'above', active: true, label: 'my note', ...over });
async function scenario(o: { alerts: unknown[]; prices?: Record<string, number>; mode?: 'ok' | '403' | '400' | 'throw'; tables?: Record<string, unknown[]> }) {
  const w: World = makeWorld({ tables: { lhq_price_alerts: o.alerts, ...(o.tables ?? {}) } });
  w.noKlines = true;   // no candles: no signal can fire, so every message here is a price alert
  if (o.prices) w.prices = { ...w.prices, ...o.prices };
  if (o.mode) w.telegram.mode = o.mode;
  installFakeFetch(w);
  const route = await loadRoute();
  return { w, run: route.run };
}
const patches = (w: World) => w.writes.filter((x: { method: string; table: string }) => x.method === 'PATCH' && x.table === 'lhq_price_alerts');

test('(2a) an ABOVE alert whose price is crossed sends ONE message to its owner, says Crossed Above, carries no signals footer, and is consumed', async () => {
  const { w, run } = await scenario({ alerts: [alert()] });
  const r = await run();
  assert.equal(r.status, 200);
  assert.equal(w.telegram.sent.length, 1);
  assert.equal(w.telegram.sent[0].chat_id, '1001', 'to the owner only');
  assert.match(w.telegram.sent[0].text, /BTC Price Alert Triggered/); assert.match(w.telegram.sent[0].text, /Crossed Above <b>\$68,000<\/b>/); assert.match(w.telegram.sent[0].text, /Note: my note/);
  assert.doesNotMatch(w.telegram.sent[0].text, /Signals, not predictions/, 'a price alert must NOT carry the signals footer');
  assert.equal(patches(w).length, 1); assert.equal(patches(w)[0].body.active, false);
});

test('(2b) a BELOW alert whose price is crossed says Crossed Below', async () => {
  const { w, run } = await scenario({ alerts: [alert({ direction: 'below', target_price: 70_000 })] });
  await run();
  assert.equal(w.telegram.sent.length, 1); assert.match(w.telegram.sent[0].text, /Crossed Below <b>\$70,000<\/b>/);
});

test('(2c) CONTROL: a price that has not crossed sends nothing and leaves the alert active', async () => {
  const { w, run } = await scenario({ alerts: [alert({ target_price: 80_000 }), alert({ id: 2, direction: 'below', target_price: 60_000 })] });
  await run();
  assert.equal(w.telegram.sent.length, 0); assert.equal(patches(w).length, 0);
});

test('(5) FREE gating: an alert owned by a Free user is never sent, not to the owner and not to anyone else (no broadcast), and stays active', async () => {
  const { w, run } = await scenario({ alerts: [alert({ user_id: 'u-free' })] });
  const r = await run();
  assert.equal(r.status, 200);
  assert.deepEqual(w.telegram.attempts.filter((a: { text: string }) => /Price Alert/.test(a.text)), [], 'no price-alert message to any chat');
  assert.equal(patches(w).length, 0, 'the alert is left active, ready if the owner becomes entitled');
});

test('(5b) CONTROL: the same alert owned by the Pro user does send (so the Free case above is the gate, not an inert fixture)', async () => {
  const { w, run } = await scenario({ alerts: [alert({ user_id: 'u-pro' })] });
  await run(); assert.equal(w.telegram.sent.length, 1);
});

test('(4) DEDUPE: a consumed alert does not send again on the next 5-minute pass', async () => {
  const { w, run } = await scenario({ alerts: [alert()] });
  await run(); await run(); await run();
  assert.equal(w.telegram.sent.filter((s: { text: string }) => /Price Alert/.test(s.text)).length, 1, 'one message for one crossing, however many passes');
});

for (const [mode, why] of [['403', /blocked by the user/], ['400', /chat not found/]] as Array<['403' | '400', RegExp]>) {
  test(`(6) FAILURE ${mode}: Telegram refuses the send (${mode}) - the cron does not crash, reports it, keeps the alert and holds the message`, async () => {
    const { w, run } = await scenario({ alerts: [alert()], mode });
    const r = await run();
    assert.equal(r.status, 200, 'the run survives a failed send');
    assert.equal(w.telegram.sent.length, 0); assert.ok(w.telegram.attempts.length >= 1);
    assert.equal(r.body.delivery.failed >= 1, true, `delivery.failed = ${r.body.delivery.failed}`);
    assert.ok((r.body.delivery.reasons as string[]).some(x => why.test(x)), `the reason is Telegram's own: ${JSON.stringify(r.body.delivery.reasons)}`);
    assert.equal(r.body.delivery.priceAlertsHeld, 1, 'the owed message is held for a retry');
    assert.equal(patches(w).length, 0, 'a failed send must NOT consume the alert');
  });
}

test('(6b) FAILURE network down: a thrown send is counted as failed, not thrown out of the run', async () => {
  const { w, run } = await scenario({ alerts: [alert()], mode: 'throw' });
  const r = await run();
  assert.equal(r.status, 200); assert.ok(r.body.delivery.failed >= 1); assert.equal(patches(w).length, 0);
});

test('(6c) a held message is NOT re-sent on the very next pass (backoff), and the alert is not consumed meanwhile', async () => {
  const { w, run } = await scenario({ alerts: [alert()], mode: '403' });
  await run(); const first = w.telegram.attempts.filter((a: { text: string }) => /Price Alert/.test(a.text)).length;
  await run();
  assert.equal(w.telegram.attempts.filter((a: { text: string }) => /Price Alert/.test(a.text)).length, first, 'no second attempt inside the backoff');
  assert.equal(patches(w).length, 0);
});

test('(6d) the failure is on the health record: a send that failed is reported, not silent', async () => {
  const { w, run } = await scenario({ alerts: [alert()], mode: '403' });
  await run();
  const health = (w.rpcs ?? []).filter((x: { name: string }) => /health/i.test(x.name));
  assert.ok(health.length > 0, 'no health record was written at all');
  const text = JSON.stringify(health);
  assert.match(text, /alert:send|send/i, `no send health row: ${text.slice(0, 300)}`);
  assert.match(text, /blocked by the user|failed/i, `the failure reason is not on the health row: ${text.slice(0, 300)}`);
});
