/* WHAT THE CVD SWEEP ACTUALLY NEEDS FROM A SYMBOL'S RECENT TRADES (#1651, medium).
 *
 * components/MarketProvider.tsx's fetchCVD pulled every symbol's 200 raw trades (~1 MB for the whole universe) to compute three things per coin: the buy volume, the sell volume, and the trades big enough to be a whale
 * event that it has not seen yet. Those are computed here, once on the server for every visitor, and only they are sent. The browser keeps its own per-coin "last seen id" and the same `a > lastSeenId` rule, so what it
 * does with them is unchanged: `whales` carries EVERY trade at or above the threshold with its id (not only new ones - the server cannot know what a given tab has seen) and `maxId` is the newest id in the window.
 *
 * Trade shape is the route's own `{ m, q, p, a }`: `m` true means the taker SOLD (a sell), `q` base quantity, `p` price, `a` an id (negative for a Bybit-fallback trade, see the route's note). */

/** $500k single trade = whale. One definition for the sweep and the summary. */
export const WHALE_USD_THRESHOLD = 500_000;

export interface AggTrade { m: boolean; q: string; p: string; a: number }
export interface AggSummary {
  buyVol: number;
  sellVol: number;
  /** The newest (largest) trade id in the window; null for an empty window. */
  maxId: number | null;
  /** Every trade at or above the whale threshold, with its id. */
  whales: Array<{ a: number; m: boolean; q: number; p: number }>;
}

export function summarizeAggTrades(trades: readonly AggTrade[], whaleUsd = WHALE_USD_THRESHOLD): AggSummary {
  let buyVol = 0, sellVol = 0;
  let maxId: number | null = null;
  const whales: AggSummary['whales'] = [];
  for (const t of trades) {
    const qty = parseFloat(t.q);
    const price = parseFloat(t.p);
    /* A trade that does not parse counts for nothing, rather than turning the whole sum into NaN. */
    if (Number.isFinite(qty) && Number.isFinite(price)) {
      if (t.m) sellVol += qty; else buyVol += qty;
      if (price * qty >= whaleUsd) whales.push({ a: t.a, m: t.m, q: qty, p: price });
    }
    if (typeof t.a === 'number' && (maxId === null || t.a > maxId)) maxId = t.a;
  }
  return { buyVol, sellVol, maxId, whales };
}
