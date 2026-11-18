import { coinKind } from '../coins.ts';
import { usCashOpen } from '../marketHours.ts';
import type { LabelKey } from '../labelKeys.ts';
import { WAIT, type StrategyDef } from './types.ts';

/* SESSION STRATEGIES ON A STOCK READ ONLY THE US CASH SESSION (PM, 2026-11-19). A tokenized stock's perpetual trades 24/7 but the stock does not, so the strategies built on a trading session (NY open breakout, session sweep, VWAP
 * reclaim) would read overnight perp prints as if they were a session. For a coin of kind `stock` they answer WAIT, with their own reason, on any candle that opened outside the US cash session (lib/marketHours.ts); every other strategy
 * and every other kind of coin is untouched. Applied once, to the registry (lib/strategies/index.ts), so the call box, the history arrows, the server read and the audit all see it. */
export const SESSION_STRATEGIES: ReadonlySet<string> = new Set(['ny_open_breakout', 'session_sweep', 'vwap_reclaim']);

export function withMarketGate(def: StrategyDef): StrategyDef {
  if (!SESSION_STRATEGIES.has(def.id)) return def;
  return {
    ...def,
    reasonKeyFor: (r): LabelKey | null => (r.params.marketClosed === true ? 'STRAT_MKT_CLOSED' : def.reasonKeyFor?.(r) ?? null),
    detect(candles, ctx) {
      if (candles.length > 0 && coinKind(ctx.coin) === 'stock' && !usCashOpen(candles[candles.length - 1].time)) return { ...WAIT, params: { marketClosed: true } };
      return def.detect(candles, ctx);
    },
  };
}
