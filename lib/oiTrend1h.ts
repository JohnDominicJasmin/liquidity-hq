/* The Open Interest label and the number beside it, from ONE window (#1613). PURE: no React, no network.
 *
 * WHAT WAS WRONG. The Arena's "Open Interest" card printed a label from `store.coins[coin].oiTrend` ("New buyers · OI + price up · real trend") and,
 * next to it, the OI change over the last HOUR from useOI1h (" · -0.59% 1h"). They are not the same window and not the same source: `oiTrend`
 * is computed in MarketProvider from the last few readings it holds, which is ~3 hours on the first load (two Bybit hourly points) and ~25
 * minutes once the 8-minute poll has filled its own history. So the label could say "OI up" while the figure beside it, for a different window,
 * said OI down, and the label itself flipped between "Short covering" and "New buyers" as the source switched over after load.
 *
 * THE FIX. The label is now derived from the SAME 13 five-minute samples the 1h figure uses: the OI change and the price change across them.
 * Binance's openInterestHist carries both the OI in contracts (`sumOpenInterest`) and in USD (`sumOpenInterestValue`), so the price at each sample
 * is value / contracts, with no extra request. Where there is no USD value (the Bybit fallback, and Bybit-only coins) the price change is unknown,
 * and unknown is NOT turned into "price flat": no price-aware label is made, the card shows the OI change alone. */

export type OiTrend = 'strong_up' | 'weak_up' | 'strong_down' | 'weak_down';

/** Price implied by one open-interest sample: USD value / contracts. null when either is missing, not a number, or not positive. */
export function impliedPrice(sumOpenInterest: unknown, sumOpenInterestValue: unknown): number | null {
  const c = typeof sumOpenInterest === 'string' || typeof sumOpenInterest === 'number' ? parseFloat(String(sumOpenInterest)) : NaN;
  const v = typeof sumOpenInterestValue === 'string' || typeof sumOpenInterestValue === 'number' ? parseFloat(String(sumOpenInterestValue)) : NaN;
  if (!Number.isFinite(c) || !Number.isFinite(v) || c <= 0 || v <= 0) return null;
  return v / c;
}

/** Percent change from `from` to `to`, or null when either is missing or `from` is not positive. */
export function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || !(from > 0) || !Number.isFinite(to)) return null;
  return ((to - from) / from) * 100;
}

/** Smallest moves that count as a trend over the hour: 0.3% of OI AND 0.2% of price (the thresholds the live path used). If either is smaller there is
 *  no strong signal and the card says so rather than picking a side. */
export const OI_MOVE_MIN_PCT = 0.3;
export const PRICE_MOVE_MIN_PCT = 0.2;

/** OI up with price up = new buyers; OI up with price down = new shorts; OI down with price up = short covering; both down = long exits.
  *  null when the price change is unknown, or either move is too small. */
export function oiTrend1h(oiPct: number | null, pricePct: number | null): OiTrend | null {
  if (oiPct === null || pricePct === null) return null;
  if (!Number.isFinite(oiPct) || !Number.isFinite(pricePct)) return null;
  // BOTH moves must be real: a label that names a price direction on a price move inside the noise (the implied price is a USD-value / contracts ratio and can
  // lag the chart) would be a claim the data does not carry.
  if (Math.abs(oiPct) < OI_MOVE_MIN_PCT || Math.abs(pricePct) < PRICE_MOVE_MIN_PCT) return null;
  const oiUp = oiPct > 0, priceUp = pricePct > 0;
  if (oiUp && priceUp) return 'strong_up';
  if (oiUp && !priceUp) return 'strong_down';
  if (!oiUp && priceUp) return 'weak_up';
  return 'weak_down';
}
