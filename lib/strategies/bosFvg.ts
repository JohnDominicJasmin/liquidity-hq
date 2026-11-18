import type { OHLCV } from '../strategyCore.ts';
import { gapTarget } from './fairValueGap.ts';
import { lastSwing, SWING } from './liquiditySweepMss.ts';
import { tradeCall } from './shared.ts';
import { WAIT, type OverlayLevel, type OverlayZone, type StrategyContext, type StrategyDef, type StrategyResult } from './types.ts';

/* BREAK OF STRUCTURE + FAIR VALUE GAP (owner request 2026-11-18, PM spec). Closed candles only. Swings are lib/strategies/liquiditySweepMss.ts's (SWING = 3 candles each side, confirmed only once
 * those candles have closed); the gap and the target rule are lib/strategies/fairValueGap.ts's.
 *  BUY:  a candle CLOSES above the latest confirmed swing high, the first close above it since that swing formed (a bullish break of structure). The leg from the latest confirmed swing low to that
 *        candle holds a bullish 3-candle gap (candle i-2's high below candle i's low; the gap is [i-2 high, i low]). The signal is the FIRST candle after the break whose low is at or below the gap's
 *        top, the gap still unfilled (no close below its bottom since it formed), closing above the gap's bottom, and that candle is the last closed candle. No return within RETURN_WINDOW candles of
 *        the break: wait.
 *  SELL: the mirror: a close below the latest confirmed swing low, a bearish gap (i-2's low above i's high; the gap is [i high, i-2 low]) in the leg from the latest swing high, the first return up
 *        into it (high at or above the bottom), still unfilled (no close above its top), closing below its top.
 *  Entry  = the signal candle's close.
 *  Stop   = the gap's far edge: the bottom of a bullish gap, the top of a bearish one.
 *  Target = fairValueGap's rule (gapTarget): the nearer of the 20-candle swing before the gap and the first support / resistance level at least one risk distance away; none means no target and no R:R.
 *  Signals, not predictions. */

export const MIN_CANDLES = 30;
export const RETURN_WINDOW = 20;

interface Setup {
  dir: 'long' | 'short';
  /** The broken swing: its index and price. */
  swing: number;
  level: number;
  /** The break-of-structure candle. */
  bos: number;
  /** The gap's third candle and its edges. */
  gap: number;
  top: number;
  bot: number;
}

/** The setups whose break of structure is candle `b`: one per gap in the leg, nearest the break first. */
function setupsAt(c: readonly OHLCV[], b: number): Setup[] {
  const out: Setup[] = [];
  for (const dir of ['long', 'short'] as const) {
    const s = lastSwing(c, b, dir === 'long' ? 'high' : 'low');
    const legStart = lastSwing(c, b, dir === 'long' ? 'low' : 'high');
    if (s < 0 || legStart < 0) continue;
    const level = dir === 'long' ? c[s].high : c[s].low;
    const through = (x: OHLCV) => (dir === 'long' ? x.close > level : x.close < level);
    if (!through(c[b]) || c.slice(s + 1, b).some(through)) continue;
    for (let i = b; i >= legStart + 2; i--) {
      if (dir === 'long' && c[i - 2].high < c[i].low) out.push({ dir, swing: s, level, bos: b, gap: i, top: c[i].low, bot: c[i - 2].high });
      if (dir === 'short' && c[i - 2].low > c[i].high) out.push({ dir, swing: s, level, bos: b, gap: i, top: c[i - 2].low, bot: c[i].high });
    }
  }
  return out;
}

export function detectBosFvg(candles: readonly OHLCV[], _ctx: StrategyContext): StrategyResult {
  const n = candles.length;
  if (n < MIN_CANDLES) return WAIT;
  const k = n - 1;
  let pending: Setup | null = null;
  for (let b = k - 1; b >= Math.max(SWING * 2 + 1, k - RETURN_WINDOW); b--) {
    for (const st of setupsAt(candles, b)) {
      const long = st.dir === 'long';
      if (candles.slice(st.gap + 1, k + 1).some(x => (long ? x.close < st.bot : x.close > st.top))) continue;   // filled
      let first = -1;
      for (let j = b + 1; j <= k; j++) if (long ? candles[j].low <= st.top : candles[j].high >= st.bot) { first = j; break; }
      if (first < 0) { if (!pending && k - b < RETURN_WINDOW) pending = st; continue; }
      if (first !== k) continue;
      const last = candles[k], entry = last.close;
      if (!Number.isFinite(entry)) continue;   // a non-finite close is never an entry (QA review of #2566)
      if (long ? !(entry > st.bot) : !(entry < st.top)) continue;
      const stop = long ? st.bot : st.top;
      const drawn = overlayParts(candles, st, k);
      return tradeCall({ ts: last.time, dir: st.dir, entry, stop, target: gapTarget(candles, st.gap, entry, stop, st.dir), params: { bos: st.level, gapLo: st.bot, gapHi: st.top }, levels: drawn.levels, zones: drawn.zones });
    }
  }
  /* WAIT: a break whose gap has not been returned to yet (and still can be, inside the window) is what the strategy is watching. */
  if (!pending) return WAIT;
  const drawn = overlayParts(candles, pending, k);
  return { ...WAIT, overlay: { levels: drawn.levels, zones: drawn.zones, lines: [], marker: null } };
}

/** The break-of-structure level (from the broken swing) and the gap box (from the gap's third candle to candle `k`). */
function overlayParts(c: readonly OHLCV[], st: Setup, k: number): { levels: OverlayLevel[]; zones: OverlayZone[] } {
  return {
    levels: [{ price: st.level, role: 'ref', fromTs: c[st.swing].time, labelKey: 'STRAT_OV_BOS' }],
    zones: [{ top: st.top, bottom: st.bot, fromTs: c[st.gap].time, toTs: c[k].time, kind: st.dir === 'long' ? 'demand' : 'supply', labelKey: 'STRAT_OV_FVG' }],
  };
}

export const BOS_FVG: StrategyDef = {
  id: 'bos_fvg',
  nameKey: 'STRAT_BOS_FVG_NAME',
  descKey: 'STRAT_BOS_FVG_DESC',
  reasonBuyKey: 'STRAT_BOS_FVG_BUY',
  reasonSellKey: 'STRAT_BOS_FVG_SELL',
  reasonWaitKey: 'STRAT_BOS_FVG_WAIT',
  minCandles: MIN_CANDLES,
  chips: [],
  logTfs: ['5m', '15m'],
  detect: detectBosFvg,
};
