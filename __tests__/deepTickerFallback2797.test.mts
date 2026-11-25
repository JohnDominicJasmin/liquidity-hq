/* QA: PR #2797 (#1651 item 6), Deep's 24h ticker falls back to other venues when Binance refuses. The REAL marketSnapshotData runs against a stand-in network, one process per scenario (_tickerFallback2797Run.mts).
 *   T1 a Binance 418 on the ticker call (pings still 200) no longer ends the build: Bybit fills the ticker and viaFallback names those coins; Hyperliquid only fills what BOTH missed
 *   T2 Binance 418 and Bybit 403: Hyperliquid serves price, 24h change and USD volume, per token (kPEPE), with NO high or low keys (never 0); a row without a previous-day price or a volume is left out
 *   T3 every venue down: the snapshot is not ok and arenaServerNumbers refuses (so Deep answers unavailable instead of inventing numbers)
 *   T4 Binance answering: Binance serves the ticker and Hyperliquid is not called
 *   T5 the browser's first paint sets high and low only when the row has both
 * WHAT IT CANNOT PROVE: that any venue answers from the deployed server's address (the Deep canary does that). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Row = { price: number; change: number; high?: number; low?: number; vol24: number };
type Result = { ok: boolean; partial: string[]; viaFallback: string[]; ticker: Record<string, Row>; calls: { binanceTicker: number; bybitTickers: number; hyperliquid: number }; numbersOk?: boolean };
const root = fileURLToPath(new URL('..', import.meta.url));
function run(scenario: string): Result {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; delete env.NEXT_PUBLIC_SUPABASE_URL; delete env.SUPABASE_SERVICE_ROLE_KEY;
  const out = execFileSync(process.execPath, ['--import', './qa/alias-register.mjs', '__tests__/_tickerFallback2797Run.mts', scenario], { cwd: root, env, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const line = out.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, `CONTROL: the ${scenario} run printed no result`);
  return JSON.parse(line.slice(7)) as Result;
}

test('T1. a Binance ban on the ticker call is a miss, not the end: Bybit fills the ticker', () => {
  const r = run('ban-bybit');
  assert.ok(r.calls.binanceTicker >= 1, 'CONTROL: Binance was never asked');
  assert.equal(r.ok, true); assert.ok(!r.partial.includes('ticker'), `partial: ${r.partial}`);
  assert.equal(r.ticker.btc?.price, 200, 'BTC is Bybit\'s figure, not Hyperliquid\'s 100');
  assert.equal(r.ticker.btc?.high, 210); assert.equal(r.ticker.btc?.low, 190);
  assert.ok(r.viaFallback.includes('btc') && r.viaFallback.includes('pepe'), `viaFallback.ticker: ${r.viaFallback}`);
  assert.equal(r.ticker.eth?.price, 45, 'ETH, missed by both, comes from Hyperliquid');
  assert.equal(r.viaFallback.filter((c) => c === 'btc').length, 1);
});

test('T2. Binance and Bybit refusing: Hyperliquid rows have price, change and volume, no high or low, per token', () => {
  const r = run('ban-hyperliquid');
  assert.ok(r.calls.bybitTickers >= 1 && r.calls.hyperliquid === 1, `CONTROL: calls ${JSON.stringify(r.calls)}`);
  assert.equal(r.ok, true); assert.ok(!r.partial.includes('ticker'), `partial: ${r.partial}`);
  assert.equal(r.ticker.btc?.price, 100); assert.equal(Math.round((r.ticker.btc?.change ?? NaN) * 1e6) / 1e6, 25); assert.equal(r.ticker.btc?.vol24, 5000);
  assert.equal(r.ticker.eth?.vol24, 0, 'a real zero volume stays'); assert.equal(Math.round((r.ticker.eth?.change ?? NaN) * 1e6) / 1e6, -10);
  assert.equal(Math.round((r.ticker.pepe?.price ?? 0) * 1e9), 12000, 'kPEPE per token is 0.000012'); assert.equal(Math.round((r.ticker.pepe?.change ?? NaN) * 1e6) / 1e6, 20);
  for (const [coin, row] of Object.entries(r.ticker)) assert.ok(!('high' in row) && !('low' in row), `${coin} carries a high or low this venue never sends`);
  assert.equal(r.ticker.sol, undefined, 'no previous-day price: left out'); assert.equal(r.ticker.xrp, undefined, 'no volume: left out');
  assert.deepEqual([...r.viaFallback].sort(), Object.keys(r.ticker).sort());
});

test('T3. every venue down: no snapshot, and the server numbers are refused', () => {
  const r = run('all-down');
  assert.equal(r.ok, false); assert.equal(r.numbersOk, false);
});

test('T4. Binance answering: it serves the ticker and Hyperliquid is not asked', () => {
  const r = run('binance-up');
  assert.equal(r.ok, true); assert.equal(r.ticker.btc?.price, 300);
  assert.ok(!r.viaFallback.includes('btc'), 'a Binance row is named as a fallback');
  assert.equal(r.calls.hyperliquid, 0, `Hyperliquid was called ${r.calls.hyperliquid} time(s) with nothing missing`);
});

test('T5. the first paint sets high and low only when the snapshot row has both', () => {
  const src = readFileSync(new URL('../components/MarketProvider.tsx', import.meta.url), 'utf8');
  assert.ok(/if \(v\.high != null && v\.low != null\) \{ patch\.high = v\.high; patch\.low = v\.low; \}/.test(src), 'the guard is gone: a row without them would write undefined over the store');
  assert.ok(!/patch\.change = v\.change; patch\.high = v\.high/.test(src), 'high is written unguarded');
});
