/* When does a saved price alert count as hit? (#1626)
 *
 * THE GAP THIS CLOSES. The alert cron runs every 5 minutes and used to compare each alert only against the LAST price at that instant. A wick that
 * crossed the target and came back inside the same 5 minutes was never seen: the alert stayed armed and the user, who watched the level trade on the
 * chart, never got the message. Now the cron also reads the last few 1-minute candles of each coin that has a still-armed alert and counts a
 * candle's high (for "above") or low (for "below") as a touch.
 *
 * WHAT IS CHECKED, AND WHAT IS NOT.
 *   - A candle only counts if it STARTED after the minute the alert was created: a wick from before the user set the alert must not fire it.
 *     An alert with no readable created_at gets no wick check (the safe reading: the live-price rule alone, exactly as before).
 *   - The window is the candles the caller passes (the cron reads the last 15 one-minute candles, three cron periods), so a touch older than that
 *     with the price now back inside is still missed. That is a stated bound, not a guarantee of every touch.
 *   - Wicks are 1-minute resolution: a spike inside a single minute is caught (that minute's high/low includes it), but only to the minute.
 *
 * Pure on purpose: no network, no clock, so the rule is testable without the cron route (which cannot export helpers, see its own note). */

export interface PriceAlertLike { direction: string; target_price: number; created_at?: string | null }
export interface Candle1m { startMs: number; high: number; low: number }

export type AlertTouch =
  | { via: 'price'; price: number }
  | { via: 'wick'; level: number; atMs: number };

export function evaluatePriceAlert(alert: PriceAlertLike, lastPrice: number | null, candles: readonly Candle1m[]): AlertTouch | null {
  const above = alert.direction === 'above';
  const below = alert.direction === 'below';
  if (!above && !below) return null;
  const target = alert.target_price;

  // The live price first: the rule the cron has always applied.
  if (lastPrice != null && Number.isFinite(lastPrice) && ((above && lastPrice >= target) || (below && lastPrice <= target))) {
    return { via: 'price', price: lastPrice };
  }

  const created = alert.created_at ? Date.parse(alert.created_at) : NaN;
  if (!Number.isFinite(created)) return null;
  // First whole minute after the one the alert was created in.
  const firstEligibleStart = Math.floor(created / 60_000) * 60_000 + 60_000;

  let best: AlertTouch | null = null;
  for (const c of candles) {
    if (!(c.startMs >= firstEligibleStart)) continue;
    const hit = above ? c.high >= target : c.low <= target;
    if (!hit) continue;
    if (best == null || c.startMs < (best as { atMs: number }).atMs) best = { via: 'wick', level: above ? c.high : c.low, atMs: c.startMs };
  }
  return best;
}
