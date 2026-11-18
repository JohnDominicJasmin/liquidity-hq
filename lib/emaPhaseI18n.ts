/* The EMA card's PHASE line, translated for display only.
 *
 * `StrategySignal.phase` is built in English by lib/strategyCore.ts (judgeRibbon) and lib/useEMAStrategy.ts (the selected-indicator downgrades), and the SAME string goes into the AI prompt, the
 * explain prompt and the Telegram text, so it must stay English there: the AI reads English. The card shows it through this map instead, the way EMASignal already translates the checklist labels.
 *
 * Exact-match on the sentence the engine writes. A phase this map does not know (a new sentence added to the engine) returns null and the card shows the English as written: never blank,
 * never wrong. The counter-trend flag judgeRibbon appends is split off and translated on its own. */
import type { LabelKey } from './labelKeys.ts';

export interface PhaseI18n { key: LabelKey; params?: Record<string, string>; counterSuffix: boolean }

const COUNTER = ' - counter-trend vs the daily 200 SMA';

const EXACT: Record<string, LabelKey> = {
  'In Value Zone - price pulled back to 20 EMA': 'EMA_PHASE_VALUE_ZONE_LONG',
  'Trending long - above 9 EMA': 'EMA_PHASE_TRENDING_LONG',
  'Price below 50 EMA': 'EMA_PHASE_FREEZE_LONG',
  'Between 20 and 50 EMA - ribbon aligned, not yet in entry zone': 'EMA_PHASE_BETWEEN_LONG',
  'In Value Zone - price bounced to 20 EMA': 'EMA_PHASE_VALUE_ZONE_SHORT',
  'Trending short - below 9 EMA': 'EMA_PHASE_TRENDING_SHORT',
  'Price above 50 EMA - bearish breakdown not confirmed yet': 'EMA_PHASE_FREEZE_SHORT',
  'Between 20 and 50 EMA - ribbon aligned bearish, not in entry zone': 'EMA_PHASE_BETWEEN_SHORT',
  'No clear setup': 'EMA_PHASE_NO_SETUP',
  'Loading…': 'EMA_PHASE_LOADING',
  'Selected SMA disagrees with the entry - price at or below the 12-period rolling mean, waiting': 'EMA_PHASE_SEL_SMA_LONG',
  'Selected SMA disagrees with the entry - price at or above the 12-period rolling mean, waiting': 'EMA_PHASE_SEL_SMA_SHORT',
  'Selected Bollinger disagrees with the entry - price at or below the middle band, waiting': 'EMA_PHASE_SEL_BOLL_LONG',
  'Selected Bollinger disagrees with the entry - price at or above the middle band, waiting': 'EMA_PHASE_SEL_BOLL_SHORT',
  'Selected PSAR disagrees with the entry - dot at or above price, waiting': 'EMA_PHASE_SEL_PSAR_LONG',
  'Selected PSAR disagrees with the entry - dot at or below price, waiting': 'EMA_PHASE_SEL_PSAR_SHORT',
  'Selected MACD disagrees with the entry - DIF at or below DEA, waiting': 'EMA_PHASE_SEL_MACD_LONG',
  'Selected MACD disagrees with the entry - DIF at or above DEA, waiting': 'EMA_PHASE_SEL_MACD_SHORT',
};

const DAILY_ABOVE = /^Daily above 200 SMA but (.+) ribbon not bullish$/;
const DAILY_BELOW = /^Daily below 200 SMA but (.+) ribbon not bearish$/;

export function phaseI18n(phase: string): PhaseI18n | null {
  let base = phase;
  let counterSuffix = false;
  if (base.endsWith(COUNTER)) { base = base.slice(0, -COUNTER.length); counterSuffix = true; }
  const exact = EXACT[base];
  if (exact) return { key: exact, counterSuffix };
  const a = DAILY_ABOVE.exec(base);
  if (a) return { key: 'EMA_PHASE_DAILY_ABOVE_RIBBON_NOT_BULL', params: { tf: a[1] }, counterSuffix };
  const b = DAILY_BELOW.exec(base);
  if (b) return { key: 'EMA_PHASE_DAILY_BELOW_RIBBON_NOT_BEAR', params: { tf: b[1] }, counterSuffix };
  return null;
}
