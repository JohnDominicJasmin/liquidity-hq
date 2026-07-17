/**
 * Chart pattern detection - pure OHLC logic.
 * Works in browser (MarketProvider, Arena) and Node.js (Telegram alert route).
 */

export interface Candle {
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
}

/**
 * Detect basic chart patterns from an array of OHLC candles (oldest → newest).
 * Returns array of pattern strings, empty if none found.
 */
export function detectPatterns(candles: Candle[]): string[] {
  if (candles.length < 6) return [];
  const found: string[] = [];

  const last = candles[candles.length - 1];

  // ── 1. Trend structure (last 10 candles - sequential highs/lows) ──
  const r10 = candles.slice(-10);
  const highs10 = r10.map(c => c.h);
  const lows10  = r10.map(c => c.l);
  const allHH = highs10.every((h, i) => i === 0 || h >= highs10[i - 1]);
  const allHL = lows10.every ((l, i) => i === 0 || l >= lows10[i - 1]);
  const allLH = highs10.every((h, i) => i === 0 || h <= highs10[i - 1]);
  const allLL = lows10.every ((l, i) => i === 0 || l <= lows10[i - 1]);
  if (allHH && allHL) found.push('Higher highs + higher lows (uptrend)');
  else if (allLH && allLL) found.push('Lower highs + lower lows (downtrend)');

  // ── 2. Engulfing (last 2 candles) ──
  if (candles.length >= 2) {
    const [p, c] = candles.slice(-2);
    const pr = Math.abs(p.c - p.o);
    const cr = Math.abs(c.c - c.o);
    if (p.c > p.o && c.c < c.o && c.o >= p.c && c.c <= p.o && cr >= pr * 0.8)
      found.push('Bearish engulfing');
    if (p.c < p.o && c.c > c.o && c.o <= p.c && c.c >= p.o && cr >= pr * 0.8)
      found.push('Bullish engulfing');
  }

  // ── 3. Doji - indecision (body < 10% of total range) ──
  const wick = last.h - last.l;
  if (wick > 0 && Math.abs(last.c - last.o) / wick < 0.1)
    found.push('Doji (indecision)');

  // ── 4. Hammer / Shooting star (last candle) ──
  const body  = Math.abs(last.c - last.o);
  const lower = Math.min(last.o, last.c) - last.l;
  const upper = last.h - Math.max(last.o, last.c);
  if (body > 0 && lower >= body * 2 && upper < body * 0.5)
    found.push(last.c >= last.o ? 'Hammer (bullish reversal)' : 'Hanging man');
  if (body > 0 && upper >= body * 2 && lower < body * 0.5)
    found.push(last.c <= last.o ? 'Shooting star (bearish reversal)' : 'Inverted hammer');

  // ── 5. Tight consolidation → flag detection ──
  const last6  = candles.slice(-6);
  const rangeHi = Math.max(...last6.map(c => c.h));
  const rangeLo = Math.min(...last6.map(c => c.l));
  const tightRange = last6[last6.length - 1].c > 0 &&
    (rangeHi - rangeLo) / last6[last6.length - 1].c < 0.015;

  if (tightRange && candles.length >= 11) {
    // Check for flag pole (sharp move in prior 5 candles)
    const pole = candles.slice(-11, -6);
    const poleMove = pole.length > 0
      ? (pole[pole.length - 1].c - pole[0].o) / Math.abs(pole[0].o) * 100
      : 0;
    if (Math.abs(poleMove) > 3) {
      found.push(poleMove > 0
        ? 'Bull flag (sharp rally + tight consolidation)'
        : 'Bear flag (sharp drop + tight consolidation)');
    } else {
      found.push('Tight consolidation (compression - breakout pending)');
    }
  }

  // ── 6. Double top / Double bottom (last 20 candles) ──
  if (candles.length >= 20) {
    const r20 = candles.slice(-20);
    // Find two highest highs - if within 0.5% of each other with a valley between = double top
    let h1i = 0, h2i = 0;
    r20.forEach((c, i) => {
      if (c.h > r20[h1i].h) { h2i = h1i; h1i = i; }
      else if (c.h > r20[h2i].h && i !== h1i) h2i = i;
    });
    if (h1i !== h2i && Math.abs(h1i - h2i) >= 3) {
      const pctDiff = Math.abs(r20[h1i].h - r20[h2i].h) / r20[h1i].h;
      if (pctDiff < 0.005) found.push('Double top (bearish reversal setup)');
    }
    // Two lowest lows
    let l1i = 0, l2i = 0;
    r20.forEach((c, i) => {
      if (c.l < r20[l1i].l) { l2i = l1i; l1i = i; }
      else if (c.l < r20[l2i].l && i !== l1i) l2i = i;
    });
    if (l1i !== l2i && Math.abs(l1i - l2i) >= 3) {
      const pctDiff = Math.abs(r20[l1i].l - r20[l2i].l) / r20[l1i].l;
      if (pctDiff < 0.005) found.push('Double bottom (bullish reversal setup)');
    }
  }

  return found;
}

/** Convenience: returns comma-separated string or empty string */
export function detectPatternsStr(candles: Candle[]): string {
  return detectPatterns(candles).join('; ');
}

/** Pattern bias: 'bullish' | 'bearish' | 'neutral' | null */
export function patternBias(patterns: string[]): 'bullish' | 'bearish' | 'neutral' | null {
  if (patterns.length === 0) return null;
  const bullRx = /bull|higher high|engulf.*bull|hammer(?! man)|morning|double bot/i;
  const bearRx = /bear|lower high|engulf.*bear|shooting|hanging|double top|evening/i;
  const hasBull = patterns.some(p => bullRx.test(p));
  const hasBear = patterns.some(p => bearRx.test(p));
  if (hasBull && !hasBear) return 'bullish';
  if (hasBear && !hasBull) return 'bearish';
  if (hasBull || hasBear) return 'neutral';
  return 'neutral';
}
