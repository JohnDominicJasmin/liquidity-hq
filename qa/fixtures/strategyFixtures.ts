/* SYNTHETIC CANDLES + ORACLES for the five phase-1 strategies (owner decision 2026-11-17, rules on #1263): golden/death cross, S/R flip, range bounce, fair value gap, Asia/London session sweep.
 * Each oracle is the rule written ONCE here in plain arithmetic, on closed candles, so the app's verdict, entry, stop and target can be compared with numbers that did not come from the app. Where the issue leaves a choice open
 * the oracle states the choice in its comment ("CHOICE:") and the app must either match it or the rule gets agreed in writing: nothing here is silently invented.
 * No network, no clock: candle times are fixed UTC. */
export interface C { time: number; open: number; high: number; low: number; close: number }
export interface Zone { price: number }              // a support / resistance level
export interface Call { verdict: 'BUY' | 'SELL' | 'WAIT'; entry?: number; stop?: number; target?: number | null; rr?: number | null }

const H = 3_600_000;
export const rrOf = (entry: number, stop: number, target: number | null): number | null => (target == null || entry === stop ? null : Math.abs(target - entry) / Math.abs(entry - stop));
const call = (verdict: 'BUY' | 'SELL', entry: number, stop: number, target: number | null): Call => ({ verdict, entry, stop, target, rr: rrOf(entry, stop, target) });
/** nearest level in the trade's direction: above entry for BUY, below for SELL; null when none. */
export const nearest = (zones: Zone[], entry: number, dir: 'BUY' | 'SELL'): number | null => { const c = zones.map((z) => z.price).filter((p) => (dir === 'BUY' ? p > entry : p < entry)).sort((a, b) => (dir === 'BUY' ? a - b : b - a)); return c.length ? c[0] : null; };
/** PM 2026-11-17: a target taken from "the nearest S/R" is the first level in the trade's direction at >= 1x the risk distance (nearer levels are skipped); none = no target, no R:R. Rule targets (range opposite edge, session opposite side) do not use this. */
export const nearestR = (zones: Zone[], entry: number, stop: number, dir: 'BUY' | 'SELL'): number | null => nearest(zones.filter((z) => Math.abs(z.price - entry) >= Math.abs(entry - stop)), entry, dir);
export const emaSeries = (v: number[], n: number): number[] => { const k = 2 / (n + 1); const out: number[] = []; let e = v[0]; for (let i = 0; i < v.length; i++) { e = i === 0 ? v[0] : v[i] * k + e * (1 - k); out.push(e); } return out; };

const mk = (i: number, t0: number, tf: number, o: number, a: number, b: number, c: number): C => ({ time: t0 + i * tf, open: o, high: Math.max(a, b, o, c), low: Math.min(a, b, o, c), close: c });   // a and b are the two extremes in either order

/* ── 1. GOLDEN / DEATH CROSS (EMA 50 / 200) ──────────────────────────────────────────────────────────────────────────
 * BUY = on the last closed candle EMA50 is above EMA200 and on the one before it was not; SELL = the reverse. Entry = that candle's close; Stop = the lowest low (BUY) / highest high (SELL) of the last 20 candles ending at it;
 * Target = nearest S/R in the direction. WAIT otherwise. CHOICE: "closes above" is read as the EMA50 value computed on closes with the standard 2/(n+1) smoothing, seeded with the first close. */
export function crossCall(c: C[], zones: Zone[]): Call {
  const cl = c.map((x) => x.close), e50 = emaSeries(cl, 50), e200 = emaSeries(cl, 200), k = c.length - 1;
  if (k < 200) return { verdict: 'WAIT' };
  const up = e50[k] > e200[k] && !(e50[k - 1] > e200[k - 1]), dn = e50[k] < e200[k] && !(e50[k - 1] < e200[k - 1]);
  if (!up && !dn) return { verdict: 'WAIT' };
  const w = c.slice(k - 19, k + 1), entry = c[k].close;
  const stopB = Math.min(...w.map((x) => x.low)), stopS = Math.max(...w.map((x) => x.high));
  return up ? call('BUY', entry, stopB, nearestR(zones, entry, stopB, 'BUY')) : call('SELL', entry, stopS, nearestR(zones, entry, stopS, 'SELL'));
}
/** A long fall then a long rise (or the mirror); the series is cut at the FIRST candle where EMA50 crosses EMA200 (`atCross`) or one candle before it (`beforeCross`). */
export function crossFixture(dir: 'golden' | 'death', where: 'atCross' | 'beforeCross', t0 = 1_760_000_000_000): C[] {
  const sgn = dir === 'golden' ? 1 : -1, all: C[] = []; let p = 100_000;
  for (let i = 0; i < 900; i++) { const phase = i < 300 ? -1 : 1; p = p * (1 + sgn * phase * 0.0016 + (i % 2 ? 0.0004 : -0.0004)); all.push(mk(i, t0, 4 * H, p * 0.9995, p * 1.002, p * 0.998, p)); }
  const cl = all.map((x) => x.close), e50 = emaSeries(cl, 50), e200 = emaSeries(cl, 200);
  for (let k = 250; k < all.length; k++) { const hit = dir === 'golden' ? e50[k] > e200[k] && !(e50[k - 1] > e200[k - 1]) : e50[k] < e200[k] && !(e50[k - 1] < e200[k - 1]); if (hit) return all.slice(0, where === 'atCross' ? k + 1 : k); }
  throw new Error('crossFixture: no cross was generated');
}

/* ── 2. S/R FLIP ──────────────────────────────────────────────────────────────────────────────────────────────────────
 * BUY: price closed ABOVE resistance L; the FIRST later candle that touches L (low <= L) and closes back above L is the retest: Entry = its close; Stop = min(L, the retest's low) ("just beyond the level (or the retest wick)");
 * Target = the next S/R above entry. SELL mirrors at a support. The call is on the retest candle only (the last candle). CHOICE: a touch is low <= L (BUY) / high >= L (SELL), no tolerance band; so the retest low is always at or beyond L and min(L, low) == low (the "or the retest wick" reading); a buffer beyond the wick is NOT assumed. */
export function flipCall(c: C[], levelP: number, side: 'resistance' | 'support', zones: Zone[]): Call {
  const k = c.length - 1; if (k < 3) return { verdict: 'WAIT' };
  if (side === 'resistance') {
    let broke = -1; for (let i = 1; i <= k; i++) if (c[i].close > levelP && c[i - 1].close <= levelP) broke = i;   // the latest close above
    if (broke < 0 || broke === k) return { verdict: 'WAIT' };
    for (let i = broke + 1; i <= k; i++) { if (c[i].low <= levelP) { if (i === k && c[i].close > levelP) { const st = Math.min(levelP, c[i].low); return call('BUY', c[i].close, st, nearestR(zones, c[i].close, st, 'BUY')); } return { verdict: 'WAIT' }; } }
    return { verdict: 'WAIT' };
  }
  let broke = -1; for (let i = 1; i <= k; i++) if (c[i].close < levelP && c[i - 1].close >= levelP) broke = i;
  if (broke < 0 || broke === k) return { verdict: 'WAIT' };
  for (let i = broke + 1; i <= k; i++) { if (c[i].high >= levelP) { if (i === k && c[i].close < levelP) { const st = Math.max(levelP, c[i].high); return call('SELL', c[i].close, st, nearestR(zones, c[i].close, st, 'SELL')); } return { verdict: 'WAIT' }; } }
  return { verdict: 'WAIT' };
}
/** The chart's own S/R computation (a copy of lib/srLevels.ts computeSRLevels: swing highs / lows with 3 bars each side over the last 200 bars, clustered within 0.3%, the three most-touched on each side of the price); a test compares it with the real function when the tree has it. */
export function srLevels(bars: { high: number; low: number; close: number }[], currentPrice: number): Array<{ price: number; type: 'support' | 'resistance'; touches: number }> {
  const lb = 3, recent = bars.slice(-200), swingHighs: number[] = [], swingLows: number[] = [];
  for (let i = lb; i < recent.length - lb; i++) {
    const hi = recent[i].high, lo = recent[i].low;
    if (recent.slice(i - lb, i).every((x) => x.high <= hi) && recent.slice(i + 1, i + lb + 1).every((x) => x.high <= hi)) swingHighs.push(hi);
    if (recent.slice(i - lb, i).every((x) => x.low >= lo) && recent.slice(i + 1, i + lb + 1).every((x) => x.low >= lo)) swingLows.push(lo);
  }
  const cluster = (prices: number[]) => { const clusters: Array<{ price: number; count: number }> = []; for (const p of [...prices].sort((x, y) => x - y)) { const ex = clusters.find((c) => Math.abs(c.price - p) / p < 0.003); if (ex) { ex.price = (ex.price * ex.count + p) / (ex.count + 1); ex.count++; } else clusters.push({ price: p, count: 1 }); } return clusters.sort((x, y) => y.count - x.count); };
  return [...cluster(swingHighs).filter((c) => c.price > currentPrice * 0.999).slice(0, 3).map((c) => ({ price: c.price, type: 'resistance' as const, touches: c.count })), ...cluster(swingLows).filter((c) => c.price < currentPrice * 1.001).slice(0, 3).map((c) => ({ price: c.price, type: 'support' as const, touches: c.count }))];
}
/** The level the chart would draw just BEFORE the break: the most-touched resistance (BUY side) / support (SELL side) of the candles up to `end` (exclusive), with the price at the last of them as "current". */
export function flipLevelFromChart(c: C[], end: number, side: 'resistance' | 'support'): number | null {
  const prefix = c.slice(0, end); if (prefix.length < 10) return null; const lv = srLevels(prefix, prefix[prefix.length - 1].close).filter((l) => l.type === side);
  return lv.length ? lv.sort((x, y) => y.touches - x.touches)[0].price : null;
}
/** Prelude of 6 cycles of 10 bars: price swings between ~4% away and the level, every swing extreme touching the level (a wick to it), so the chart's own S/R finds it as a cluster of 6 touches; then: the break (a close beyond), a run away, a pullback that does not touch, and the retest candle (or, for the control, a candle that comes back without touching). */
export function flipFixture(side: 'resistance' | 'support', retest: boolean, levelP = 100_000, t0 = 1_760_000_000_000): { candles: C[]; level: number } {
  const s = side === 'resistance' ? 1 : -1, out: C[] = []; let i = 0;
  const push = (o: number, a: number, b: number, cl: number) => out.push(mk(i++, t0, 4 * H, o, a, b, cl));
  for (let cyc = 0; cyc < 6; cyc++) for (let j = 0; j < 10; j++) {
    const tri = (k: number) => { const ph = k / 10; return ph <= 0.5 ? ph * 2 : (1 - ph) * 2; };   // 0 .. 1 .. 0
    const lvl = (k: number) => levelP - s * levelP * 0.04 * (1 - tri(k)), mid = lvl(j), prev = lvl(j === 0 ? 0 : j - 1);
    const peak = j === 5;                                                                       // the swing extreme: its wick reaches the level, its close stays on the near side
    push(prev, peak ? levelP : mid + s * levelP * 0.001, mid - s * levelP * 0.001, peak ? levelP - s * levelP * 0.004 : mid);
  }
  const base = out[out.length - 1].close;
  push(base, levelP + s * 1500, levelP - s * 400, levelP + s * 1200);                           // the break: a close beyond the level
  push(levelP + s * 1200, levelP + s * 2200, levelP + s * 1000, levelP + s * 2000);              // runs away
  push(levelP + s * 2000, levelP + s * 2300, levelP + s * 1500, levelP + s * 1800);              // pulls back but does not touch
  if (retest) push(levelP + s * 1800, levelP + s * 1900, levelP - s * 150, levelP + s * 900);    // the retest: a wick through the level, a close back beyond it
  else push(levelP + s * 1800, levelP + s * 1900, levelP + s * 700, levelP + s * 1100);          // control: back near, never touching
  return { candles: out, level: levelP };
}

/* ── 3. RANGE BOUNCE ────────────────────────────────────────────────────────────────────────────────────────────────────
 * Needs a flat range: >= 3 touches of the high edge and >= 3 of the low edge (the detector's flat range). BUY = the last candle's low touches the range low (within 0.1%) and it CLOSES back inside; SELL mirrors at the top.
 * Entry = close; Stop = beyond the edge = min(range low, the candle's low) for BUY / max(range high, high) for SELL; Target = the opposite edge. WAIT when price is mid-range (the close is not within 25% of an edge). */
export function rangeCall(c: C[], low: number, high: number, touchesLow: number, touchesHigh: number): Call {
  if (touchesLow < 3 || touchesHigh < 3) return { verdict: 'WAIT' };
  const k = c.length - 1, x = c[k], tol = 0.001, w = high - low;
  if (x.low <= low * (1 + tol) && x.close > low && x.close < low + 0.25 * w) return call('BUY', x.close, Math.min(low, x.low), high);
  if (x.high >= high * (1 - tol) && x.close < high && x.close > high - 0.25 * w) return call('SELL', x.close, Math.max(high, x.high), low);
  return { verdict: 'WAIT' };
}
/** A flat range between `low` and `high`, a triangle wave with period 12 bars (touches each edge every 12 bars); the LAST candle is `end`: 'low' (wicks to the low edge, closes inside), 'high', or 'mid'. */
export function rangeFixture(end: 'low' | 'high' | 'mid', low = 95_000, high = 100_000, bars = 120, t0 = 1_760_000_000_000): { candles: C[]; low: number; high: number; touchesLow: number; touchesHigh: number } {
  const out: C[] = []; const lvl = (i: number) => { const ph = (i % 12) / 12, tri = ph <= 0.5 ? ph * 2 : (1 - ph) * 2; return low + (high - low) * tri; };
  for (let i = 0; i < bars - 1; i++) { const c = lvl(i), p = i ? lvl(i - 1) : c; out.push(mk(i, t0, 4 * H, p, (i % 12) === 6 ? high : Math.min(high, c * 1.001), (i % 12) === 0 ? low : Math.max(low, c * 0.999), c)); }
  const i = bars - 1, prev = out[i - 1].close;
  if (end === 'low') out.push(mk(i, t0, 4 * H, prev, prev * 1.001, low, low + 0.04 * (high - low)));
  else if (end === 'high') out.push(mk(i, t0, 4 * H, prev, high, prev * 0.999, high - 0.04 * (high - low)));
  else out.push(mk(i, t0, 4 * H, prev, low + 0.55 * (high - low), low + 0.45 * (high - low), low + 0.5 * (high - low)));
  const touches = (side: 'low' | 'high') => out.filter((x) => (side === 'low' ? x.low <= low * 1.001 : x.high >= high * 0.999)).length;
  return { candles: out, low, high, touchesLow: touches('low'), touchesHigh: touches('high') };
}

/* ── 4. FAIR VALUE GAP ──────────────────────────────────────────────────────────────────────────────────────────────────
 * A bullish gap is candle i-2's high below candle i's low (gap = [c[i-2].high, c[i].low]); bearish is the mirror (c[i-2].low above c[i].high). BUY = the FIRST candle after the gap that returns into it (low <= gap top) and closes above the gap's
 * bottom, with the gap still unfilled (no earlier close below the bottom); Entry = close; Stop = the gap bottom; Target = the recent swing high (highest high of the 20 candles before the gap) or the nearest S/R above entry if that is nearer;
 * SELL mirrors. CHOICE: stop = the gap edge exactly; target = whichever of swing / nearest S/R is nearer to entry in the direction. The call is on the return candle only (the last candle). */
export function fvgCall(c: C[], zones: Zone[]): Call {
  const k = c.length - 1;
  for (let i = k - 1; i >= 2; i--) {
    const bull = c[i - 2].high < c[i].low, bear = c[i - 2].low > c[i].high; if (!bull && !bear) continue;
    const top = bull ? c[i].low : c[i - 2].low, bot = bull ? c[i - 2].high : c[i].high;   // bull gap = [bot, top] with bot = c[i-2].high
    let first = -1, filled = false;
    for (let j = i + 1; j <= k; j++) { if (bull ? c[j].close < bot : c[j].close > top) { filled = true; break; } if (first < 0 && (bull ? c[j].low <= top : c[j].high >= bot)) first = j; }
    if (filled || first !== k) continue;
    const pre = c.slice(Math.max(0, i - 22), i - 1);
    if (bull && c[k].close > bot) { const entry = c[k].close, swing = Math.max(...pre.map((x) => x.high)), sr = nearestR(zones, entry, bot, 'BUY'), cand = [swing, sr].filter((v): v is number => v != null && v > entry); return call('BUY', entry, bot, cand.length ? Math.min(...cand) : null); }
    if (bear && c[k].close < top) { const entry = c[k].close, swing = Math.min(...pre.map((x) => x.low)), sr = nearestR(zones, entry, top, 'SELL'), cand = [swing, sr].filter((v): v is number => v != null && v < entry); return call('SELL', entry, top, cand.length ? Math.max(...cand) : null); }
  }
  return { verdict: 'WAIT' };
}
export function fvgFixture(dir: 'bull' | 'bear', returns: boolean, t0 = 1_760_000_000_000): C[] {
  const s = dir === 'bull' ? 1 : -1, out: C[] = []; let i = 0; const push = (o: number, h: number, l: number, cl: number) => out.push(mk(i++, t0, 4 * H, o, h, l, cl));
  for (let j = 0; j < 25; j++) { const b = 100_000 + s * j * 30; push(b, b + 150, b - 150, b + s * 20); }               // flat-ish prelude (the recent swing is in here)
  const base = 100_000 + s * 25 * 30;
  push(base, base + s * 100 + 100, base - 100, base + s * 80);                                                         // i-2: its high is the gap bottom (bull)
  push(base + s * 80, base + s * 1800, base + s * 60, base + s * 1700);                                                // i-1: the impulse
  const gb = out[out.length - 2].high, gl = out[out.length - 2].low;
  push(base + s * 1700, base + s * 1900, (dir === 'bull' ? gb : gl) + s * 400, base + s * 1800);                       // i: its low (bull) stays above i-2's high: the gap
  push(base + s * 1800, base + s * 2100, base + s * 1600, base + s * 1950);                                            // drifts on, never back near the gap
  if (returns) {
    const bot = dir === 'bull' ? out[out.length - 4].high : out[out.length - 2].high, top = dir === 'bull' ? out[out.length - 2].low : out[out.length - 4].low;   // the gap is [bot, top]
    const close = dir === 'bull' ? bot + 0.7 * (top - bot) : top - 0.7 * (top - bot), wick = dir === 'bull' ? bot + 0.5 * (top - bot) : bot + 0.5 * (top - bot);
    push(base + s * 1950, close + 60, wick, close);   // returns INTO the gap and closes beyond its far edge, inside it
  }
  else push(base + s * 1950, base + s * 2050, base + s * 1500, base + s * 1900);                                       // control: pulls back but stays above the gap
  return out;
}

/* ── 5. ASIA / LONDON SESSION SWEEP (hours in UTC; "confirm the hours with Dev": Asia 00:00-08:00, London 07:00-12:00) ──────────────
 * The session range = the lowest low and highest high of the candles whose open hour is in [start, end). On the LAST candle (open hour >= end, same UTC day, <= end + 4 h): BUY = its low is below the session low and it
 * CLOSES back at or above the session low (inside); SELL = its high is above the session high and it closes at or below the session high. Entry = close; Stop = the sweep wick (the candle's low for BUY / high for SELL); Target = the OPPOSITE
 * side of the session range. Timeframes 5m to 1h: this fixture is 1h. */
export function sessionCall(c: C[], session: { startH: number; endH: number }): Call {
  const k = c.length - 1, x = c[k], d = new Date(x.time), day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), hr = d.getUTCHours();
  if (hr < session.endH || hr > session.endH + 4) return { verdict: 'WAIT' };
  const inS = c.filter((y) => y.time >= day + session.startH * H && y.time < day + session.endH * H); if (!inS.length) return { verdict: 'WAIT' };
  const lo = Math.min(...inS.map((y) => y.low)), hi = Math.max(...inS.map((y) => y.high));
  if (x.low < lo && x.close >= lo) return call('BUY', x.close, x.low, hi);
  if (x.high > hi && x.close <= hi) return call('SELL', x.close, x.high, lo);
  return { verdict: 'WAIT' };
}
/** Two UTC days of 1h candles; the last candle opens at `lastHour` UTC on day 2 and is a sweep (`sweep` 'low' | 'high') or an ordinary inside candle ('none'). The session range is 00:00-08:00 (Asia) or 07:00-12:00 (London) of day 2. */
export function sessionFixture(session: 'asia' | 'london', sweep: 'low' | 'high' | 'none'): { candles: C[]; range: { low: number; high: number }; lastHour: number } {
  const day2 = Date.UTC(2026, 10, 17), t0 = day2 - 24 * H, out: C[] = [], [sH, eH] = session === 'asia' ? [0, 8] : [7, 12], lastHour = session === 'asia' ? 8 : 12;
  for (let i = 0; i < 24 + lastHour; i++) { const t = t0 + i * H, hr = (i % 24); const mid = 100_000 + Math.sin(i / 3) * 400; const inS = i >= 24 && hr >= sH && hr < eH; const o = mid, cl = mid + (i % 2 ? 60 : -60); out.push({ time: t, open: o, high: Math.max(o, cl) + (inS ? 250 : 150), low: Math.min(o, cl) - (inS ? 250 : 150), close: cl }); }
  const inS = out.filter((y) => y.time >= day2 + sH * H && y.time < day2 + eH * H), low = Math.min(...inS.map((y) => y.low)), high = Math.max(...inS.map((y) => y.high)), t = day2 + lastHour * H;
  if (sweep === 'low') out.push({ time: t, open: low + 150, high: low + 220, low: low - 300, close: low + 120 });
  else if (sweep === 'high') out.push({ time: t, open: high - 150, high: high + 300, low: high - 220, close: high - 120 });
  else out.push({ time: t, open: low + 800, high: low + 900, low: low + 700, close: low + 850 });
  return { candles: out, range: { low, high }, lastHour };
}
