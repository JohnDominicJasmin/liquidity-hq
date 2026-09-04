/* Which realized-liquidation clusters reach a price chart.
 *
 * THE BUG THIS EXISTS TO PREVENT. LiqFeed emits its top 100 buckets across ALL
 * COINS - `rebuild()` builds them from the whole event history and never
 * consults the `coinFilter` prop, so `onClusters` hands the consumer BTC, ETH
 * and SOL levels in one array (components/LiqFeed.tsx:132-149). The filtering
 * is the consumer's job and always has been; app/liq/page.tsx:443 does it by
 * hand. A caller that forgets draws BTC's $109,000 cluster across an ETH
 * candlestick - a well-formed line, correctly computed, about the wrong coin,
 * and nothing on screen says so.
 *
 * THE NUMBER 8 is the owner's ruling on #766 (2026-09-04): the eight heaviest
 * clusters, drawn as horizontal lines, chosen explicitly over a right-edge
 * histogram. It lives here rather than in the chart effect so a second consumer
 * cannot pick a different eight.
 *
 * WHAT THESE ARE, since the naming is the part that can go quietly wrong:
 * REALIZED liquidations - positions that already blew up, price memory, fuel
 * already spent. NOT the predicted liquidation levels Coinglass sold, which are
 * a forward magnet. The two look identical drawn on a chart, so every label
 * this feeds must say realized.
 */

export const LIQ_CLUSTER_LINES = 8;

/** The heaviest clusters for one coin, largest first.
 *
 *  Structural type rather than LiqFeed's `Bucket` so `lib/` does not import
 *  from `components/`; `Bucket` satisfies it.
 *
 *  `coin` is matched case-insensitively because the two sides spell it
 *  differently: `CoinId` is lowercase ('btc'), while a bucket's coin comes from
 *  the exchange symbol and is uppercase ('BTC').
 *
 *  Non-finite and non-positive prices are dropped rather than passed on. A
 *  chart overlay at price 0 or NaN does not throw - it draws at the axis edge
 *  or vanishes, which is the quiet kind of wrong. */
export function topClustersForCoin<T extends { coin: string; price: number; total: number }>(
  buckets: readonly T[] | null | undefined,
  coin: string,
  limit: number = LIQ_CLUSTER_LINES,
): T[] {
  if (!buckets || buckets.length === 0) return [];
  const want = coin.toLowerCase();
  return buckets
    .filter(b =>
      typeof b.coin === 'string' && b.coin.toLowerCase() === want &&
      Number.isFinite(b.price) && b.price > 0 &&
      Number.isFinite(b.total) && b.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, Math.max(0, limit));
}
