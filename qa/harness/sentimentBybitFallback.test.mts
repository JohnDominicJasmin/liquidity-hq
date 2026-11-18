import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installFakeFetch, loadRoute } from '../telegramWorld.mjs';

/* QA's cells for #2585 / #1651 "Sentiment extremes: Bybit BTC long/short when Binance fails, with Binance's thresholds" (PM decision 2026-11-18). The REAL cron route in-process, a fake network (qa/telegramWorld.mjs) layered with: alternative.me F&G, Bybit tickers with a BTC funding rate, and the BTC long/short ratio on each venue chosen per cell. Expectations are from the PR text: bearish extreme = F&G >= 75, funding >= +0.04 %, long share >= 60 %; bullish = F&G <= 25, funding <= -0.02 %, long share <= 40 %; Binance first, Bybit only when Binance cannot be read.
 *   B1  Binance answers (62 %): the alert uses Binance's number and Bybit's ratio endpoint is never called
 *   B2  Binance down (503) + Bybit 65 %: the alert fires on Bybit's 65.0 % / 35.0 %
 *   B3  the same thresholds on Bybit: 59.9 % no alert, 60 % alert; contrarian: 40 % alert, 40.1 % none
 *   B4  Binance answers 50 % (no extreme) while Bybit says 70 %: NO alert (Bybit is a fallback, not a second vote)
 *   B5  Binance unreadable in four ways (503, empty list, garbage number, a throw) -> falls to Bybit; Bybit unreadable (garbage, 1.5, -0.1, empty list, 503) -> nothing sent, 200, no NaN anywhere
 *   B6  both down: no sentiment message, the cron still answers 200
 *   B7  what the user reads on the fallback: the message text never shows NaN/undefined and says which venue (printed for the report) */
type World = ReturnType<typeof makeWorld>;
type Ls = 'ok' | 'down' | 'empty' | 'garbage' | 'throw';
async function scenario(o: { binance: Ls; binanceLong?: string; bybit: 'ok' | 'down' | 'garbage' | 'empty'; bybitLong?: string; fng?: string; fr?: string }) {
  const w: World = makeWorld(); w.prices = { BTCUSDT: 69_000, ETHUSDT: 1_900, SOLUSDT: 75 };
  installFakeFetch(w);
  const inner = globalThis.fetch; const calls = { binanceLs: 0, bybitLs: 0 };
  globalThis.fetch = async (input: any, init?: any) => {
    const u = new URL(String(input?.url ?? input));
    if (u.host === 'api.alternative.me') return new Response(JSON.stringify({ data: [{ value: o.fng ?? '80', value_classification: 'Extreme Greed' }] }), { status: 200 });
    if (u.host === 'api.bybit.com' && u.pathname === '/v5/market/tickers' && u.searchParams.get('category') === 'linear')
      return new Response(JSON.stringify({ retCode: 0, result: { category: 'linear', list: [{ symbol: 'BTCUSDT', lastPrice: '69000', price24hPcnt: '0.01', volume24h: '1000', turnover24h: '1000000', fundingRate: o.fr ?? '0.0005', fundingIntervalHour: '8' }] } }), { status: 200 });
    if (u.host === 'fapi.binance.com' && u.pathname === '/futures/data/globalLongShortAccountRatio' && u.searchParams.get('symbol') === 'BTCUSDT') {
      calls.binanceLs++;
      if (o.binance === 'down') return new Response('{}', { status: 503 });
      if (o.binance === 'throw') throw new Error('network down');
      if (o.binance === 'empty') return new Response('[]', { status: 200 });
      const v = o.binance === 'garbage' ? 'abc' : (o.binanceLong ?? '0.62');
      return new Response(JSON.stringify([{ longShortRatio: '1.6', longAccount: v, shortAccount: '0.38' }]), { status: 200 });
    }
    if (u.host === 'api.bybit.com' && u.pathname === '/v5/market/account-ratio' && u.searchParams.get('symbol') === 'BTCUSDT') {
      calls.bybitLs++;
      if (o.bybit === 'down') return new Response('{}', { status: 503 });
      if (o.bybit === 'empty') return new Response(JSON.stringify({ result: { list: [] } }), { status: 200 });
      const v = o.bybit === 'garbage' ? 'abc' : (o.bybitLong ?? '0.65');
      return new Response(JSON.stringify({ retCode: 0, result: { list: [{ symbol: 'BTCUSDT', buyRatio: v, sellRatio: '0.35', timestamp: '1' }] } }), { status: 200 });
    }
    return inner(input, init);
  };
  const route = await loadRoute(); const r = await route.run();
  const sent = w.telegram.sent.filter((m: { text: string }) => /Sentiment Extremes/.test(m.text)) as Array<{ chat_id: string; text: string }>;
  return { w, r, sent, calls };
}
const ls = (t: string) => t.match(/L\/S Ratio: <b>([\d.]+)% Long<\/b> \/ ([\d.]+)% Short/);

test('B1. Binance answers: its number is used and Bybit\'s ratio is never called', async () => {
  const { r, sent, calls } = await scenario({ binance: 'ok', binanceLong: '0.62', bybit: 'ok', bybitLong: '0.99' });
  assert.equal(r.status, 200); assert.ok(sent.length >= 1, 'no sentiment alert'); assert.deepEqual(ls(sent[0].text)?.slice(1, 3), ['62.0', '38.0']); assert.equal(calls.bybitLs, 0);
});
test('B2. Binance down, Bybit 65 %: the alert fires on Bybit\'s 65.0 % / 35.0 %', async () => {
  const { r, sent, calls } = await scenario({ binance: 'down', bybit: 'ok', bybitLong: '0.65' });
  assert.equal(r.status, 200); assert.ok(sent.length >= 1, 'no alert on the fallback'); assert.deepEqual(ls(sent[0].text)?.slice(1, 3), ['65.0', '35.0']); assert.equal(calls.bybitLs, 1); assert.match(sent[0].text, /All 3 Bearish/);
});
test('B3. Binance\'s thresholds on Bybit: 59.9 % none, 60 % fires; contrarian 40 % fires, 40.1 % none', { timeout: 300_000 }, async () => {
  assert.equal((await scenario({ binance: 'down', bybit: 'ok', bybitLong: '0.599' })).sent.length, 0, '59.9 % fired');
  assert.ok((await scenario({ binance: 'down', bybit: 'ok', bybitLong: '0.60' })).sent.length >= 1, '60 % did not fire');
  const bull = { fng: '20', fr: '-0.0003' };
  const at40 = await scenario({ binance: 'down', bybit: 'ok', bybitLong: '0.40', ...bull }); assert.ok(at40.sent.length >= 1, '40 % did not fire'); assert.match(at40.sent[0].text, /Contrarian BULLISH/);
  assert.equal((await scenario({ binance: 'down', bybit: 'ok', bybitLong: '0.401', ...bull })).sent.length, 0, '40.1 % fired');
});
test('B4. Binance answers with no extreme while Bybit says 70 %: no alert', async () => {
  const { sent, calls } = await scenario({ binance: 'ok', binanceLong: '0.50', bybit: 'ok', bybitLong: '0.70' }); assert.equal(sent.length, 0); assert.equal(calls.bybitLs, 0);
});
test('B5a. Binance unreadable four ways (503, empty list, garbage number, a throw) falls to Bybit', { timeout: 300_000 }, async () => {
  for (const b of ['down', 'empty', 'garbage', 'throw'] as const) { const { sent } = await scenario({ binance: b, bybit: 'ok', bybitLong: '0.65' }); assert.ok(sent.length >= 1, ); }
});
test('B5b. Bybit unreadable five ways (garbage, 1.5, -0.1, empty list, 503) sends nothing, answers 200, no NaN', { timeout: 300_000 }, async () => {
  for (const [bybit, bybitLong] of [['garbage', undefined], ['ok', '1.5'], ['ok', '-0.1'], ['empty', undefined], ['down', undefined]] as const) {
    const { r, sent, w } = await scenario({ binance: 'down', bybit, bybitLong }); assert.equal(r.status, 200); assert.equal(sent.length, 0, );
    assert.ok(!w.telegram.sent.some((m: { text: string }) => /NaN|undefined/.test(m.text)));
  }
});
test('B6. both down: no sentiment message and the cron still answers 200', async () => {
  const { r, sent } = await scenario({ binance: 'down', bybit: 'down' }); assert.equal(r.status, 200); assert.equal(sent.length, 0);
});
test('B7. the fallback message: no NaN / undefined; prints what the user reads', async () => {
  const { sent } = await scenario({ binance: 'down', bybit: 'ok', bybitLong: '0.65' });
  assert.doesNotMatch(sent[0].text, /NaN|undefined|null/); console.log('FALLBACK MESSAGE:\n' + sent[0].text.replace(/<[^>]+>/g, ''));
});
// FINDING (low): the user cannot tell the ratio came from Bybit. todo = reported, does not fail the run.
test('B7b. the fallback message names Bybit as the ratio source', { todo: 'the message is identical to the Binance one' }, async () => {
  const { sent } = await scenario({ binance: 'down', bybit: 'ok', bybitLong: '0.65' });
  assert.match(sent[0].text, /Bybit/i, 'the message does not say the ratio is from Bybit');
});
