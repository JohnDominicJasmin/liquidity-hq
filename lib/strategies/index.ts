import { LIQUIDITY_SWEEP_MSS } from './liquiditySweepMss';
import type { StrategyDef } from './types';

export type { StrategyDef, StrategyContext, StrategyResult, Verdict } from './types';

/* THE ARENA'S STRATEGIES, in the order the panel lists them. Add one here and it is selectable, shown, pinged on and logged, nowhere else. */
export const STRATEGIES: readonly StrategyDef[] = [LIQUIDITY_SWEEP_MSS];
export const STRATEGY_IDS: ReadonlySet<string> = new Set(STRATEGIES.map(s => s.id));
export function findStrategy(id: string | null | undefined): StrategyDef | undefined {
  return id ? STRATEGIES.find(s => s.id === id) : undefined;
}
