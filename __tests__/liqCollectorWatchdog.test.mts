/* #2468: the server liquidation collector reports what it sees (60 s heartbeat into the venue's health row) and replaces an OPEN socket that has gone silent.
 *
 * THE REAL startLiqCollector RUNS HERE with a fake WebSocket class and mocked timers/clock. Two stand-ins only: lib/apiHealth.ts (every reportHealth call is recorded, no throttle, no network) and
 * lib/supabase-admin.ts (the batch upsert is recorded). The sockets are driven by hand: open, message, close.
 *
 * H1  heartbeat detail: 'connected, N msgs / M kept in K min, last msg Xs ago' from real counters (a message under the $10K floor counts as seen, not kept)
 * H2  a Bybit pong or ack is a sign of life, NOT a data message: it resets the silence clock and is not counted
 * W1  an open Bybit socket silent for 2 min: reported FAILED 'no message for Ns on an open socket, reconnecting', the old socket closed, ONE replacement opened
 * W2  the abandoned socket's late close/message events do nothing (no second reconnect, no counted message): one replacement only
 * W3  Binance tolerates 9 min of silence (47 symbols, no ping reply) and is replaced after 10
 * W4  a data message resets the clock: silence is counted from the LAST message, not from open
 * W5  a socket that CLOSED is not watched (it is already on its backoff): no extra replacement from the watchdog
 * WHAT IT CANNOT PROVE: that real sockets from the production host behave like the fake; the proof of that is the health rows on prod (liq:binance / liq:bybit updating every minute). */
import test, { beforeEach } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';

type Health = { source: string; ok: boolean; detail?: string };
const g = globalThis as unknown as { __health: Health[]; __upserts: unknown[][]; __lhqLiqCollector?: unknown };
g.__health = []; g.__upserts = [];
const healthStub = 'export const reportHealth = (source, category, ok, detail, items) => { globalThis.__health.push({ source, ok, detail, items }); };';
const adminStub = 'export const getSupabaseAdmin = () => ({ from: () => ({ upsert: async (b) => { globalThis.__upserts.push(b); return { error: null }; }, insert: async (b) => { globalThis.__upserts.push(b); return { error: null }; } }) });';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (context.parentURL && context.parentURL.endsWith('/lib/liqCollector.ts')) {
       if (specifier === './apiHealth.ts') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(healthStub)}), shortCircuit: true };
       if (specifier === './supabase-admin.ts') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(adminStub)}), shortCircuit: true };
     }
     return next(specifier, context);
   }`));

/* ---- the fake socket ---- */
type Listener = (ev: unknown) => void;
class FakeWS {
  static OPEN = 1; static instances: FakeWS[] = [];
  url: string; readyState = 0; sent: string[] = []; closed = false; private ls: Record<string, Listener[]> = {};
  constructor(url: string) { this.url = url; FakeWS.instances.push(this); }
  addEventListener(t: string, f: Listener) { (this.ls[t] ??= []).push(f); }
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; }
  emit(t: string, ev: unknown = {}) { for (const f of this.ls[t] ?? []) f(ev); }
  open() { this.readyState = 1; this.emit('open'); }
  msg(data: string) { this.emit('message', { data }); }
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
process.env.LIQ_COLLECTOR = '1';
const { startLiqCollector } = await import('../lib/liqCollector.ts');

const venue = (v: 'binance' | 'bybit') => FakeWS.instances.filter((s) => (v === 'binance' ? s.url.includes('fstream.binance.com') : s.url.includes('bybit') || s.url.includes('bytick')));
const health = (v: string) => g.__health.filter((h) => h.source === `liq:${v}`);
const bn = (usd: number) => JSON.stringify({ stream: 'btcusdt@forceOrder', data: { e: 'forceOrder', E: Date.now(), o: { s: 'BTCUSDT', S: 'SELL', X: 'FILLED', ap: String(usd), z: '1', T: Date.now() } } });
const bbData = JSON.stringify({ topic: 'allLiquidation.BTCUSDT', data: [{ T: Date.now(), s: 'BTCUSDT', S: 'Buy', v: '1', p: '50000' }] });

function boot(t: { mock: { timers: { enable(o: object): void; tick(ms: number): void } } }) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_800_000_000_000 });
  startLiqCollector();
  const bnS = venue('binance')[0], bbS = venue('bybit')[0];
  assert.ok(bnS && bbS, 'the collector did not open both sockets: the instrument did not run');
  bnS.open(); bbS.open();
  return { bnS, bbS, tick: (ms: number) => t.mock.timers.tick(ms) };
}
beforeEach(() => { FakeWS.instances = []; g.__health = []; g.__upserts = []; delete g.__lhqLiqCollector; });

test('H1. the 60 s heartbeat reports real counters: messages seen, rows kept (the $10K floor drops the small one), seconds since the last message', (t) => {
  const { bnS, tick } = boot(t);
  tick(60_000);                                           // the first heartbeat only sets the window start
  tick(20_000); bnS.msg(bn(60_000)); bnS.msg(bn(70_000)); bnS.msg(bn(500));
  tick(40_000);                                           // the second heartbeat: the minute between the two
  const last = health('binance').at(-1)!;
  assert.equal(last.ok, true);
  assert.match(last.detail!, /^connected, 3 msgs \/ 2 kept in 1 min, last msg 40s ago$/, 'heartbeat detail: ' + last.detail);
});
/* FINDING (reported on #2468, low): the FIRST heartbeat always reads '0 msgs / 0 kept' whatever arrived, because the window start is pushed before the delta is taken, so a healthy feed says 0 for its
   first minute. Written as the assertion that SHOULD hold; todo until Dev fixes it, then it becomes a real pin. */
test('H1b. the FIRST heartbeat counts the messages seen since the socket opened', { todo: true }, (t) => {
  const { bnS, tick } = boot(t);
  tick(20_000); bnS.msg(bn(60_000)); bnS.msg(bn(70_000)); bnS.msg(bn(500));
  tick(40_000);
  assert.match(health('binance').at(-1)!.detail!, /^connected, 3 msgs \/ 2 kept in 1 min/, 'first heartbeat: ' + health('binance').at(-1)!.detail);
});
test('H2. a Bybit pong or ack is a sign of life, not a data message: it resets the silence clock (no reconnect over 5 min) and is not counted', (t) => {
  const { bbS, tick } = boot(t);
  for (let i = 0; i < 10; i++) { tick(30_000); bbS.msg(JSON.stringify({ op: 'pong', success: true })); }
  assert.equal(venue('bybit').length, 1, 'pongs every 30 s must keep an open socket alive');
  assert.match(health('bybit').at(-1)!.detail!, /^connected, 0 msgs \/ 0 kept in \d+ min, last msg \d+s ago$/, 'a pong was counted as data: ' + health('bybit').at(-1)!.detail);
});

test('W1. an OPEN Bybit socket silent for 2 min is reported FAILED, the old socket is closed and exactly one replacement is opened', (t) => {
  const { bbS, tick } = boot(t);
  tick(110_000); assert.equal(venue('bybit').length, 1, 'replaced before the 2 min of silence');
  tick(70_000);
  assert.equal(venue('bybit').length, 2, 'no replacement after 3 min of silence');
  assert.equal(bbS.closed, true, 'the silent socket was not closed');
  const fail = health('bybit').filter((h) => !h.ok).at(-1);
  assert.ok(fail && /^no message for \d+s on an open socket, reconnecting$/.test(fail.detail!), 'the failure was not reported with the silence: ' + JSON.stringify(fail));
});
test('W2. the abandoned socket\'s late close and message events do nothing: still one replacement, no counted message', (t) => {
  const { bbS, tick } = boot(t);
  tick(180_000); assert.equal(venue('bybit').length, 2);
  const before = health('bybit').length;
  bbS.msg(bbData); bbS.emit('close', { code: 1006 });
  tick(60_000);
  assert.equal(venue('bybit').length, 2, 'the old socket\'s close started a SECOND reconnect');
  assert.ok(!health('bybit').slice(before).some((h) => /socket closed/.test(h.detail ?? '')), 'the abandoned socket reported its close');
});
test('W3. Binance (no ping reply, 47 symbols) tolerates 9 min of silence and is replaced after 10', (t) => {
  const { tick } = boot(t);
  tick(9 * 60_000); assert.equal(venue('binance').length, 1, 'replaced at 9 min: the quiet-market tolerance is gone');
  tick(2 * 60_000); assert.equal(venue('binance').length, 2, 'not replaced after 11 min of silence');
});
test('W4. a data message resets the clock: Bybit silent 100 s, a message, 100 s more is NOT replaced; one more watchdog check is', (t) => {
  const { bbS, tick } = boot(t);
  tick(100_000); bbS.msg(bbData); tick(100_000);
  assert.equal(venue('bybit').length, 1, 'silence was counted from open, not from the last message');
  tick(60_000); assert.equal(venue('bybit').length, 2, 'not replaced once the silence since the last message passed 2 min (the watchdog checks every 60 s)');
});
test('W5. a socket that CLOSED is not watched: one backoff reconnect, and the watchdog adds none', (t) => {
  const { bbS, tick } = boot(t);
  bbS.emit('close', { code: 1006 });
  tick(60_000);
  assert.equal(venue('bybit').length, 2, 'a closed socket was not reconnected once');
  tick(240_000);                                          // the replacement never opens: not open, so not watched
  assert.equal(venue('bybit').length, 2, 'the watchdog replaced a socket that was never open');
});
