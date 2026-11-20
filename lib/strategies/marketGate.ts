import { coinKind } from '../coins.ts';
import { usCashOpen } from '../marketHours.ts';
import type { LabelKey } from '../labelKeys.ts';
import type { OHLCV } from '../strategyCore.ts';
import { WAIT, type StrategyDef, type StrategyOverlay } from './types.ts';

/* SESSION STRATEGIES ON A STOCK READ ONLY THE US CASH SESSION (PM, 2026-11-19). A tokenized stock's perpetual trades 24/7 but the stock does not, so the strategies built on a trading session (NY open breakout, session sweep, VWAP
 * reclaim) would read overnight perp prints as if they were a session. For a coin of kind `stock` they answer WAIT, with their own reason, on any candle that opened outside the US cash session (lib/marketHours.ts); every other strategy
 * and every other kind of coin is untouched. US MARKET HOLIDAYS ARE NOT MODELLED (PM, 2026-11-19: fine for now): on one the perp trades and the cash session reads as open (lib/marketHours.ts). Applied once, to the registry (lib/strategies/index.ts), so the call box, the history arrows, the server read and the audit all see it. */
export const SESSION_STRATEGIES: ReadonlySet<string> = new Set(['ny_open_breakout', 'session_sweep', 'vwap_reclaim']);

/* THE VWAP OF THE LAST US CASH SESSION STILL DRAWS WHILE THE MARKET IS CLOSED (QA drawings audit #1263: vwap_reclaim on AAPL / TSLA at 1m-30m drew nothing, only the reason line; PM's rule: a selected strategy draws what it watches). The line is the volume-weighted average
 * of the typical price over the most recent run of consecutive candles that opened inside the cash session, anchored at that session's first candle: the level the strategy reads when the market opens. Nothing when that run holds fewer than two candles or no volume. */
function lastSessionVwapLine(candles: readonly OHLCV[]): StrategyOverlay['lines'][number] | null {
  let end = candles.length - 1;
  while (end >= 0 && !usCashOpen(candles[end].time)) end--;
  if (end < 0) return null;
  let start = end;
  while (start - 1 >= 0 && usCashOpen(candles[start - 1].time) && candles[start].time - candles[start - 1].time <= 3_600_000) start--;
  const points: Array<{ ts: number; price: number }> = [];
  let pv = 0, vol = 0;
  for (let i = start; i <= end; i++) {
    const c = candles[i], v = c.volume > 0 ? c.volume : 0;
    pv += ((c.high + c.low + c.close) / 3) * v; vol += v;
    if (vol > 0) points.push({ ts: c.time, price: pv / vol });
  }
  return points.length >= 2 ? { points, role: 'ref', labelKey: 'STRAT_OV_VWAP' } : null;
}

export function withMarketGate(def: StrategyDef): StrategyDef {
  if (!SESSION_STRATEGIES.has(def.id)) return def;
  return {
    ...def,
    reasonKeyFor: (r): LabelKey | null => (r.params.marketClosed === true ? 'STRAT_MKT_CLOSED' : def.reasonKeyFor?.(r) ?? null),
    detect(candles, ctx) {
      if (candles.length > 0 && coinKind(ctx.coin) === 'stock' && !usCashOpen(candles[candles.length - 1].time)) {
        const line = def.id === 'vwap_reclaim' ? lastSessionVwapLine(candles) : null;
        return { ...WAIT, params: { marketClosed: true }, ...(line ? { overlay: { levels: [], zones: [], lines: [line], marker: null } } : {}) };
      }
      return def.detect(candles, ctx);
    },
  };
}
