import type { LabelKey } from '../labelKeys.ts';
import { priceText } from '../numberFormat.ts';
import type { StrategyDef, StrategyResult } from './types.ts';

/* THE ONE-LINE REASON A STRATEGY GIVES FOR ITS CALL, in one place. The Arena's call box (components/StrategyCallBox.tsx) and the AI read's
 * strategy line (lib/arenaStrategyRead.ts) both word the call through this, so the read is handed the same sentence the trader sees. `t` is the
 * caller's label lookup: the page's t() in the browser, the shipped English labels on the server. */

type T = (key: LabelKey, vars?: Record<string, string | number>) => string;

/** The result's numbers as the reason sentence prints them: prices through priceText, counts and the EMA tag as plain integers. */
export function strategyPriceParams(r: StrategyResult | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r?.params ?? {})) if (typeof v === 'number') out[k] = k === 'tag' || k.startsWith('count') ? String(v) : priceText(v);
  return out;
}

export function strategyReasonText(def: StrategyDef, r: StrategyResult, t: T): string {
  const priceParams = strategyPriceParams(r);
  const alt = def.reasonKeyFor?.(r) ?? null;
  if (alt) return t(alt, { ...priceParams, tag: String(r.params.tag ?? '') });
  if (r.verdict === 'buy') return t(def.reasonBuyKey, priceParams);
  if (r.verdict === 'sell') return t(def.reasonSellKey, priceParams);
  return t(def.reasonWaitKey);
}
