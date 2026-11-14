import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, installFakeFetch, loadRoute } from '../telegramWorld.mjs';
import { emaArr } from '../../lib/strategyCore.ts';

/* QA's harness cells for /api/strategies/track (the Arena strategy fire log, #2307): the REAL route runs in-process against a fake network (see qa/telegramWorld.mjs): fake Binance klines for the
 * coins it evaluates, a fake Supabase that records what is written. Nothing leaves the machine; the secret is a throwaway literal. Rows must be written to lhq_alert_fires as strat_<id>_<tf>. */

const N = 260;
type K = { o: number; h: number; l: number; c: number; v: number };
/** 260 closed hourly candles on a steady uptrend (a bullish EMA stack) whose LAST closed candle pulls back to the 20 and closes above it, then one forming candle. */
function btcPullbackSeries(): K[] {
  const ks: K[] = []; let prev = 100;
  for (let i = 0; i < N; i++) { const c = 100 + i; ks.push({ o: prev, h: Math.max(prev, c) + 0.3, l: Math.min(prev, c) - 0.3, c, v: 100 }); prev = c; }
  const e20 = emaArr(ks.map(k => k.c), 20)[N - 1];
  ks[N - 1] = { ...ks[N - 1], l: e20 - 0.05 };
  ks.push({ o: prev, h: prev + 3.5, l: prev - 0.5, c: prev + 3, v: 10 });     // the forming candle
  return ks;
}
async function scenario(o: { ohlc?: Record<string, K[]> } = {}) {
  const w = makeWorld({ tables: { lhq_alert_fires: [] } }); w.anchor = Date.now(); if (o.ohlc) w.ohlc = o.ohlc;
  installFakeFetch(w);
  const route = await loadRoute('app/api/strategies/track/route.ts');
  return { w, run: route.run };
}
const strat = (w: { tables: Record<string, any[]> }) => w.tables.lhq_alert_fires.filter((r: any) => String(r.rule_key).startsWith('strat_'));

test('T1. an unauthenticated call is refused (no secret, no run)', async () => {
  const { run } = await scenario(); const r = await run(''); assert.equal(r.status, 401);
});

test('T2. a strategy fire is written as strat_<id>_<tf> with the coin, direction and the closed price, and the run reports it', async () => {
  const { w, run } = await scenario({ ohlc: { 'BTCUSDT:1h': btcPullbackSeries() } });
  const r = await run(); assert.equal(r.status, 200);
  const rows = strat(w); const ema = rows.filter((x: any) => x.rule_key === 'strat_ema_stack_1h');
  console.log(`[T2] rows=${JSON.stringify(rows.map((x: any) => `${x.rule_key}/${x.coin}/${x.dir}`))} body=${JSON.stringify(r.body).slice(0, 220)}`);
  assert.equal(ema.length, 1, 'one EMA-stack fire on BTC 1h'); assert.equal(ema[0].coin, 'btc'); assert.equal(ema[0].dir, 'long');
  assert.equal(ema[0].price_at_fire, 100 + N - 1, 'priced at the last CLOSED candle, not the forming one');
  assert.match(ema[0].label, /ema_stack buy BTC 1h/);
  assert.ok(r.body.evaluated > 0); assert.equal(r.body.fires.stored >= 1, true, JSON.stringify(r.body.fires));
});

test('T3. CONTROL: with no strategy firing anywhere, nothing is written and the run still evaluates', async () => {
  const { w, run } = await scenario(); const r = await run();
  assert.equal(r.status, 200); assert.deepEqual(strat(w), []); assert.ok(r.body.evaluated > 0);
});

test('T4. NO REPEAT: the next 15-minute tick re-detects the same signal and does not log it twice (deduplicated)', async () => {
  const { w, run } = await scenario({ ohlc: { 'BTCUSDT:1h': btcPullbackSeries() } });
  await run(); const first = strat(w).length; assert.ok(first >= 1);
  const r2 = await run();
  assert.equal(strat(w).length, first, 'a second row was written for the same signal');
  assert.ok(r2.body.fires.deduped >= 1, `deduped=${r2.body.fires.deduped}`);
});

test('T5. UNKNOWN IS NOT QUIET: a coin whose candles come back short is counted as a read failure of the pass, and the health row says so', async () => {
  const short = btcPullbackSeries().slice(-40);
  const { w, run } = await scenario({ ohlc: { 'BTCUSDT:1h': short } });
  const r = await run(); assert.equal(r.status, 200);
  assert.ok(r.body.errors.some((e: string) => /only \d+ candles/.test(e) && /btc/.test(e)), `errors: ${JSON.stringify(r.body.errors).slice(0, 200)}`);
  await new Promise(res => setTimeout(res, 2500));                          // the health write is fire-and-forget after the response
  const health = JSON.stringify((w.rpcs ?? []).filter((x: any) => /health/i.test(x.name)));
  assert.match(health, /strategies-track/); assert.match(health, /read failures/);
  assert.equal(strat(w).filter((x: any) => x.coin === 'btc' && /_1h$/.test(x.rule_key)).length, 0, 'nothing logged for the short series');
});

test('T6. the rule keys it writes are the ones the outcome resolver prices: strat_<id>_<tf> only', async () => {
  const { w, run } = await scenario({ ohlc: { 'BTCUSDT:1h': btcPullbackSeries() } }); await run();
  for (const r of strat(w)) assert.match(r.rule_key, /^strat_[a-z0-9_]+_(1m|5m|15m|30m|1h|2h|4h|1d)$/);
});
