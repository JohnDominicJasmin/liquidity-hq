import type { OHLCV } from '../strategyCore.ts';
import { nearestLevel, srPrices, swingPivots3, tradeCall } from './shared.ts';
import { WAIT, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* FUNDING + OI SQUEEZE (owner decision 2026-11-17, #1263; rules agreed with PM, QA oracle qa/fixtures/strategyFixtures2.ts). Closed candles plus LIVE values the caller supplies (ctx.fundingClass, ctx.oiChange6Pct, ctx.liqLevels).
 *  CROWDED (both must hold):
 *   1. FUNDING EXTREME FOR THIS COIN (PM, 2026-11-19; it was a fixed band, +0.05% / -0.03%, that real funding never reached in a calm month). The live funding rate is compared with the coin's OWN settled funding rates of the last 90 days
 *      (lib/strategies/liveInputs.ts fundingClassRelative): longs_heavy (the crowd is long) = the rate is above zero and at least 95% of those settlements were strictly lower than it; shorts_heavy (the crowd is short) = the rate is below zero and at
 *      least 95% of them were strictly higher. Needs 60+ settlements reaching back 30+ days (paged by time over the last 90 days); without that history the caller passes no fundingClass and the answer is "needs live data", never a guess.
 *   2. OPEN INTEREST EXTREME FOR THIS COIN (PM, 2026-11-19; it was a fixed +3% over 6 candles that BTC and ETH never reached at 15 minutes). The change in open interest over the last 6 candles of this timeframe is compared with the coin's OWN
 *      changes over every 6 candles in the OI history Binance serves (up to 500 candles of this timeframe, 30 days at most; lib/strategies/liveInputs.ts oiRelative): the live change is above zero and at least 80% of the earlier changes were
 *      strictly lower (the top 20%). Needs 120+ candles of history, one candle apart (no gap); without that the caller passes no oiExtreme and the answer is "needs live data", never a guess.
 *   A LIQUIDATION CLUSTER is NOT a condition (PM, 2026-11-19): clusters are the chart's LIVE estimate and have no history, so as a gate they could not be proven and made the strategy unfireable. A cluster within 1.5% of the price on the
 *      crowded side only ADDS a note to a signal ("Liquidation cluster near that level."), the same as the liquidity sweep strategy; it also stays a target candidate.
 *  TRIGGER: the FIRST close through the last 3-bar swing (last 20 candles before the trigger candle) AGAINST the crowd: a long crowd, a close below the last swing low (SELL); a short crowd, a close above the last swing high (BUY). The candle before was not already through. Fresh: one of the last 2 closed candles.
 *  Entry  = that close.
 *  Stop   = the swing extreme on the crowded side: the last swing HIGH for a SELL, the last swing LOW for a BUY.
 *  Target = the liquidation cluster beyond the entry in the trade's direction if it is at least one risk distance away; else the first support / resistance level at least one risk distance away; else none (no R:R).
 *  No prediction wording: it says what funding, open interest and the candles did. The live values exist only for NOW, so past candles are never marked and the server fire log does not run this strategy (it has no liquidation estimates). Missing live values answer wait with "needs live data". */

export const MIN_CANDLES = 40;
const CLUSTER_PCT = 0.015;

/** Why a WAIT is a WAIT, in the order the conditions are checked: 1 funding is not extreme for this coin, 2 open interest is not rising enough, 3 funding and open interest hold and the trigger has not happened. */
export const WHY_FUNDING = 1, WHY_OI = 2, WHY_TRIGGER = 3;

export function detectFundingOiSqueeze(candles: readonly OHLCV[], ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  if (ctx.fundingClass == null || ctx.oiExtreme == null) return { ...WAIT, params: { noLive: true } };
  if (ctx.fundingClass === 'none') return { ...WAIT, params: { why: WHY_FUNDING } };
  if (!ctx.oiExtreme) return { ...WAIT, params: { why: WHY_OI } };
  const crowdLong = ctx.fundingClass === 'longs_heavy';
  const clusters = ctx.liqLevels ?? [];
  for (const k of [n - 1, n - 2]) {
    const x = candles[k], price = x.close;
    const near = clusters.filter(p => (crowdLong ? p < price && (price - p) / price <= CLUSTER_PCT : p > price && (p - price) / price <= CLUSTER_PCT));
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
      params: { fr: ctx.fundingPct ?? 0, oi: ctx.oiChange6Pct ?? 0, swing: crowdLong ? low.p : hi.p, ...(near.length ? { liq: true } : {}) },
    });
  }
  return { ...WAIT, params: { why: WHY_TRIGGER } };
}

export const FUNDING_OI_SQUEEZE: StrategyDef = {
  id: 'funding_oi_squeeze',
  nameKey: 'STRAT_SQUEEZE_NAME',
  descKey: 'STRAT_SQUEEZE_DESC',
  reasonBuyKey: 'STRAT_SQUEEZE_BUY',
  reasonSellKey: 'STRAT_SQUEEZE_SELL',
  reasonWaitKey: 'STRAT_SQUEEZE_WAIT',
  reasonKeyFor: r => (r.params.noLive ? 'STRAT_SQUEEZE_NO_LIVE' : r.params.why === WHY_FUNDING ? 'STRAT_SQUEEZE_WAIT_FUNDING' : r.params.why === WHY_OI ? 'STRAT_SQUEEZE_WAIT_OI' : r.params.why === WHY_TRIGGER ? 'STRAT_SQUEEZE_WAIT_TRIGGER' : null),
  needsLive: true,
  minCandles: MIN_CANDLES,
  chips: [],
  logTfs: [],
  detect: detectFundingOiSqueeze,
};
