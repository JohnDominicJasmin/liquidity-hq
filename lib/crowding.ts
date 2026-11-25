/* ONE RULE AND ONE UNIT FOR "CROWDED LONGS / SHORTS" IN WHAT THE AI IS TOLD (#1651).
 *
 * The unit is the long/short account ratio, x:1. One side is crowded when it outnumbers the other by more than 1.8 to 1: above 1.8:1 for
 * longs, below 0.55:1 for shorts. The prompts used 0.8, 0.6 and 0.5 for crowded shorts and 60% (1.5:1) for the label beside the figure. */

export const CROWDED_LONGS_ABOVE = 1.8;
export const CROWDED_SHORTS_BELOW = 0.55;

export type Crowd = 'longs' | 'shorts' | null;

/** Which side is crowded, from the two shares (0..1). Null when neither is, or the ratio cannot be formed. */
export function crowdedSide(long: number, short: number): Crowd {
  if (!(long >= 0) || !(short > 0)) return null;
  const ratio = long / short;
  return ratio > CROWDED_LONGS_ABOVE ? 'longs' : ratio < CROWDED_SHORTS_BELOW ? 'shorts' : null;
}

/** "(L/S 1.22:1) (balanced)", the same words wherever the figure is given to the AI. Empty when the ratio cannot be formed. */
export function ratioNote(long: number, short: number): string {
  if (!(long >= 0) || !(short > 0)) return '';
  const side = crowdedSide(long, short);
  return ` (L/S ${(long / short).toFixed(2)}:1)` + (side === 'longs' ? ' (overleveraged longs)' : side === 'shorts' ? ' (overleveraged shorts)' : ' (balanced)');
}
