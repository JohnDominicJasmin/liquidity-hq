/* PHASE-2 STRATEGY FIXTURES + ORACLES (PM 2026-11-17): (A) Funding + OI squeeze, (B) CVD absorption. Live values (funding class, open-interest change, liquidation clusters, taker volume) are passed in; candles are synthetic; no network, no clock.
 * Same convention as strategyFixtures.ts: the rule is written once here in arithmetic; every open reading is stated as "CHOICE:" and must be agreed (or matched by the app) in writing.
 * "nearest S/R" targets follow the >= 1R rule (nearestR); rule targets do not. */
import { nearestR, rrOf, type C, type Zone, type Call } from './strategyFixtures';

const H = 3_600_000;
const call = (verdict: 'BUY' | 'SELL', entry: number, stop: number, target: number | null): Call => ({ verdict, entry, stop, target, rr: rrOf(entry, stop, target) });
const mk = (i: number, t0: number, o: number, a: number, b: number, c: number): C => ({ time: t0 + i * H, open: o, high: Math.max(a, b, o, c), low: Math.min(a, b, o, c), close: c });
export const atr = (c: C[], n = 14): number => { const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)))); const w = tr.slice(-n); return w.reduce((a, v) => a + v, 0) / w.length; };
/** 3-bar swing pivots (3 lower highs / higher lows each side) among the last `look` candles, by index. */
export function swings(c: C[], look = 20): { highs: Array<{ i: number; p: number }>; lows: Array<{ i: number; p: number }> } {
  const from = Math.max(3, c.length - look), highs: Array<{ i: number; p: number }> = [], lows: Array<{ i: number; p: number }> = [];
  for (let i = from; i < c.length - 3; i++) { if ([...c.slice(i - 3, i), ...c.slice(i + 1, i + 4)].every((x) => x.high <= c[i].high)) highs.push({ i, p: c[i].high }); if ([...c.slice(i - 3, i), ...c.slice(i + 1, i + 4)].every((x) => x.low >= c[i].low)) lows.push({ i, p: c[i].low }); }
  return { highs, lows };
}

/* ── A. FUNDING + OI SQUEEZE ──────────────────────────────────────────────────────────────────────────────────────
 * CROWDED = the Funding page's "paying heavily" class: longs paying heavily (crowd is LONG) or shorts paying heavily (crowd is SHORT), AND open interest up >= +3% over the last 6 candles, AND a liquidation cluster within 1.5% of the price on the crowded side
 * (below the price for a long crowd, above it for a short crowd). TRIGGER = the FIRST close through the last 3-bar swing (last 20 candles) AGAINST the crowd: long crowd -> a close below the last swing low = SELL; short crowd -> a close above the last swing high = BUY.
 * Entry = that close. TARGET = the liquidation cluster beyond entry in the trade direction if it is >= 1R away, else the first S/R level at >= 1R, else none. No "fade" wording. Live values only.
 * STOP (Dev's full text, 2026-11-17): the swing extreme on the CROWDED side: the last 3-bar swing HIGH for a SELL, swing LOW for a BUY, over the same 20 candles. FRESH = the trigger is one of the last 2 candles.
 * CHOICE (first close): the previous close was not already through the swing. */
export interface SqueezeLive { fundingClass: 'longs_heavy' | 'shorts_heavy' | 'none'; oiChange6Pct: number; clusters: number[]; }
export function squeezeCall(c: C[], live: SqueezeLive, zones: Zone[]): Call {
  if (live.fundingClass === 'none' || live.oiChange6Pct < 3) return { verdict: 'WAIT' };
  const crowdLong = live.fundingClass === 'longs_heavy';
  for (const k of [c.length - 1, c.length - 2]) {            // FRESH = the trigger is one of the last 2 candles (Dev, 2026-11-17)
    const x = c[k], price = x.close, near = live.clusters.filter((p) => (crowdLong ? p < price && (price - p) / price <= 0.015 : p > price && (p - price) / price <= 0.015)); if (!near.length) continue;
    const sw = swings(c.slice(0, k), 20), low = sw.lows[sw.lows.length - 1], hi = sw.highs[sw.highs.length - 1];
    if (crowdLong) {
      if (!low || !hi || !(x.close < low.p) || !(c[k - 1].close >= low.p)) continue;
      const entry = x.close, stop = hi.p, beyond = live.clusters.filter((p) => p < entry && entry - p >= stop - entry).sort((q, r) => r - q)[0] ?? null;
      return call('SELL', entry, stop, beyond ?? nearestR(zones, entry, stop, 'SELL'));
    }
    if (!low || !hi || !(x.close > hi.p) || !(c[k - 1].close <= hi.p)) continue;
    const entry = x.close, stop = low.p, beyond = live.clusters.filter((p) => p > entry && p - entry >= entry - stop).sort((q, r) => q - r)[0] ?? null;
    return call('BUY', entry, stop, beyond ?? nearestR(zones, entry, stop, 'BUY'));
  }
  return { verdict: 'WAIT' };
}
/** 60 candles of a zigzag with 3-bar swings; the LAST candle is `trigger`: 'through' (a close through the last swing against the crowd), 'inside' (stays inside), 'already' (the previous candle was already through). Prices near 100,000. */
export function squeezeFixture(crowd: 'long' | 'short', trigger: 'through' | 'inside' | 'already', t0 = 1_760_000_000_000): { candles: C[]; swingLow: number; swingHigh: number; price: number } {
  const out: C[] = []; let i = 0; const push = (o: number, a: number, b: number, cl: number) => out.push(mk(i++, t0, o, a, b, cl));
  for (let j = 0; j < 54; j++) { const ph = (j % 12) / 12, tri = ph <= 0.5 ? ph * 2 : (1 - ph) * 2, mid = 99_000 + 2_000 * tri, prev = 99_000 + 2_000 * (j % 12 === 0 ? 0 : (((j - 1) % 12) / 12 <= 0.5 ? (((j - 1) % 12) / 12) * 2 : (1 - ((j - 1) % 12) / 12) * 2)); push(prev, mid + (j % 12 === 6 ? 150 : 40), mid - (j % 12 === 0 ? 150 : 40), mid); }
  const { highs, lows } = swings(out, 20), sl = lows[lows.length - 1].p, sh = highs[highs.length - 1].p, last = out[out.length - 1].close;
  const down = crowd === 'long';   // a long crowd is stopped out by a close BELOW the swing low; a short crowd by a close ABOVE the swing high
  const through = down ? sl - 120 : sh + 120, inside = down ? sl + 400 : sh - 400;
  if (trigger === 'already') { push(last, last + 60, down ? sl - 200 : last - 60, down ? sl - 80 : sh + 80); }
  push(out[out.length - 1].close, Math.max(out[out.length - 1].close, trigger === 'inside' ? inside : through) + 30, Math.min(out[out.length - 1].close, trigger === 'inside' ? inside : through) - 30, trigger === 'inside' ? inside : through);
  return { candles: out, swingLow: sl, swingHigh: sh, price: out[out.length - 1].close };
}

/* ── B. CVD ABSORPTION (taker volume) ───────────────────────────────────────────────────────────────────────────────
 * Taker delta per candle = taker buy volume - taker sell volume. WINDOW = the last 8 candles ending at the candle BEFORE the trigger; its summed delta is compared with the previous 100 windows (rolling 8-candle sums over the 100 candles... CHOICE: the 100 rolling windows that end
 * before this one, i.e. window ends at j for j in [end-100, end-1]); z = (delta - mean) / sd.
 * BUY side: z <= -1.5 (sellers hit the bid) AND price HELD: the window's lowest low is no more than 0.2 ATR below the 20-candle low before the window, and the window's net price change is >= -0.3 ATR. TRIGGER = the first close above the previous candle's high.
 * Stop = the window low. SELL = the mirror (z >= +1.5; the window's highest high no more than 0.2 ATR above the prior 20-candle high; net change <= +0.3 ATR; trigger = the first close below the previous candle's low; stop = the window high).
 * Target = nearest S/R at >= 1R (CHOICE: the rule states none, so the common one is used). A coin with no taker data (Bybit-only) is WAIT with the reason "needs taker data". ATR = 14-candle average true range (CHOICE).
 * CHOICE: the window must END at the candle just before the trigger candle; a trigger two candles later does not count. */
export interface TakerC extends C { takerBuy: number; takerSell: number }
export function absorptionCall(c: TakerC[], hasTaker: boolean, zones: Zone[]): Call & { reason?: string } {
  if (!hasTaker) return { verdict: 'WAIT', reason: 'needs taker data' };
  const k = c.length - 1, end = k - 1; if (end < 130) return { verdict: 'WAIT' };
  const sum = (e: number) => c.slice(e - 7, e + 1).reduce((a, x) => a + (x.takerBuy - x.takerSell), 0);
  const prev: number[] = []; for (let e = end - 100; e < end; e++) prev.push(sum(e));
  const mean = prev.reduce((a, v) => a + v, 0) / prev.length, sd = Math.sqrt(prev.reduce((a, v) => a + (v - mean) ** 2, 0) / prev.length); if (!(sd > 0)) return { verdict: 'WAIT' };
  const z = (sum(end) - mean) / sd, win = c.slice(end - 7, end + 1), before = c.slice(end - 27, end - 7), a = atr(c.slice(0, end + 1)), net = win[win.length - 1].close - win[0].open;
  const winLow = Math.min(...win.map((x) => x.low)), winHigh = Math.max(...win.map((x) => x.high));
  if (z <= -1.5 && winLow >= Math.min(...before.map((x) => x.low)) - 0.2 * a && net >= -0.3 * a && c[k].close > c[k - 1].high) { const entry = c[k].close; return call('BUY', entry, winLow, nearestR(zones, entry, winLow, 'BUY')); }
  if (z >= 1.5 && winHigh <= Math.max(...before.map((x) => x.high)) + 0.2 * a && net <= 0.3 * a && c[k].close < c[k - 1].low) { const entry = c[k].close; return call('SELL', entry, winHigh, nearestR(zones, entry, winHigh, 'SELL')); }
  return { verdict: 'WAIT' };
}
/** 140 candles of a quiet range with random-looking but deterministic taker flow; then an 8-candle window (`delta` 'sell' = very negative, 'buy' = very positive, 'normal' = like the rest) with price held; then the trigger candle ('up' closes above the previous high, 'down' below the previous low, 'none' inside it). */
export function absorptionFixture(delta: 'sell' | 'buy' | 'normal', trigger: 'up' | 'down' | 'none', hold: boolean | 'net' = true, t0 = 1_760_000_000_000): TakerC[] {
  const out: TakerC[] = []; let i = 0; const rnd = (n: number) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const push = (o: number, hi: number, lo: number, cl: number, buy: number, sell: number) => out.push({ ...mk(i++, t0, o, hi, lo, cl), takerBuy: buy, takerSell: sell });
  for (let j = 0; j < 132; j++) { const p = 100_000 + Math.sin(j / 5) * 300, c = p + (rnd(j) - 0.5) * 120; push(p, Math.max(p, c) + 80, Math.min(p, c) - 80, c, 500 + rnd(j + 1) * 300, 500 + rnd(j + 2) * 300); }
  const base = out[out.length - 1].close;
  /* hold === 'net': the window's LOWS stay inside the prior range but its net price change is a clear fall (the window opens high and drifts down): the first held-test passes, the net-change test must refuse it. */
  for (let j = 0; j < 8; j++) { const c = hold === 'net' ? base + 330 - j * 60 : hold ? base + (rnd(300 + j) - 0.5) * 60 : base - 600 - j * 80; const buy = delta === 'sell' ? 250 : delta === 'buy' ? 1300 : 500 + rnd(j + 1) * 300, sell = delta === 'sell' ? 1300 : delta === 'buy' ? 250 : 500 + rnd(j + 2) * 300; push(hold === 'net' && j === 0 ? base + 330 : base, Math.max(base, c) + 50, Math.min(base, c) - 50, c, buy, sell); }
  const w = out[out.length - 1], pH = w.high, pL = w.low;
  if (trigger === 'up') push(w.close, pH + 400, w.close - 40, pH + 250, 700, 600); else if (trigger === 'down') push(w.close, w.close + 40, pL - 400, pL - 250, 600, 700); else push(w.close, pH - 20, pL + 20, w.close, 600, 600);
  return out;
}
