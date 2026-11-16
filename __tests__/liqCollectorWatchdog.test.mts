/* #2415 + #2470: the server liquidation collector reports what it sees (60 s heartbeat into the venue health row) and replaces a socket that has gone silent (15 s watchdog; Bybit 60 s, Binance 10 min).
 *
 * THE REAL startLiqCollector RUNS HERE with a fake WebSocket class and mocked timers/clock. Two stand-ins only: lib/apiHealth.ts (every reportHealth call is recorded, no throttle, no network) and
 * lib/supabase-admin.ts (the batch upsert is recorded). The sockets are driven by hand: open, message, close.
 *
 * H1  heartbeat detail: 'connected, N msgs / M kept in K min, last msg Xs ago' from real counters (a message under the $10K floor counts as seen, not kept)
 * H2  a Bybit pong or ack is a sign of life, NOT a data message: it resets the silence clock and is not counted
 * W1  Bybit silent past BYBIT_STALE_MS: FAILED "no message for N s, reconnecting", old socket closed, ONE replacement after the backoff
 * W2  the abandoned socket's late close/message events do nothing (no second reconnect, no counted message): one replacement only
 * W3  Binance tolerates silence up to BINANCE_STALE_MS, replaced after it
 * W4  a data message resets the clock: silence is counted from the LAST message, not from open
 * W5  a closed socket reconnects once; a replacement that never opens is retired when stale. W6 the 20 min no-liquidation FAILED row. C1 the tuned windows
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
const { startLiqCollector, BYBIT_STALE_MS, BINANCE_STALE_MS, LIQ_SILENCE_FAIL_MS } = await import('../lib/liqCollector.ts');

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
  /* In 1 s steps: one big tick moves the mocked clock to the END first, so every timer would see the final time (a 15 s watchdog would report the whole silence at once and its 2 s backoff would fall outside the tick). */
  return { bnS, bbS, tick: (ms: number) => { for (let left = ms; left > 0; left -= 1_000) t.mock.timers.tick(Math.min(1_000, left)); } };
}
beforeEach(() => { FakeWS.instances = []; g.__health = []; g.__upserts = []; delete g.__lhqLiqCollector; });

test('H1. the 60 s heartbeat reports real counters since the socket OPENED: messages seen, rows kept (the $10K floor drops the small one), seconds since the last message', (t) => {
  const { bnS, tick } = boot(t);
  tick(20_000); bnS.msg(bn(60_000)); bnS.msg(bn(70_000)); bnS.msg(bn(500));
  tick(40_000);                                           // the FIRST heartbeat (#2470: it used to read 0 / 0)
  const last = health('binance').at(-1)!;
  assert.equal(last.ok, true);
  assert.match(last.detail!, /^connected, 3 msgs \/ 2 kept in 1 min, last msg 40s ago$/, 'first heartbeat: ' + last.detail);
});
test('H1b. the SECOND heartbeat counts only the minute between the two beats', (t) => {
  const { bnS, tick } = boot(t);
  tick(20_000); bnS.msg(bn(60_000)); tick(40_000);        // beat 1
  tick(30_000); bnS.msg(bn(70_000)); bnS.msg(bn(80_000)); tick(30_000);   // beat 2
  assert.match(health('binance').at(-1)!.detail!, /^connected, 3 msgs \/ 3 kept in 2 min, last msg 30s ago$/, 'second heartbeat: ' + health('binance').at(-1)!.detail);
});
test('H2. a Bybit pong or ack is a sign of life, not a data message: it resets the silence clock (no reconnect over 5 min) and is not counted', (t) => {
  const { bbS, tick } = boot(t);
  for (let i = 0; i < 10; i++) { tick(30_000); bbS.msg(JSON.stringify({ op: 'pong', success: true })); }
  assert.equal(venue('bybit').length, 1, 'pongs every 30 s must keep an open socket alive');
  assert.match(health('bybit').at(-1)!.detail!, /^connected, 0 msgs \/ 0 kept in \d+ min, last msg \d+s ago$/, 'a pong was counted as data: ' + health('bybit').at(-1)!.detail);
});

test('W1. Bybit silent past BYBIT_STALE_MS: reported FAILED "no message for N s, reconnecting", the old socket is closed, ONE replacement is opened (after the backoff)', (t) => {
  const { bbS, tick } = boot(t);
  tick(BYBIT_STALE_MS - 1_000); assert.equal(venue('bybit').length, 1, 'replaced before the stale window');
  tick(30_000);                                           // the 15 s watchdog fires past the window; the replacement follows the 2 s backoff
  assert.equal(venue('bybit').length, 2, 'no replacement after the stale window');
  assert.equal(bbS.closed, true, 'the silent socket was not closed');
  const fail = health('bybit').filter((h) => !h.ok).at(-1);
  assert.ok(fail && /^no message for \d+ s, reconnecting$/.test(fail.detail!), 'the failure was not reported with the silence: ' + JSON.stringify(fail));
});
test('W2. the retired socket\'s late close and message events do nothing: still one replacement, no counted message, no second "socket closed" report', (t) => {
  const { bbS, tick } = boot(t);
  tick(BYBIT_STALE_MS + 30_000); assert.equal(venue('bybit').length, 2);
  const before = health('bybit').length;
  bbS.msg(bbData); bbS.emit('close', { code: 1006 });
  tick(60_000);
  assert.equal(venue('bybit').length, 2, 'the old socket\'s close started a SECOND reconnect');
  assert.ok(!health('bybit').slice(before).some((h) => /socket closed/.test(h.detail ?? '')), 'the retired socket reported its close');
});
test('W3. Binance (no ping reply, 47 symbols) tolerates silence up to BINANCE_STALE_MS and is replaced after it', (t) => {
  const { tick } = boot(t);
  tick(BINANCE_STALE_MS - 1_000); assert.equal(venue('binance').length, 1, 'replaced inside the quiet-market tolerance');
  tick(30_000); assert.equal(venue('binance').length, 2, 'not replaced after the stale window');
});
test('W4. a data message resets the clock: Bybit silent 50 s, a message, 50 s more is NOT replaced; 40 s later it is', (t) => {
  const { bbS, tick } = boot(t);
  tick(50_000); bbS.msg(bbData); tick(50_000);
  assert.equal(venue('bybit').length, 1, 'silence was counted from open, not from the last message');
  tick(40_000); assert.equal(venue('bybit').length, 2);
});
test('W5. a socket that CLOSES reconnects once, after the backoff, and a replacement that never opens is itself replaced when it goes stale', (t) => {
  const { bbS, tick } = boot(t);
  bbS.emit('close', { code: 1006 });
  assert.match(health('bybit').at(-1)!.detail!, /^socket closed \(code 1006\), reconnecting$/);
  tick(3_000); assert.equal(venue('bybit').length, 2, 'a closed socket was not reconnected once');
  tick(BYBIT_STALE_MS + 30_000); assert.ok(venue('bybit').length >= 3, 'a replacement that never opened was never retired');
});
test('W6. neither venue sends a liquidation for LIQ_SILENCE_FAIL_MS: the collect row goes FAILED, and is re-reported at most every 5 min', (t) => {
  const { bbS, tick } = boot(t);
  for (let i = 0; i < 70; i++) { tick(20_000); bbS.msg(JSON.stringify({ op: 'pong' })); }   // 23 min of pongs, no data
  const fails = health('collect').filter((h) => !h.ok);
  assert.ok(fails.length >= 1 && /^no liquidations received for \d+ min$/.test(fails[0].detail!), 'a silent stop was not made visible: ' + JSON.stringify(fails));
  assert.ok(fails.length <= 2, 'the failure was re-reported too often: ' + fails.length);
  assert.ok(LIQ_SILENCE_FAIL_MS === 20 * 60_000);
});
test('C1. the tuned windows are the agreed ones: Bybit 60 s (it answers our ping every 20 s), Binance 10 min (47 symbols, no ping reply), silent-stop failure 20 min', () => {
  assert.equal(BYBIT_STALE_MS, 60_000); assert.equal(BINANCE_STALE_MS, 10 * 60_000); assert.equal(LIQ_SILENCE_FAIL_MS, 20 * 60_000);
});
