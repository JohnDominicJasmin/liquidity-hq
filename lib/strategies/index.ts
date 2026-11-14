import { LIQUIDITY_SWEEP_MSS } from './liquiditySweepMss.ts';
import { NY_OPEN_BREAKOUT } from './nyOpenBreakout.ts';
import { EMA_STACK } from './emaStack.ts';
import { SUPPLY_DEMAND } from './supplyDemand.ts';
import type { StrategyDef } from './types.ts';

export type { StrategyDef, StrategyContext, StrategyResult, Verdict } from './types.ts';

/* THE ARENA'S STRATEGIES, in the order the panel lists them. Add one here and it is selectable, shown, pinged on and logged, nowhere else. */
export const STRATEGIES: readonly StrategyDef[] = [LIQUIDITY_SWEEP_MSS, NY_OPEN_BREAKOUT, EMA_STACK, SUPPLY_DEMAND];
export const STRATEGY_IDS: ReadonlySet<string> = new Set(STRATEGIES.map(s => s.id));
export function findStrategy(id: string | null | undefined): StrategyDef | undefined {
  return id ? STRATEGIES.find(s => s.id === id) : undefined;
}
