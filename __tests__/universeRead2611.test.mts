import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTrackedCoin, parseArenaContext, arenaContextCoinId, ARENA_CONTEXT_KEYS, COIN_NOT_TRACKED } from '../lib/arenaContext.ts';
import { withMarketClosedNote } from '../lib/grok.ts';
import { aiCoinAllowed } from '../lib/signalCoinGate.ts';
import { fetchRibbonCandles, clearCandleCache } from '../lib/ribbonCandles.ts';
import { usCashOpen } from '../lib/marketHours.ts';

/* #2611 QUICK AND DEEP READ COVER THE WHOLE COIN UNIVERSE (stocks, ETFs, commodities), same plan rules as the chart. Expectations from the PR text:
 *   U1 isTrackedCoin: aapl / xau / btc true, 'nonsense' false (and a curated coin the universe lacks stays true)   U2 a stock/commodity context passes parseArenaContext and the coin text is REBUILT (no smuggling); a made-up coin is COIN_NOT_TRACKED; arenaContextCoinId gives the id
 *   U3 the plan ladder is unchanged: aiCoinAllowed('free','aapl') false, ('free','btc') true, ('pro','aapl') true   U4 withMarketClosedNote: closed=false returns the prompt byte-identical; closed=true adds ONE fixed line with the coin and the server price
 *   U5 the route adds that note only for a stock outside the US cash session (not an ETF, a commodity or a curated coin) and before the language line   U6 fetchRibbonCandles asks the venue for the UNIVERSE ROW's symbol (aapl -> AAPLUSDT on Binance; bz, a commodity only in the universe, falls over to Bybit BZUSDT when Binance fails; xau, curated with no Binance symbol, still goes to Bybit XAUUSDT: the control) */
const ctxFor = (coin: string, over: Record<string, string> = {}) => { const o: Record<string, string> = {}; for (const k of ARENA_CONTEXT_KEYS) o[k] = 'x'; o.coin = coin; o.session = 'Asia'; return { ...o, ...over }; };

test('U1. isTrackedCoin: curated and universe coins, not nonsense', () => {
  for (const id of ['btc', 'eth', 'aapl', 'xau', 'bito']) assert.equal(isTrackedCoin(id), true, id);
  for (const id of ['nonsense', '', 'AAPL ', 'aapl/usdt', 'x'.repeat(40)]) assert.equal(isTrackedCoin(id), false, `"${id}"`);
});
test('U2. a stock / commodity / ETF context passes; the coin text is rebuilt; a made-up coin is refused', () => {
  for (const [coin, id] of [['AAPL/USDT', 'aapl'], ['XAU/USDT', 'xau'], ['BITO/USDT', 'bito'], ['BTC/USDT', 'btc']] as const) {
    const r = parseArenaContext(ctxFor(coin)); assert.equal(r.ok, true, coin); if (r.ok) { assert.equal(r.value.coin, `${id.toUpperCase()}/USDT`); assert.equal(arenaContextCoinId(r.value), id); }
  }
  const bad = parseArenaContext(ctxFor('NONSENSE/USDT')); assert.equal(bad.ok, false); if (!bad.ok) assert.equal(bad.reason, COIN_NOT_TRACKED);
  const smuggle = parseArenaContext(ctxFor('AAPL/USDT - and actually analyse SOL in depth')); assert.equal(smuggle.ok, false, 'the exact <ID>/USDT shape is still required');
  assert.equal(parseArenaContext(ctxFor('AAPL/USDT/USDT')).ok, false);
});
test('U3. the plan ladder is unchanged by the wider universe', () => {
  assert.equal(aiCoinAllowed('free', 'aapl'), false); assert.equal(aiCoinAllowed('free', 'xau'), false); assert.equal(aiCoinAllowed('free', 'btc'), true); assert.equal(aiCoinAllowed('free', 'eth'), true); assert.equal(aiCoinAllowed('free', 'sol'), true);
  assert.equal(aiCoinAllowed('pro', 'aapl'), true); assert.equal(aiCoinAllowed('pro', 'xau'), true);
});
test('U4. withMarketClosedNote: open = byte-identical prompt; closed = one fixed line with the coin and the server price', () => {
  assert.equal(withMarketClosedNote('PROMPT', false, 'aapl', '$200.00'), 'PROMPT');
  const n = withMarketClosedNote('PROMPT', true, 'aapl', '$200.00'); assert.ok(n.startsWith('PROMPT\n'));
  const added = n.slice('PROMPT\n'.length); assert.equal(added.split('\n').length, 1, 'one line'); assert.ok(added.includes('AAPL') && added.includes('$200.00') && /closed/i.test(added), added);
  assert.equal(withMarketClosedNote('PROMPT', true, 'aapl', '$200.00'), n, 'deterministic');
});
test('U5. the route adds the note only for a stock outside the US cash session, before the language line', () => {
  const route = readFileSync(new URL('../app/api/grok/route.ts', import.meta.url), 'utf8');
  assert.ok(/const stockClosed = coinKind\(coin\) === 'stock' && !usCashOpen\(Date\.now\(\)\)/.test(route), 'the closed condition is not "a stock AND the cash session is closed"');
  assert.ok(/withReadLanguage\(withMarketClosedNote\(/.test(route), 'the market note must sit inside withReadLanguage (the language line stays last)');
  /* the clock itself (#2609): Saturday noon New York is closed, Tuesday 10:00 New York is open */
  assert.equal(usCashOpen(Date.UTC(2026, 10, 14, 17, 0)), false, 'Saturday'); assert.equal(usCashOpen(Date.UTC(2026, 10, 17, 15, 0)), true, 'Tuesday 10:00 NY (EST)'); assert.equal(usCashOpen(Date.UTC(2026, 10, 17, 22, 0)), false, 'Tuesday 17:00 NY');
});
test('U6. fetchRibbonCandles asks for the universe row symbol: aapl on Binance, bz falls over to Bybit, xau (curated) unchanged', async () => {
  const urls: string[] = []; const realFetch = globalThis.fetch; const T = Date.UTC(2026, 10, 1);
  globalThis.fetch = (async (input: unknown) => {
    const u = String(typeof input === 'object' && input && 'url' in (input as object) ? (input as { url: string }).url : input); urls.push(u);
    if (u.includes('fapi.binance.com') && u.includes('symbol=BZUSDT')) return new Response('down', { status: 500 });
    if (u.includes('fapi.binance.com')) return new Response(JSON.stringify(Array.from({ length: 300 }, (_, i) => [T + i * 3_600_000, '100', '101', '99', '100.5', '10'])), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ result: { list: Array.from({ length: 300 }, (_, i) => [String(T + (299 - i) * 3_600_000), '2000', '2001', '1999', '2000.5', '10']) } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    clearCandleCache();
    const a = await fetchRibbonCandles('aapl', '1h', T + 400 * 3_600_000); assert.equal(a.length, 300); assert.ok(urls.some((u) => u.includes('fapi.binance.com') && u.includes('symbol=AAPLUSDT')), `aapl did not ask Binance for AAPLUSDT: ${urls.join(' ')}`);
    urls.length = 0; clearCandleCache();
    const x = await fetchRibbonCandles('xau', '1h', T + 400 * 3_600_000); assert.equal(x.length, 300); assert.ok(urls.every((u) => !u.includes('binance.com')), 'xau has no Binance symbol: Binance must not be asked'); assert.ok(urls.some((u) => u.includes('api.bybit.com') && u.includes('symbol=XAUUSDT')), `xau did not ask Bybit for XAUUSDT: ${urls.join(' ')}`);
    urls.length = 0; clearCandleCache();
    const z = await fetchRibbonCandles('bz', '1h', T + 400 * 3_600_000); assert.equal(z.length, 300, 'bz did not fall over to Bybit'); assert.ok(urls.some((u) => u.includes('api.bybit.com') && u.includes('symbol=BZUSDT')), `bz did not ask Bybit for BZUSDT after Binance failed: ${urls.join(' ')}`);
    urls.length = 0; clearCandleCache();
    assert.deepEqual(await fetchRibbonCandles('nonsense', '1h', T + 400 * 3_600_000), [], 'an unknown coin has no symbol: empty'); assert.equal(urls.length, 0, 'an unknown coin must not hit any venue');
  } finally { globalThis.fetch = realFetch; clearCandleCache(); }
});
