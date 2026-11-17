/* SYNTHETIC CHANNEL CANDLES for the Channel strategy and the risk box on Draw Structure (#1263, owner request 2026-11-17). Pure data: no network, no clock.
 * A channel is two parallel rails; price is a triangle wave between them, so every swing high touches the upper rail and every swing low touches the lower one EXACTLY and every close sits inside.
 *   falling / rising     the rail slope sign
 *   breakout             'none' = every close stays inside; 'up' = the LAST candle closes `breakPct` above the upper rail; 'down' = it closes below the lower rail
 *   the oracle (channelCall) below states the rules the feature must follow, so the app's numbers can be compared to arithmetic done here, not to the app's own output. */
import type { PACandle } from '../../lib/priceAction';

export interface ChannelSpec {
  dir: 'falling' | 'rising';
  bars?: number;            // default 120
  period?: number;          // bars from one swing high to the next, default 12
  startMid?: number;        // mid-line price at bar 0, default 100000
  slopePct?: number;        // mid-line change per bar, percent of startMid, default 0.12
  widthPct?: number;        // full channel width, percent of the mid line, default 3
  breakout?: 'none' | 'up' | 'down';
  breakPct?: number;        // how far past the rail the breakout close lands, percent of the rail, default 0.6
  tf?: number;              // ms per bar, default 4 h
  t0?: number;
}

export interface ChannelFixture {
  candles: PACandle[];
  rails: { upper: (i: number) => number; lower: (i: number) => number };
  /** index of the breakout candle (the last), or null */
  breakoutIndex: number | null;
  /** the close of the breakout candle, or null */
  breakoutClose: number | null;
  /** the last swing INSIDE the channel before the breakout, on the side opposite the breakout: a low for 'up', a high for 'down' */
  lastSwingInside: { index: number; price: number } | null;
}

export function channelCandles(spec: ChannelSpec): ChannelFixture {
  const n = spec.bars ?? 120, period = spec.period ?? 12, start = spec.startMid ?? 100_000, tf = spec.tf ?? 4 * 3_600_000, t0 = spec.t0 ?? 1_760_000_000_000;
  const slope = (spec.dir === 'falling' ? -1 : 1) * ((spec.slopePct ?? 0.12) / 100) * start, half = ((spec.widthPct ?? 3) / 100) / 2;
  const mid = (i: number) => start + slope * i, upper = (i: number) => mid(i) * (1 + half), lower = (i: number) => mid(i) * (1 - half);
  const bo = spec.breakout ?? 'none', inside = bo === 'none' ? n : n - 1;
  const candles: PACandle[] = [];
  // triangle wave phase 0..1: 0 = swing low (touches the lower rail), .5 = swing high (touches the upper rail)
  const level = (i: number) => { const ph = (i % period) / period, tri = ph <= 0.5 ? ph * 2 : (1 - ph) * 2; return lower(i) + (upper(i) - lower(i)) * tri; };
  for (let i = 0; i < inside; i++) {
    const c = level(i), prev = i === 0 ? c : level(i - 1), next = level(i + 1);
    const hiTouch = (i % period) === Math.floor(period / 2), loTouch = (i % period) === 0;
    const high = hiTouch ? upper(i) : Math.min(upper(i), Math.max(c, prev, next) * 1.0005), low = loTouch ? lower(i) : Math.max(lower(i), Math.min(c, prev, next) * 0.9995);
    const close = Math.min(Math.max(c, low), high);
    candles.push({ timestamp: t0 + i * tf, open: prev, high: Math.max(high, close, prev), low: Math.min(low, close, prev), close, volume: 1000 });
  }
  let breakoutIndex: number | null = null, breakoutClose: number | null = null;
  if (bo !== 'none') {
    const i = n - 1, pct = (spec.breakPct ?? 0.6) / 100, rail = bo === 'up' ? upper(i) : lower(i), close = bo === 'up' ? rail * (1 + pct) : rail * (1 - pct), prev = candles[i - 1].close;
    candles.push({ timestamp: t0 + i * tf, open: prev, high: Math.max(prev, close) * 1.0004, low: Math.min(prev, close) * 0.9996, close, volume: 3000 });
    breakoutIndex = i; breakoutClose = close;
  }
  let lastSwingInside: ChannelFixture['lastSwingInside'] = null;
  const wantLow = bo === 'up';
  if (bo !== 'none') for (let i = inside - 1; i >= 0; i--) { if ((i % period) === (wantLow ? 0 : Math.floor(period / 2))) { lastSwingInside = { index: i, price: wantLow ? candles[i].low : candles[i].high }; break; } }
  return { candles, rails: { upper, lower }, breakoutIndex, breakoutClose, lastSwingInside };
}

/* ── THE ORACLE: the rules of the spec, written down once, here, in arithmetic ───────────────────────
 *   BUY  = the first close above the upper rail of a FALLING channel;  SELL = the first close below the lower rail of a RISING channel;  otherwise WAIT
 *   Entry = the breakout candle's close;  Stop = the last swing on the other side, inside the channel;  Target = the first S/R level in the trade's direction at >= 1x the risk distance (PM 2026-11-17: nearer levels are skipped); none -> no target, no R:R
 *   R:R = reward / risk = |target - entry| / |entry - stop| */
export type Zone = { low: number; high: number };
export interface Call { verdict: 'BUY' | 'SELL' | 'WAIT'; entry?: number; stop?: number; target?: number | null; rr?: number | null; }

export function rr(entry: number, stop: number, target: number): number { const risk = Math.abs(entry - stop); return risk === 0 ? NaN : Math.abs(target - entry) / risk; }

export function channelCall(fx: ChannelFixture, dir: 'falling' | 'rising', zones: Zone[]): Call {
  const last = fx.candles.length - 1, c = fx.candles[last];
  const above = c.close > fx.rails.upper(last), below = c.close < fx.rails.lower(last);
  const priorInside = fx.candles.slice(0, last).every((k, i) => k.close <= fx.rails.upper(i) && k.close >= fx.rails.lower(i));   // FIRST close outside
  if (!priorInside) return { verdict: 'WAIT' };
  if (dir === 'falling' && above && fx.lastSwingInside) {
    const entry = c.close, stop = fx.lastSwingInside.price, up = zones.filter((z) => z.low > entry && z.low - entry >= entry - stop).sort((a, b) => a.low - b.low)[0];   // nearest zone ABOVE entry at >= 1x the risk distance (PM decision 2026-11-17: closer targets are skipped)
    return up ? { verdict: 'BUY', entry, stop, target: up.low, rr: rr(entry, stop, up.low) } : { verdict: 'BUY', entry, stop, target: null, rr: null };
  }
  if (dir === 'rising' && below && fx.lastSwingInside) {
    const entry = c.close, stop = fx.lastSwingInside.price, dn = zones.filter((z) => z.high < entry && entry - z.high >= stop - entry).sort((a, b) => b.high - a.high)[0];   // nearest zone BELOW entry at >= 1x the risk distance
    return dn ? { verdict: 'SELL', entry, stop, target: dn.high, rr: rr(entry, stop, dn.high) } : { verdict: 'SELL', entry, stop, target: null, rr: null };
  }
  return { verdict: 'WAIT' };
}
