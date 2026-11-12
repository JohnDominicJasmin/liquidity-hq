/* Keeps the liquidation ("REALIZED") price tag clear of a support/resistance tag that sits close to it.
 *
 * WHY THIS EXISTS (#1263, PM's Draw Structure shots). Both tags are drawn at the chart's right edge since
 * #1075 moved the liquidation tag there to match the S/R tag, and each layer stacks its OWN tags with its own
 * pass of `computeLabelOffsets` (components/KLineProChart.tsx). Neither pass sees the other layer, so when a
 * liquidation band sits at nearly the same price as an S/R level - "R $74,793" and "REALIZED $81K" - the two
 * tags are painted on top of each other and the later one clips the earlier. The component's own comment
 * records it as a KNOWN GAP of #1075.
 *
 * THE NARROW FIX: leave the S/R tags exactly where they are, and let only the liquidation tag yield. A band
 * that is "close" to an S/R level lifts by that level's own stack offset plus one tag step, which puts its tag
 * directly above the S/R tag whichever of the two prices is higher. Deterministic and derived from the PRICES,
 * never from live pixel positions, for the reason computeLabelOffsets gives: pixel y exists only inside the
 * repaint, and a check made there would answer differently between repaints and make the tags jitter.
 *
 * "CLOSE" IS THE SAME TEST computeLabelOffsets USES - 2.5% of the price spread - taken over both layers
 * together, so a band and a level that would stack if they were in one layer stack here too. */
export const LABEL_STEP_PX = 13;

export function liftClearOfLevels(
  bandOffsets: ReadonlyMap<number, number>,
  bands: ReadonlyArray<{ price: number }>,
  levels: ReadonlyArray<{ price: number }>,
  levelOffsets: ReadonlyMap<number, number>,
): Map<number, number> {
  const out = new Map(bandOffsets);
  if (bands.length === 0 || levels.length === 0) return out;
  const prices = [...bands, ...levels].map(x => x.price).filter(Number.isFinite);
  if (prices.length < 2) return out;
  const spread = Math.max(...prices) - Math.min(...prices);
  const CLOSE = Math.max(spread * 0.025, 1e-9);
  for (const b of bands) {
    let lift = -1;
    for (const l of levels) {
      if (Math.abs(l.price - b.price) < CLOSE) lift = Math.max(lift, levelOffsets.get(l.price) ?? 0);
    }
    if (lift >= 0) out.set(b.price, (bandOffsets.get(b.price) ?? 0) + lift + LABEL_STEP_PX);
  }
  return out;
}
