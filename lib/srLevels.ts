/* THE CHART'S OWN SUPPORT / RESISTANCE LEVELS, pure (moved out of components/KLineProChart.tsx so the Channel strategy reads the SAME levels the chart draws: a target the strategy names must be a line the trader can see).
 * Swing highs and lows (3 bars each side) over the last 200 bars, clustered within 0.3%, the three most-touched on each side of the current price. */
export interface SRLevel { price: number; type: 'support' | 'resistance'; touches: number; }

export function computeSRLevels(
  bars: { high: number; low: number; close: number }[],
  currentPrice: number,
): SRLevel[] {
  const lookback = 3;
  const recent = bars.slice(-200);
  const CLUSTER_PCT = 0.003;

  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = lookback; i < recent.length - lookback; i++) {
    const hi = recent[i].high;
    const lo = recent[i].low;
    if (
      recent.slice(i - lookback, i).every(b => b.high <= hi) &&
      recent.slice(i + 1, i + lookback + 1).every(b => b.high <= hi)
    ) swingHighs.push(hi);
    if (
      recent.slice(i - lookback, i).every(b => b.low >= lo) &&
      recent.slice(i + 1, i + lookback + 1).every(b => b.low >= lo)
    ) swingLows.push(lo);
  }

  const cluster = (prices: number[]) => {
    const sorted = [...prices].sort((a, b) => a - b);
    const clusters: { price: number; count: number }[] = [];
    for (const p of sorted) {
      const ex = clusters.find(c => Math.abs(c.price - p) / p < CLUSTER_PCT);
      if (ex) { ex.price = (ex.price * ex.count + p) / (ex.count + 1); ex.count++; }
      else clusters.push({ price: p, count: 1 });
    }
    return clusters.sort((a, b) => b.count - a.count);
  };

  const resistances = cluster(swingHighs)
    .filter(c => c.price > currentPrice * 0.999)
    .slice(0, 3)
    .map(c => ({ price: c.price, type: 'resistance' as const, touches: c.count }));

  const supports = cluster(swingLows)
    .filter(c => c.price < currentPrice * 1.001)
    .slice(0, 3)
    .map(c => ({ price: c.price, type: 'support' as const, touches: c.count }));

  return [...resistances, ...supports];
}
