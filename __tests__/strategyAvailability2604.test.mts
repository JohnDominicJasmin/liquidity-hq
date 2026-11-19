import test from 'node:test';
import assert from 'node:assert/strict';
import labelDefaults from '../lib/labelDefaults.en.json' with { type: 'json' };
import { STRATEGIES } from '../lib/strategies/index.ts';
import { strategyUnavailable } from '../lib/strategies/availability.ts';
import { arenaStrategyRead } from '../lib/arenaStrategyRead.ts';
import { TF_MS, unavailableByRule, HAS_FUTURES } from '../qa/fixtures/strategyAvailability.ts';

/* #2604 "A STRATEGY THAT CANNOT RUN ON THIS COIN OR TIMEFRAME SAYS SO": the availability table against QA's oracle written from the rule (qa/fixtures/strategyAvailability.ts), for every strategy x every timeframe the Arena offers x coins with futures (xau and on included: Binance trades XAUUSDT and ONUSDT) and one without (anthropic: no TRADING contract; checked against Binance exchangeInfo by audit_availability.mts). One answer feeds the call box, the menu tooltip and the server's NO READING line: all three are compared with the oracle's ONE string.
 *   AV1 the table: for each cell, available (null) or the oracle's exact English sentence; AV2 the server read: an unavailable cell is NO READING with that sentence, even with no candles; AV3 an available cell is never labelled unavailable;
 *   AV4 the unavailable cells are a fixed small set (so a new silent rule shows up here). */
const LABELS = labelDefaults as Record<string, string>;
const tEn = (key: string, vars?: Record<string, string | number>) => (LABELS[key] ?? key).replace(/\{(\w+)\}/g, (w, n) => (vars && n in vars ? String(vars[n]) : w));
const COINS = ['btc', 'eth', 'sol', 'hype', 'pepe', 'aapl', 'xau', 'on', 'anthropic'];   // anthropic: a pre-IPO row whose futures contract Binance does not trade
const ids = STRATEGIES.map((s) => s.id);
const appText = (id: string, coin: string, tfMs: number) => { const u = strategyUnavailable(id, coin, tfMs); return u ? tEn(u.reasonKey, u.vars) : null; };

test('AV1. the availability table equals the oracle for every strategy x timeframe x coin', () => {
  const diffs: string[] = [];
  for (const id of ids) for (const [tf, ms] of Object.entries(TF_MS)) for (const coin of COINS) { const a = appText(id, coin, ms), o = unavailableByRule(id, coin, ms); if (a !== o) diffs.push(`${id} ${coin} ${tf}: app ${JSON.stringify(a)} oracle ${JSON.stringify(o)}`); }
  assert.deepEqual(diffs, [], diffs.slice(0, 6).join(' | '));
});
test('AV2. the server read: an unavailable cell is NO READING with the oracle sentence, even with no candles; never a WAIT', () => {
  for (const id of ids) for (const [tf, ms] of Object.entries(TF_MS)) for (const coin of COINS) {
    const o = unavailableByRule(id, coin, ms); if (!o) continue;
    for (const candles of [null, []] as const) {
      const r = arenaStrategyRead(id, [], { coin, tf, tfMs: ms, candles: candles as never }, tEn as never)!.readings[0];
      assert.equal(r.status, 'none', `${id} ${coin} ${tf}: ${r.status}`);
      if (r.status === 'none') assert.ok(r.why.includes(o.replace(/\.$/, '')), `${id} ${coin} ${tf}: why "${r.why}" does not carry "${o}"`);
    }
  }
});
test('AV3. an available cell is never labelled unavailable (the read goes on to its own checks)', () => {
  let checked = 0;
  for (const id of ids) for (const [tf, ms] of Object.entries(TF_MS)) for (const coin of COINS) {
    if (unavailableByRule(id, coin, ms)) continue; checked++;
    const r = arenaStrategyRead(id, [], { coin, tf, tfMs: ms, candles: null }, tEn as never)!.readings[0];
    assert.equal(r.status, 'none'); if (r.status === 'none') assert.ok(!/Works on|not available for/.test(r.why), `${id} ${coin} ${tf}: an available cell says "${r.why}"`);
  }
  assert.ok(checked > 900, `CONTROL: only ${checked} available cells were checked`);
});
test('AV4. the set of unavailable (strategy, timeframe) pairs for a futures coin is exactly the written rule', () => {
  const pairs = new Set<string>();
  for (const id of ids) for (const [tf, ms] of Object.entries(TF_MS)) if (appText(id, 'btc', ms)) pairs.add(`${id}@${tf}`);
  assert.deepEqual([...pairs].sort(), ['funding_oi_squeeze@1m', 'ny_open_breakout@1d', 'ny_open_breakout@1h', 'ny_open_breakout@1m', 'ny_open_breakout@2h', 'ny_open_breakout@4h', 'session_sweep@1d', 'session_sweep@1m', 'session_sweep@2h', 'session_sweep@4h', 'vwap_reclaim@1d', 'vwap_reclaim@2h', 'vwap_reclaim@4h']);
  assert.equal(HAS_FUTURES.has('anthropic'), false, 'the oracle must keep the coin Binance does not trade as having no futures');
});
