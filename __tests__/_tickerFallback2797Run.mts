/* Runner for deepTickerFallback2797.test.mts: one scenario per PROCESS, because marketSnapshotData keeps module caches and the exchange breaker remembers a ban.
 * Not a spec (`npm test` globs `__tests__/*.test.mts`). The exchanges are a stand-in `fetch`; nothing leaves the machine. Prints one line: `RESULT <json>`. */
import { BYBIT_SYMS, BINANCE_SPOT_SYMS } from '../lib/coins.ts';

type Scenario = 'ban-bybit' | 'ban-hyperliquid' | 'all-down' | 'binance-up';
const scenario = process.argv[2] as Scenario;
const calls = { binanceTicker: 0, bybitTickers: 0, hyperliquid: 0 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* Hyperliquid's [meta, ctxs]. BTC deliberately differs from Bybit's BTC, so a row shows which venue served it. SOL has no previous-day price and XRP no volume: both must be left out. */
const HL = [
  { universe: [{ name: 'BTC' }, { name: 'ETH' }, { name: 'kPEPE' }, { name: 'SOL' }, { name: 'XRP' }] },
  [
    { markPx: '100', prevDayPx: '80', dayNtlVlm: '5000' },
    { markPx: '45', prevDayPx: '50', dayNtlVlm: '0' },
    { markPx: '0.012', prevDayPx: '0.010', dayNtlVlm: '7000' },
    { markPx: '9', dayNtlVlm: '1' },
    { markPx: '2', prevDayPx: '1' },
  ],
];
const bybitRow = (symbol: string) => ({ symbol, lastPrice: symbol === 'BTCUSDT' ? '200' : '3', price24hPcnt: '0.01', highPrice24h: '210', lowPrice24h: '190', turnover24h: '900' });

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const host = url.host;
  if (/^(api[0-9]?|fapi[0-9]?)\.binance\.com$/.test(host)) {
    if (url.pathname.endsWith('/ticker/24hr')) {
      calls.binanceTicker++;
      if (scenario !== 'binance-up') return json(418, {});
      return json(200, Object.values(BINANCE_SPOT_SYMS).map((symbol) => ({ symbol, lastPrice: '300', priceChangePercent: '1', highPrice: '310', lowPrice: '290', quoteVolume: '10' })));
    }
    if (url.pathname.endsWith('/ping')) return scenario === 'all-down' ? json(418, {}) : json(200, {});
    return json(418, {});
  }
  if (host === 'api.bybit.com') {
    if (url.pathname === '/v5/market/tickers') {
      calls.bybitTickers++;
      if (scenario === 'ban-bybit') return json(200, { retCode: 0, result: { list: [bybitRow('BTCUSDT'), bybitRow('1000PEPEUSDT')] } });
      if (scenario === 'binance-up') return json(200, { retCode: 0, result: { list: Object.values(BYBIT_SYMS).map((s) => bybitRow(s as string)) } });
      return json(403, {});
    }
    return scenario === 'all-down' ? json(403, {}) : json(200, { retCode: 0, result: { list: [] } });
  }
  if (host === 'api.hyperliquid.xyz') {
    calls.hyperliquid++;
    return scenario === 'all-down' ? json(500, {}) : json(200, HL);
  }
  return json(404, {});
}) as typeof fetch;

const { marketSnapshotData } = await import('../lib/marketSnapshotData.ts');
const res = await marketSnapshotData();
let numbers: { ok: boolean } | null = null;
if (scenario === 'all-down') numbers = await (await import('../lib/arenaServerNumbers.ts')).arenaServerNumbers('btc');
const out = res.ok
  ? { ok: true, partial: res.data.partial, viaFallback: res.data.viaFallback.ticker ?? [], ticker: res.data.ticker, calls }
  : { ok: false, calls, numbersOk: numbers?.ok };
process.stdout.write(`\nRESULT ${JSON.stringify({ ...out, numbersOk: numbers?.ok })}\n`, () => process.exit(0));
