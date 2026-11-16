import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBinanceForceOrder, parseBybitLiquidation, coinFromSymbol, LIQ_MIN_USD } from '../lib/liqCollector.ts';

/* #2394 / #1632 item 4: liquidation collection moved to the SERVER. This replaces __tests__/liqFeedDedup.test.mts (#925), whose pins held the BROWSER's save (persistedKeysRef, the save cursor): that save is removed on purpose.
 * P: the exchange-message parsers, pure and exported (what a liquidation is, which side, the floor, the event time).
 * S: source pins (the browser never writes the table; the read, the 24 h window and the one-venue note stay; the collector is off unless LIQ_COLLECTOR=1; its upsert key is the migration's unique index; the revoke migration states
 *    its order; instrumentation starts it).
 * WHAT IT CANNOT PROVE: that rows reach the database, that the sockets connect from the production host (Binance has refused a server before), or that the revoke leaves the public read working: those are the post-deploy
 * checks on the real service (health rows liq:collect / liq:binance / liq:bybit, the row count moving, QA's anon INSERT and DELETE both refused after the revoke). */
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const NOW = 1_800_000_000_000;

const bn = (o: Record<string, unknown>, E = NOW) => JSON.stringify({ stream: 'btcusdt@forceOrder', data: { e: 'forceOrder', E, o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', q: '0.5', p: '60000', ap: '60100', X: 'FILLED', z: '0.5', T: NOW, ...o } } });
const bb = (d: Record<string, unknown>[], topic = 'allLiquidation.BTCUSDT') => JSON.stringify({ topic, type: 'snapshot', ts: NOW, data: d });

test('P1. Binance: a FILLED SELL is a LONG liquidation at the average fill price, usd = price x filled quantity', () => {
  const r = parseBinanceForceOrder(bn({}), NOW);
  assert.deepEqual(r, { coin: 'BTC', side: 'LONG', usd: 60100 * 0.5, price: 60100, source: 'BN', ts: NOW });
});
test('P2. Binance: a BUY is a SHORT liquidation; the order price is used when there is no average price', () => {
  const r = parseBinanceForceOrder(bn({ S: 'BUY', ap: '0', p: '2000', z: '10' }), NOW)!;
  assert.equal(r.side, 'SHORT'); assert.equal(r.price, 2000); assert.equal(r.usd, 20000);
});
test('P3. Binance: a message that is not a filled liquidation, is malformed or has no price/quantity gives null (never a throw)', () => {
  for (const raw of [bn({ X: 'NEW' }), bn({ ap: '0', p: '0' }), bn({ z: '0', q: '0' }), 'not json', '{}', JSON.stringify({ data: {} })]) assert.equal(parseBinanceForceOrder(raw, NOW), null, raw.slice(0, 40));
});
test('P4. the floor: a liquidation under LIQ_MIN_USD is not stored (exactly the floor is)', () => {
  assert.equal(LIQ_MIN_USD, 10_000);
  assert.equal(parseBinanceForceOrder(bn({ ap: '9999', z: '1' }), NOW), null);
  assert.ok(parseBinanceForceOrder(bn({ ap: '10000', z: '1' }), NOW));
});
test('P5. Bybit: Buy is a LONG liquidation, Sell a SHORT; several items in one message give several rows; acks and other topics give none', () => {
  const rows = parseBybitLiquidation(bb([{ T: NOW, s: 'ETHUSDT', S: 'Buy', v: '10', p: '3000' }, { T: NOW + 1, s: 'ETHUSDT', S: 'Sell', v: '10', p: '3000' }]), NOW);
  assert.deepEqual(rows.map(r => [r.coin, r.side, r.source, r.usd]), [['ETH', 'LONG', 'BB', 30000], ['ETH', 'SHORT', 'BB', 30000]]);
  assert.deepEqual(parseBybitLiquidation(JSON.stringify({ op: 'subscribe', success: true }), NOW), []);
  assert.deepEqual(parseBybitLiquidation(bb([{ T: NOW, s: 'ETHUSDT', S: 'Buy', v: '10', p: '3000' }], 'publicTrade.ETHUSDT'), NOW), []);
  assert.deepEqual(parseBybitLiquidation('garbage', NOW), []);
  assert.deepEqual(parseBybitLiquidation(bb([{ T: NOW, s: 'ETHUSDT', S: 'Buy', v: '1', p: '3000' }]), NOW), [], 'a 3,000 USD liquidation is under the floor');
});
test('P6. the exchange event time is the row time when it is sane (so a restart overlap gives the same key); one more than an hour off falls back to the receipt time', () => {
  assert.equal(parseBinanceForceOrder(bn({ T: NOW - 5_000 }), NOW)!.ts, NOW - 5_000);
  assert.equal(parseBinanceForceOrder(bn({ T: NOW - 2 * 3_600_000 }), NOW)!.ts, NOW);
  assert.equal(parseBinanceForceOrder(bn({ T: 'x' }, 0), NOW)!.ts, NOW);
});
test('P7. the symbol -> coin derivation: USDT/BUSD/USDC suffixes and the 1000x prefix come off (the same as the browser)', () => {
  assert.equal(coinFromSymbol('BTCUSDT'), 'BTC'); assert.equal(coinFromSymbol('1000PEPEUSDT'), 'PEPE'); assert.equal(coinFromSymbol('ETHBUSD'), 'ETH'); assert.equal(coinFromSymbol('SOLUSDC'), 'SOL');
});

test('S1. THE BROWSER NEVER WRITES THE TABLE: LiqFeed.tsx has no insert / upsert / update / delete call at all, and nothing on T.liq_events other than the read', () => {
  const src = strip(read('components/LiqFeed.tsx'));
  for (const verb of ['.insert(', '.upsert(', '.update(', '.delete(']) assert.equal(src.includes(verb), false, `LiqFeed.tsx still contains ${verb}`);
  const uses = src.split('T.liq_events').length - 1; assert.ok(uses >= 1, 'the history read of T.liq_events is gone');
  assert.equal(/persistedKeysRef|SB_SAVE_TS_KEY|batchKeys/.test(src), false, 'the old browser-save state is still in the component');
});
test('S2. the read stays: the same six columns, the 24 h window, ordered by ts, limited (the table every visitor loads)', () => {
  const src = strip(read('components/LiqFeed.tsx'));
  assert.ok(src.includes(".select('coin, side, usd, price, source, ts')"), 'the select changed');
  assert.ok(/\.gte\('ts', since\)/.test(src) && /\.order\('ts', \{ ascending: true \}\)/.test(src) && /\.limit\(5000\)/.test(src), 'the 24 h window / order / limit changed');
  assert.ok(/SB_WIN_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(src), 'the window is no longer 24 h');
});
test('S3. the one-venue note stays: histOnly is derived from the venues in the read, passed up through onHistoryVenues, and shown with LIQ_FEED_HISTORY_ONE_VENUE', () => {
  const src = strip(read('components/LiqFeed.tsx'));
  assert.ok(src.includes('onHistoryVenues?.(only)') && src.includes('setHistOnly(only)') && src.includes("t('LIQ_FEED_HISTORY_ONE_VENUE'"), 'the one-venue note lost a part');
  assert.ok(JSON.parse(read('lib/labelDefaults.en.json')).LIQ_FEED_HISTORY_ONE_VENUE, 'the English default is missing');
});
test('S4. the collector is OFF unless LIQ_COLLECTOR is exactly "1", starts once per process, and is started from instrumentation.ts', () => {
  const c = strip(read('lib/liqCollector.ts'));
  assert.ok(/process\.env\.LIQ_COLLECTOR\s*!==\s*'1'\)\s*return/.test(c), 'the off switch is not the first guard');
  assert.ok(c.includes('__lhqLiqCollector?.started'), 'no once-per-process guard');
  const i = strip(read('instrumentation.ts')); assert.ok(i.includes("import('@/lib/liqCollector')") && i.includes('startLiqCollector()'), 'instrumentation.ts does not start it');
});
test('S5. the upsert key is the unique index of 20261116i, in the same column order, in both the collector and both blocks of the migration; the plain-insert fallback exists', () => {
  const c = read('lib/liqCollector.ts'); const m = read('supabase/migrations/20261116i_liq_events_unique_key.sql');
  assert.ok(c.includes("onConflict: 'source,coin,ts,side,usd', ignoreDuplicates: true"), 'the upsert key changed');
  assert.equal((m.match(/\(source, coin, ts, side, usd\)/g) || []).length >= 2, true, 'the index is not on (source, coin, ts, side, usd) in both blocks');
  assert.ok(c.includes("error.code === '42P10'") && c.includes('.insert(batch)'), 'the fallback for a missing index is gone');
});
test('S6. the revoke migration keeps its ORDER warning and both blocks revoke the browser roles (INSERT must not be revoked before the collector is observed working)', () => {
  const m = read('supabase/migrations/20261116g_revoke_liq_events_anon_insert.sql');
  assert.ok(/NOT APPLIED/.test(m) && /LIQ_COLLECTOR=1 is set on the PRODUCTION service/.test(m) && /OBSERVED WORKING/.test(m), 'the order warning was removed');
  assert.equal((m.match(/revoke insert, update, delete, truncate on public\.lhq_(dev_)?liq_events from anon, authenticated;/g) || []).length, 2, 'the prod and dev blocks do not both revoke');
  assert.equal((m.match(/drop policy if exists liq_events_insert_bounded/g) || []).length, 2);
});
test('S7. the collector writes nothing to the console and reads no environment variable other than LIQ_COLLECTOR (health details are fixed words, a socket close code and a truncated error)', () => {
  const c = strip(read('lib/liqCollector.ts'));
  assert.equal(/console\.(log|error|warn)\(/.test(c), false, 'the collector writes to the console');
  assert.equal(/SERVICE_ROLE|process\.env\.(?!LIQ_COLLECTOR)/.test(c), false, 'the collector reads another env var');
});
