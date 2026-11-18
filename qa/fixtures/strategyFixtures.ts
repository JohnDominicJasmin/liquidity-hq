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
 * Target = nearest S/R in the direction. WAIT otherwise. #2603: needs 601 closed candles (the EMA 200's seed has faded); fewer = WAIT. CHOICE: "closes above" is read as the EMA50 value computed on closes with the standard 2/(n+1) smoothing, seeded with the first close. */
export function crossCall(c: C[], zones: Zone[]): Call {
  const cl = c.map((x) => x.close), e50 = emaSeries(cl, 50), e200 = emaSeries(cl, 200), k = c.length - 1;
  if (k < 600) return { verdict: 'WAIT' };   // #2603: the EMA 200 needs its seed to fade: 601 closed candles (the app fetches 1000); under that the strategy has no call
  const up = e50[k] > e200[k] && !(e50[k - 1] > e200[k - 1]), dn = e50[k] < e200[k] && !(e50[k - 1] < e200[k - 1]);
  if (!up && !dn) return { verdict: 'WAIT' };
  const w = c.slice(k - 19, k + 1), entry = c[k].close;
  const stopB = Math.min(...w.map((x) => x.low)), stopS = Math.max(...w.map((x) => x.high));
  return up ? call('BUY', entry, stopB, nearestR(zones, entry, stopB, 'BUY')) : call('SELL', entry, stopS, nearestR(zones, entry, stopS, 'SELL'));
}
/** A long fall then a long rise (or the mirror); the series is cut at the FIRST candle where EMA50 crosses EMA200 (`atCross`) or one candle before it (`beforeCross`). */
export function crossFixture(dir: 'golden' | 'death', where: 'atCross' | 'beforeCross', t0 = 1_760_000_000_000): C[] {
  const sgn = dir === 'golden' ? 1 : -1, all: C[] = []; let p = 100_000;
  for (let i = 0; i < 1600; i++) { const phase = i < 700 ? -1 : 1; p = p * (1 + sgn * phase * 0.0016 + (i % 2 ? 0.0004 : -0.0004)); all.push(mk(i, t0, 4 * H, p * 0.9995, p * 1.002, p * 0.998, p)); }
  const cl = all.map((x) => x.close), e50 = emaSeries(cl, 50), e200 = emaSeries(cl, 200);
  for (let k = 750; k < all.length; k++) { const hit = dir === 'golden' ? e50[k] > e200[k] && !(e50[k - 1] > e200[k - 1]) : e50[k] < e200[k] && !(e50[k - 1] < e200[k - 1]); if (hit) { const end = where === 'atCross' ? k + 1 : k; return all.slice(Math.max(0, end - 1000), end); } }   // the app is given at most 1000 closed candles
  throw new Error('crossFixture: no cross was generated');
}

/* ── 2. S/R FLIP ──────────────────────────────────────────────────────────────────────────────────────────────────────
 * BUY: price closed ABOVE resistance L; the FIRST later candle that touches L (low <= L) and closes back above L is the retest: Entry = its close; Stop = min(L, the retest's low) ("just beyond the level (or the retest wick)");
 * Target = the first S/R beyond the entry at least 1R away (#2603; nearest S/R in the older text). SELL mirrors at a support. The call is on the retest candle only (the last candle). CHOICE: a touch is low <= L (BUY) / high >= L (SELL), no tolerance band; so the retest low is always at or beyond L and min(L, low) == low (the "or the retest wick" reading); a buffer beyond the wick is NOT assumed. */
export function flipCall(c: C[], levelP: number, side: 'resistance' | 'support', zones: Zone[]): Call {
  /* #2603 (the written rule, srFlip.ts header): BREAK = a close at least 0.1 x ATR(14) beyond the level, the close before it not already that far beyond; RETEST = the FIRST candle that touches the level at least 4 candles after the break
   * (3 candles between), and it must be the LAST candle, closing back beyond the level; ONE flip per level and direction: only that first qualifying touch counts. ATR(14) here = the plain mean of the last 14 true ranges up to the candle (CHOICE). */
  const k = c.length - 1; if (k < 4) return { verdict: 'WAIT' };
  const tr = (i: number) => (i === 0 ? c[0].high - c[0].low : Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
  const atr = (i: number) => { const w: number[] = []; for (let j = Math.max(0, i - 13); j <= i; j++) w.push(tr(j)); return w.reduce((x, y) => x + y, 0) / w.length; };
  const up = side === 'resistance', sgn = up ? 1 : -1;
  const beyond = (i: number) => (up ? c[i].close >= levelP + 0.1 * atr(i) : c[i].close <= levelP - 0.1 * atr(i));
  const beyondBack = (i: number) => (up ? c[i].close <= levelP - 0.1 * atr(i) : c[i].close >= levelP + 0.1 * atr(i));   // a close back through the level, by the same margin
  let broke = -1, backBroke = -1; for (let i = Math.max(1, k - 120); i <= k; i++) { if (beyond(i) && !beyond(i - 1)) broke = i; if (beyondBack(i) && !beyondBack(i - 1)) backBroke = i; }   // the latest break, looked for in the last 120 candles (the header: "the break is looked for in the last LOOKBACK candles")
  if (broke < 0 || broke === k || backBroke > broke) return { verdict: 'WAIT' };   // CHOICE: "a new break needs a close back on the other side first": a later break the OTHER way voids this one
  let first = -1; for (let i = broke + 4; i <= k; i++) if (up ? c[i].low <= levelP : c[i].high >= levelP) { first = i; break; }
  if (first !== k || !(up ? c[k].close > levelP : c[k].close < levelP)) return { verdict: 'WAIT' };
  const st = up ? Math.min(levelP, c[k].low) : Math.max(levelP, c[k].high);
  void sgn; return call(up ? 'BUY' : 'SELL', c[k].close, st, nearestR(zones, c[k].close, st, up ? 'BUY' : 'SELL'));
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
  push(levelP + s * 1800, levelP + s * 1950, levelP + s * 1400, levelP + s * 1700);              // #2603: a third candle after the break that does not touch: the retest is the 4th candle after the break (3 between)
  if (retest) push(levelP + s * 1800, levelP + s * 1900, levelP - s * 150, levelP + s * 900);    // the retest: a wick through the level, a close back beyond it
  else push(levelP + s * 1800, levelP + s * 1900, levelP + s * 700, levelP + s * 1100);          // control: back near, never touching
  return { candles: out, level: levelP };
}

/* ── 3. RANGE BOUNCE ────────────────────────────────────────────────────────────────────────────────────────────────────
 * #2603, THE WRITTEN RULE (rangeBounce.ts header): the RANGE is the last 30 candles BEFORE the last one: highest high = range high, lowest low = range low; the band is no taller than 4 x ATR(14) (ATR(14) = the plain mean of the last 14 true
 * ranges of the candles before the last, CHOICE), and at least 2 candles touch EACH edge (a candle touches the high when its high is within 10% of the band height of it, the low likewise). BUY = the last candle's low is within 10% of the band
 * height of the range low (or below it) and it closes back inside, in the lower quarter; SELL = the mirror at the top. Entry = close; Stop = min(range low, the candle's low) for BUY / max(range high, high) for SELL; Target = the opposite edge. WAIT
 * mid-range, with no range (band taller than 4 ATR, fewer than 2 touches on a side) or on fewer than 60 candles. */
export function rangeCall(c: C[]): Call {
  const k = c.length - 1; if (k + 1 < 60) return { verdict: 'WAIT' };
  const before = c.slice(0, k), win = before.slice(-30), high = Math.max(...win.map((x) => x.high)), low = Math.min(...win.map((x) => x.low)), w = high - low;
  const tr = (i: number) => (i === 0 ? before[0].high - before[0].low : Math.max(before[i].high - before[i].low, Math.abs(before[i].high - before[i - 1].close), Math.abs(before[i].low - before[i - 1].close)));
  const last14: number[] = []; for (let j = Math.max(0, before.length - 14); j < before.length; j++) last14.push(tr(j));
  const atr = last14.reduce((x, y) => x + y, 0) / last14.length;
  if (!(w > 0) || w > 4 * atr) return { verdict: 'WAIT' };
  const tol = 0.1 * w;
  if (win.filter((x) => x.high >= high - tol).length < 2 || win.filter((x) => x.low <= low + tol).length < 2) return { verdict: 'WAIT' };
  const x = c[k];
  if (x.low <= low + tol && x.close > low && x.close < low + 0.25 * w) return call('BUY', x.close, Math.min(low, x.low), high);
  if (x.high >= high - tol && x.close < high && x.close > high - 0.25 * w) return call('SELL', x.close, Math.max(high, x.high), low);
  return { verdict: 'WAIT' };
}
/** A choppy range between `low` and `high`: a triangle wave with period 12 bars whose candles carry wicks of `wickFrac` x the band height (clamped inside the band), so its ATR is a fraction of the band (a range the 4-ATR rule accepts); the LAST candle is `end`: 'low' (wicks to the low edge, closes inside), 'high', or 'mid'. A small wickFrac makes a band much taller than 4 ATR (no range). */
export function rangeFixture(end: 'low' | 'high' | 'mid', low = 95_000, high = 100_000, bars = 120, t0 = 1_760_000_000_000, wickFrac = 0.15): { candles: C[]; low: number; high: number } {
  const out: C[] = []; const w = high - low; const lvl = (i: number) => { const ph = (i % 12) / 12, tri = ph <= 0.5 ? ph * 2 : (1 - ph) * 2; return low + w * tri; };
  for (let i = 0; i < bars - 1; i++) { const c = lvl(i), p = i ? lvl(i - 1) : c; out.push(mk(i, t0, 4 * H, p, (i % 12) === 6 ? high : Math.min(high, Math.max(p, c) + wickFrac * w), (i % 12) === 0 ? low : Math.max(low, Math.min(p, c) - wickFrac * w), c)); }
  const i = bars - 1, prev = out[i - 1].close;
  if (end === 'low') out.push(mk(i, t0, 4 * H, prev, prev * 1.001, low, low + 0.04 * w));
  else if (end === 'high') out.push(mk(i, t0, 4 * H, prev, high, prev * 0.999, high - 0.04 * w));
  else out.push(mk(i, t0, 4 * H, prev, low + 0.55 * w, low + 0.45 * w, low + 0.5 * w));
  return { candles: out, low, high };
}

/* ── 4. FAIR VALUE GAP ──────────────────────────────────────────────────────────────────────────────────────────────────
 * A bullish gap is candle i-2's high below candle i's low (gap = [c[i-2].high, c[i].low]); bearish is the mirror (c[i-2].low above c[i].high). BUY = the FIRST candle after the gap that returns into it (low <= gap top) and closes above the gap's
 * bottom, with the gap still unfilled (no earlier close below the bottom); Entry = close; Stop = the gap bottom; Target = the recent swing high (highest high of the 20 candles before the gap) or the nearest S/R above entry if that is nearer;
 * SELL mirrors. CHOICE: stop = the gap edge exactly; target = whichever of swing / nearest S/R is nearer to entry in the direction. The call is on the return candle only (the last candle).
 * #2603 SIZE FILTERS (the written rule): the gap must be at least 0.5 x ATR(14) tall (ATR at the gap's third candle) and the call's risk (entry to stop) at least 0.5 x ATR(14) at the return candle. ATR(14) = the plain mean of the last 14 true ranges (CHOICE). */
export function fvgCall(c: C[], zones: Zone[]): Call {
  const k = c.length - 1;
  const tr = (i: number) => (i === 0 ? c[0].high - c[0].low : Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
  const atr = (i: number) => { const w: number[] = []; for (let j = Math.max(0, i - 13); j <= i; j++) w.push(tr(j)); return w.reduce((x, y) => x + y, 0) / w.length; };
  for (let i = k - 1; i >= Math.max(2, k - 100); i--) {   // the gap is looked for in the last 100 candles (the header)
    const bull = c[i - 2].high < c[i].low, bear = c[i - 2].low > c[i].high; if (!bull && !bear) continue;
    const top = bull ? c[i].low : c[i - 2].low, bot = bull ? c[i - 2].high : c[i].high;   // bull gap = [bot, top] with bot = c[i-2].high
    let first = -1, filled = false;
    for (let j = i + 1; j <= k; j++) { if (bull ? c[j].close < bot : c[j].close > top) { filled = true; break; } if (first < 0 && (bull ? c[j].low <= top : c[j].high >= bot)) first = j; }
    if (filled || first !== k) continue;
    if (top - bot < 0.5 * atr(i)) continue;                    // #2603: the gap is smaller than 0.5 ATR: not a gap worth returning to
    const pre = c.slice(Math.max(0, i - 22), i - 1);
    if (bull && c[k].close > bot) { if (c[k].close - bot < 0.5 * atr(k)) continue; const entry = c[k].close, swing = Math.max(...pre.map((x) => x.high)), sr = nearestR(zones, entry, bot, 'BUY'), cand = [swing, sr].filter((v): v is number => v != null && v > entry); return call('BUY', entry, bot, cand.length ? Math.min(...cand) : null); }
    if (bear && c[k].close < top) { if (top - c[k].close < 0.5 * atr(k)) continue; const entry = c[k].close, swing = Math.min(...pre.map((x) => x.low)), sr = nearestR(zones, entry, top, 'SELL'), cand = [swing, sr].filter((v): v is number => v != null && v < entry); return call('SELL', entry, top, cand.length ? Math.max(...cand) : null); }
  }
  return { verdict: 'WAIT' };
}
export function fvgFixture(dir: 'bull' | 'bear', returns: boolean, t0 = 1_760_000_000_000, gapH = 900, retFrac = 0.7): C[] {   // gapH = the gap's height, retFrac = how far into the gap the return closes (risk = retFrac x gapH)
  const s = dir === 'bull' ? 1 : -1, out: C[] = []; let i = 0; const push = (o: number, h: number, l: number, cl: number) => out.push(mk(i++, t0, 4 * H, o, h, l, cl));
  for (let j = 0; j < 25; j++) { const b = 100_000 + s * j * 30; push(b, b + 150, b - 150, b + s * 20); }               // flat-ish prelude (the recent swing is in here)
  const base = 100_000 + s * 25 * 30;
  push(base, base + s * 100 + 100, base - 100, base + s * 80);                                                         // i-2: its high is the gap bottom (bull)
  push(base + s * 80, base + s * 1800, base + s * 60, base + s * 1700);                                                // i-1: the impulse
  const gb = out[out.length - 2].high, gl = out[out.length - 2].low;
  push(base + s * 1700, base + s * 1900, (dir === 'bull' ? gb : gl) + s * gapH, base + s * 1800);                       // i: its low (bull) stays above i-2's high: the gap
  push(base + s * 1800, base + s * 2100, base + s * 1600, base + s * 1950);                                            // drifts on, never back near the gap
  if (returns) {
    const bot = dir === 'bull' ? out[out.length - 4].high : out[out.length - 2].high, top = dir === 'bull' ? out[out.length - 2].low : out[out.length - 4].low;   // the gap is [bot, top]
    const close = dir === 'bull' ? bot + retFrac * (top - bot) : top - retFrac * (top - bot), wick = dir === 'bull' ? bot + 0.5 * (top - bot) : bot + 0.5 * (top - bot);
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
