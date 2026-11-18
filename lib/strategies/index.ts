import { LIQUIDITY_SWEEP_MSS } from './liquiditySweepMss.ts';
import { NY_OPEN_BREAKOUT } from './nyOpenBreakout.ts';
import { EMA_STACK } from './emaStack.ts';
import { SUPPLY_DEMAND } from './supplyDemand.ts';
import { BOLLINGER_SQUEEZE } from './bollingerSqueeze.ts';
import { VWAP_RECLAIM } from './vwapReclaim.ts';
import { RSI_DIVERGENCE } from './rsiDivergence.ts';
import { CHANNEL_BREAKOUT } from './channel.ts';
import { EMA_CROSS } from './emaCross.ts';
import { SR_FLIP } from './srFlip.ts';
import { RANGE_BOUNCE } from './rangeBounce.ts';
import { FAIR_VALUE_GAP } from './fairValueGap.ts';
import { BOS_FVG } from './bosFvg.ts';
import { SESSION_SWEEP } from './sessionSweep.ts';
import { FUNDING_OI_SQUEEZE } from './fundingOiSqueeze.ts';
import { CVD_ABSORPTION } from './cvdAbsorption.ts';
import type { LabelKey } from '../labelKeys.ts';
import type { StrategyDef } from './types.ts';

export type { StrategyDef, StrategyContext, StrategyResult, Verdict } from './types.ts';

/* THE ARENA'S STRATEGIES, in the order the panel lists them. Add one here and it is selectable, shown, pinged on and logged, nowhere else. */
export const STRATEGIES: readonly StrategyDef[] = [LIQUIDITY_SWEEP_MSS, NY_OPEN_BREAKOUT, EMA_STACK, SUPPLY_DEMAND, BOLLINGER_SQUEEZE, VWAP_RECLAIM, RSI_DIVERGENCE, CHANNEL_BREAKOUT, EMA_CROSS, SR_FLIP, RANGE_BOUNCE, FAIR_VALUE_GAP, SESSION_SWEEP, FUNDING_OI_SQUEEZE, CVD_ABSORPTION, BOS_FVG];
export const STRATEGY_IDS: ReadonlySet<string> = new Set(STRATEGIES.map(s => s.id));
export function findStrategy(id: string | null | undefined): StrategyDef | undefined {
  return id ? STRATEGIES.find(s => s.id === id) : undefined;
}

/* THE MENU'S GROUPS AND ONE-LINE TIPS (owner decision 2026-11-17, #1263): Beginner / Trend, Price action / SMC, Sessions (a Derivatives / Order flow group joins in phase 2). The groups only arrange the menu; the order inside a group is the order here. Every strategy is in exactly one group and has one tip saying what data it uses. */
export interface StrategyGroup { id: string; labelKey: LabelKey; ids: readonly string[] }
export const STRATEGY_GROUPS: readonly StrategyGroup[] = [
  { id: 'beginner', labelKey: 'STRATEGY_GROUP_BEGINNER', ids: ['ema_stack', 'ema_cross', 'range_bounce'] },
  { id: 'price', labelKey: 'STRATEGY_GROUP_PRICE', ids: ['liq_sweep_mss', 'supply_demand', 'sr_flip', 'fvg', 'bos_fvg', 'channel', 'rsi_divergence', 'bb_squeeze'] },
  { id: 'sessions', labelKey: 'STRATEGY_GROUP_SESSIONS', ids: ['ny_open_breakout', 'session_sweep', 'vwap_reclaim'] },
  { id: 'derivs', labelKey: 'STRATEGY_GROUP_DERIVS', ids: ['funding_oi_squeeze', 'cvd_absorption'] },
];
export const STRATEGY_TIP_KEYS: Readonly<Record<string, LabelKey>> = {
  liq_sweep_mss: 'STRAT_TIP_LIQ_SWEEP', ny_open_breakout: 'STRAT_TIP_NYOPEN', ema_stack: 'STRAT_TIP_EMASTACK', supply_demand: 'STRAT_TIP_SD', bb_squeeze: 'STRAT_TIP_BBSQ',
  vwap_reclaim: 'STRAT_TIP_VWAP', rsi_divergence: 'STRAT_TIP_RSIDIV', channel: 'STRAT_TIP_CHANNEL', ema_cross: 'STRAT_TIP_CROSS', sr_flip: 'STRAT_TIP_FLIP',
  range_bounce: 'STRAT_TIP_RANGE', fvg: 'STRAT_TIP_FVG', bos_fvg: 'STRAT_TIP_BOS_FVG', session_sweep: 'STRAT_TIP_SESSION', funding_oi_squeeze: 'STRAT_TIP_SQUEEZE', cvd_absorption: 'STRAT_TIP_CVD',
};
