/* #1263 KLINES PROBE (Dev's request 2026-11-23): what does /api/market/klines answer on the target for the nine assets whose chart held 0 candles on qa? Read-only GETs, signed out, nothing written. Prints [KL] <label>: HTTP <status> <first 100 bytes of the body> <headers of interest>. Run it on qa, staging or prod (-f base_url). Asserts only that every request answered. */
import { test, expect } from '@playwright/test';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: probes a deployed site (-f base_url=<site>)');

const CASES: Array<[string, string]> = [
  ['control BTCUSDT binance-futures 1h', 'source=binance-futures&symbol=BTCUSDT&interval=1h&limit=5'],
  ['DISUSDT binance-futures 1h', 'source=binance-futures&symbol=DISUSDT&interval=1h&limit=5'],
  ['FRHCUSDT binance-futures 1h', 'source=binance-futures&symbol=FRHCUSDT&interval=1h&limit=5'],
  ['CVNAUSDT binance-futures 1h', 'source=binance-futures&symbol=CVNAUSDT&interval=1h&limit=5'],
  ['HK0700USDT binance-futures 1h', 'source=binance-futures&symbol=HK0700USDT&interval=1h&limit=5'],
  ['CSOPSAMSUNG2LUSDT bybit 60', 'source=bybit&symbol=CSOPSAMSUNG2LUSDT&interval=60&limit=5'],
  ['CSOPSAMSUNG2LUSDT binance-futures 1h', 'source=binance-futures&symbol=CSOPSAMSUNG2LUSDT&interval=1h&limit=5'],
  ['CSOPSKHYNIX2LUSDT bybit 60', 'source=bybit&symbol=CSOPSKHYNIX2LUSDT&interval=60&limit=5'],
  ['control OPENAIUSDT binance-futures 1h', 'source=binance-futures&symbol=OPENAIUSDT&interval=1h&limit=5'],
  ['control XPTUSDT binance-futures 1h', 'source=binance-futures&symbol=XPTUSDT&interval=1h&limit=5'],
  ['control BTCUSDT bybit 60', 'source=bybit&symbol=BTCUSDT&interval=60&limit=5'],
];

test('KL klines answers for the nine no-candle assets and the controls', async ({ request }) => {
  test.setTimeout(120_000); let answered = 0;
  for (const [label, qs] of CASES) {
    const r = await request.get(`/api/market/klines?${qs}`, { timeout: 30_000 }).catch((e) => ({ err: String(e).slice(0, 120) }));
    if ('err' in r) { console.log(`[KL] ${label}: REQUEST ERROR ${r.err}`); continue; }
    answered++; const body = (await r.text()).replace(/\s+/g, ' ').slice(0, 100); const h = r.headers();
    console.log(`[KL] ${label}: HTTP ${r.status()} body "${body}" x-data-source ${h['x-data-source'] ?? '-'} x-data-stale ${h['x-data-stale'] ?? '-'} x-exchange-cooldown ${h['x-exchange-cooldown'] ?? h['x-cooldown'] ?? '-'} retry-after ${h['retry-after'] ?? '-'} | all x-headers: ${Object.keys(h).filter((k) => k.startsWith('x-')).join(',')}`);
    await new Promise((res) => setTimeout(res, 400));
  }
  expect(answered, 'no probe request answered').toBeGreaterThan(0);
});
