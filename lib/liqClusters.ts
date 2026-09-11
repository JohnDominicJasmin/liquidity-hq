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

/** The same clusters as one prompt line, for Quick and Deep Research (#814).
 *
 *  RETURNS 'Not available' ON PURPOSE when there is nothing, and that string is
 *  load-bearing rather than a placeholder. A fresh session has watched no
 *  liquidations, so it genuinely has no 24h window - and the alternative is
 *  handing the model an empty section under a header promising data, which is
 *  how it starts inventing levels. #637 settled this for the old dead source:
 *  a stated absence beats a blank, and beats "AI will search" even harder,
 *  since Quick mode has no tools to search with.
 *
 *  SIDE, NOT DIRECTION. Each cluster says which side was liquidated, because
 *  "longs blew up here" and "shorts blew up here" are different facts about the
 *  same price. What it must never say or imply is that price will return - see
 *  the header wording in lib/grok.ts. These are realized. */
export function formatClustersForPrompt<T extends { coin: string; price: number; total: number; longUsd: number; shortUsd: number }>(
  buckets: readonly T[] | null | undefined,
  coin: string,
  limit: number = LIQ_CLUSTER_LINES,
): string {
  const top = topClustersForCoin(buckets, coin, limit);
  if (top.length === 0) return 'Not available';
  return top
    .map(b => {
      const usd = b.total >= 1_000_000 ? `$${(b.total / 1_000_000).toFixed(1)}M`
                : b.total >= 1_000     ? `$${Math.round(b.total / 1_000)}K`
                : `$${Math.round(b.total)}`;
      const side = b.longUsd > b.shortUsd ? 'longs' : b.shortUsd > b.longUsd ? 'shorts' : 'mixed';
      return `$${b.price.toLocaleString('en-US')} ${usd} ${side}`;
    })
    .join(' | ');
}

/** Whether a consumer should commit this `onClusters` emission, given when it
 *  last committed one.
 *
 *  THE BUG THIS ENCODES A FIX FOR. `LiqFeed` runs two effects on mount, in
 *  declaration order: the coinFilter sync at LiqFeed.tsx:153 calls `rebuild()`
 *  against an EMPTY history, and only then does the seeding effect at :280 read
 *  localStorage and rebuild again with real events. So the first emission any
 *  consumer sees is `[]`, milliseconds before the real one.
 *
 *  A plain time throttle commits that empty array, starts its window, and drops
 *  the batch that actually had the clusters in it - so a page with a full 24h
 *  history renders nothing for the length of the window and then everything.
 *  On staging that was a 15-second blank, which read as "the feature does not
 *  work on a deployed build" to two separate people, including its author.
 *
 *  So the first emission that carries anything always lands. After that the
 *  window applies: the clusters accumulate over 24 hours, so redrawing faster
 *  changes nothing on screen and costs a full overlay teardown per liquidation.
 *
 *  Pure and parameterised rather than inline in the handler, because the
 *  failure is a timing one - the only way to test it is to control the clock. */
export function acceptClusterEmission(opts: {
  /** Has a non-empty batch ever been committed by this consumer? */
  hasFilled: boolean;
  /** How many clusters are in the emission being offered. */
  incoming: number;
  now: number;
  /** When this consumer last committed, in the same clock as `now`. */
  lastCommitAt: number;
  minGapMs: number;
}): boolean {
  if (!opts.hasFilled && opts.incoming > 0) return true;
  return opts.now - opts.lastCommitAt >= opts.minGapMs;
}

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

/** LiqFeed's own price-rounding tier (components/LiqFeed.tsx used to keep a
 *  private copy of this - moved here so #1075's merge threshold below is
 *  built from the actual source-data granularity, not a second guess).
 *  Every raw cluster this file receives was already snapped to one of these
 *  buckets before it got here, so two clusters a bucket-width apart are, in
 *  a real sense, already neighbours. */
export function bucketSz(price: number): number {
  if (price >= 10000) return 200;
  if (price >= 1000)  return 20;
  if (price >= 100)   return 2;
  if (price >= 10)    return 0.5;
  if (price >= 1)     return 0.1;
  return 0.01;
}

/** How many LiqFeed bucket-widths apart two clusters can be and still read
 *  as one zone (#1075).
 *
 *  FIRST TRY WAS WRONG, AND STAYING WRONG IN A COMMENT SOMEWHERE HELPS NO
 *  ONE, so it isn't kept - it's summarised here instead. The first version
 *  defined "close" as a fraction of the whole eight-cluster set's own price
 *  spread (borrowing `computeLabelOffsets`' 2.5%-of-spread idea). It failed
 *  the owner's own example the moment realistic outliers were added: with
 *  $76,000 and $83,000 also among the eight, the spread balloons, 2.5% of
 *  it shrinks below $200, and the $79,000/$79,200/$79,400 trio the owner
 *  was pointing at stopped merging. Caught by running the owner's numbers
 *  through the function before shipping, not by inspection.
 *
 *  2 bucket-widths, not 1: the owner's trio was each pairwise gap = exactly
 *  one bucket ($200 at BTC's price), so a same-bucket-only rule (1) would
 *  not have merged the example that prompted this issue. 2 bucket-widths at
 *  BTC's ~$79k price on 2026-09-08 is $400 - about 0.5% of price, matching
 *  the owner's own eyeballed percentage almost exactly. That is not a
 *  coincidence to celebrate: LiqFeed's bucket width is *why* the three
 *  clusters landed $200 apart in the first place, so deriving the merge
 *  distance from that width keeps "close" traceable to one source instead
 *  of introducing a second, unrelated definition of it. */
export const LIQ_BAND_MERGE_BUCKETS = 2;

export interface LiqBand {
  /** Total-weighted average of the merged clusters' prices. */
  price: number;
  /** Sum of the merged clusters' totals. */
  total: number;
  /** How many raw clusters merged into this band - 1 means unmerged. */
  count: number;
}

/** Collapses clusters that sit within `LIQ_BAND_MERGE_BUCKETS` bucket-widths
 *  of a neighbour into one band (#1075's owner-directed "merge nearby clusters
 *  into one band" - three lines 0.5% apart reading as a solid block on the
 *  chart).
 *
 *  CHART-DISPLAY ONLY. Deliberately not folded into `topClustersForCoin` or
 *  `formatClustersForPrompt` above: the AI prompt path needs every raw
 *  cluster with its long/short side intact (`formatClustersForPrompt`'s own
 *  docs), and merging would erase exactly that. A caller applies this to
 *  clusters already selected for the chart (see KLineProChart.tsx), never to
 *  what feeds the model.
 *
 *  Chained adjacency, same as `computeLabelOffsets`: each cluster is
 *  compared to its nearest already-merged neighbour, not to the band's
 *  first member. So $79,000 / $79,200 / $79,400 merge into one band even
 *  though $79,000-$79,400 alone (0.5%) can exceed the threshold for a wider
 *  input spread - each individual gap is what's being judged, not the
 *  total span. */
export function mergeLiqBands<T extends { price: number; total: number }>(
  clusters: readonly T[],
): LiqBand[] {
  if (clusters.length === 0) return [];
  const sorted = [...clusters].sort((a, b) => b.price - a.price);

  const bands: LiqBand[] = [];
  let members: T[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prevPrice = members[members.length - 1].price;
    const curPrice = sorted[i].price;
    const close = bucketSz((prevPrice + curPrice) / 2) * LIQ_BAND_MERGE_BUCKETS;
    if (prevPrice - curPrice < close) {
      members.push(sorted[i]);
    } else {
      bands.push(foldLiqBand(members));
      members = [sorted[i]];
    }
  }
  bands.push(foldLiqBand(members));
  return bands;
}

function foldLiqBand<T extends { price: number; total: number }>(members: T[]): LiqBand {
  const total = members.reduce((s, m) => s + m.total, 0);
  const price = total > 0
    ? members.reduce((s, m) => s + m.price * m.total, 0) / total
    : members.reduce((s, m) => s + m.price, 0) / members.length;
  return { price, total, count: members.length };
}
