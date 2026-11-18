import type { OHLCV } from '../strategyCore.ts';
import { nearestLevel, srPrices, swingPivots3, tradeCall } from './shared.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* FUNDING + OI SQUEEZE (owner decision 2026-11-17, #1263; rules agreed with PM, QA oracle qa/fixtures/strategyFixtures2.ts). Closed candles plus LIVE values the caller supplies (ctx.fundingClass, ctx.oiChange6Pct, ctx.liqLevels).
 *  CROWDED (all three must hold):
 *   1. FUNDING EXTREME FOR THIS COIN (PM, 2026-11-19; it was a fixed band, +0.05% / -0.03%, that real funding never reached in a calm month). The live funding rate is compared with the coin's OWN settled funding rates of the last 90 days
 *      (lib/strategies/liveInputs.ts fundingClassRelative): longs_heavy (the crowd is long) = the rate is above zero and at least 95% of those settlements were strictly lower than it; shorts_heavy (the crowd is short) = the rate is below zero and at
 *      least 95% of them were strictly higher. Needs 60+ settlements reaching back 45+ days; without that history the caller passes no fundingClass and the answer is "needs live data", never a guess.
 *   2. OPEN INTEREST up at least +3% over the last 6 candles of this timeframe.
 *   3. A LIQUIDATION CLUSTER within 1.5% of the price on the crowded side (below the price for a long crowd, above it for a short crowd). Clusters are the chart's LIVE estimate and have no history: with none supplied (ctx.liqLevels absent or empty) this condition
 *      fails and the answer is a plain WAIT, not "needs live data". Conditions 1 and 2 can be replayed on past candles (scripts/strategy-signal-audit.mts); this one cannot.
 *  TRIGGER: the FIRST close through the last 3-bar swing (last 20 candles before the trigger candle) AGAINST the crowd: a long crowd, a close below the last swing low (SELL); a short crowd, a close above the last swing high (BUY). The candle before was not already through. Fresh: one of the last 2 closed candles.
 *  Entry  = that close.
 *  Stop   = the swing extreme on the crowded side: the last swing HIGH for a SELL, the last swing LOW for a BUY.
 *  Target = the liquidation cluster beyond the entry in the trade's direction if it is at least one risk distance away; else the first support / resistance level at least one risk distance away; else none (no R:R).
 *  No prediction wording: it says what funding, open interest and the candles did. The live values exist only for NOW, so past candles are never marked and the server fire log does not run this strategy (it has no liquidation estimates). Missing live values answer wait with "needs live data". */

export const MIN_CANDLES = 40;
const OI_MIN_PCT = 3;
const CLUSTER_PCT = 0.015;

export function detectFundingOiSqueeze(candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  if (ctx.fundingClass == null || ctx.oiChange6Pct == null) return { ...WAIT, params: { noLive: true } };
  if (ctx.fundingClass === 'none' || ctx.oiChange6Pct < OI_MIN_PCT) return WAIT;
  const crowdLong = ctx.fundingClass === 'longs_heavy';
  const clusters = ctx.liqLevels ?? [];
  for (const k of [n - 1, n - 2]) {
    const x = candles[k], price = x.close;
    const near = clusters.filter(p => (crowdLong ? p < price && (price - p) / price <= CLUSTER_PCT : p > price && (p - price) / price <= CLUSTER_PCT));
    if (!near.length) continue;
    const sw = swingPivots3(candles.slice(0, k), 20);
    const low = sw.lows[sw.lows.length - 1], hi = sw.highs[sw.highs.length - 1];
    if (!low || !hi) continue;
    const dir = crowdLong ? 'short' : 'long';
    if (crowdLong ? !(x.close < low.p && candles[k - 1].close >= low.p) : !(x.close > hi.p && candles[k - 1].close <= hi.p)) continue;
    const entry = x.close, stop = crowdLong ? hi.p : low.p, risk = Math.abs(stop - entry);
    if (crowdLong ? !(stop > entry) : !(stop < entry)) continue;
    const beyond = nearestLevel(clusters, entry, dir, risk);
    const target = beyond ?? nearestLevel(srPrices(candles, entry), entry, dir, risk);
    return tradeCall({
      ts: x.time, dir, entry, stop, target,
      params: { fr: ctx.fundingPct ?? 0, oi: ctx.oiChange6Pct, swing: crowdLong ? low.p : hi.p },
    });
  }
  return WAIT;
}

export const FUNDING_OI_SQUEEZE: StrategyDef = {
  id: 'funding_oi_squeeze',
  nameKey: 'STRAT_SQUEEZE_NAME',
  descKey: 'STRAT_SQUEEZE_DESC',
  reasonBuyKey: 'STRAT_SQUEEZE_BUY',
  reasonSellKey: 'STRAT_SQUEEZE_SELL',
  reasonWaitKey: 'STRAT_SQUEEZE_WAIT',
  reasonKeyFor: r => (r.params.noLive ? 'STRAT_SQUEEZE_NO_LIVE' : null),
  needsLive: true,
  minCandles: MIN_CANDLES,
  chips: [],
  logTfs: [],
  detect: detectFundingOiSqueeze,
};
