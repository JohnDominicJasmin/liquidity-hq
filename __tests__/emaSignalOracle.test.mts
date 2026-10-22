/* #1651 layer 4: the EMA and the EMA ribbon BUY/SELL signal, held to an oracle written here, never to the code under test.
 *
 * THE EMA ORACLE is the textbook definition (StockCharts ChartSchool, "Moving Averages"): the first value is the simple average of the
 * first N closes, on the N-th close; after that EMA = close * k + previous * (1 - k) with k = 2 / (N + 1); nothing before the N-th close.
 * M1 checks two series worked by hand (exact arithmetic), then M2 runs every copy of the formula in the app against a separate 6-line
 * oracle on random series. There are four copies (lib/grok.ts calcEMA, lib/strategyCore.ts emaArr, app/api/signal-accuracy emaArr,
 * components/KLineProChart computeEmaSeries); M3 fails when a fifth appears, so it is added here before it can drift.
 *
 * THE SIGNAL ORACLE is the rule as lib/strategyCore.ts states it in prose (DEFAULT mode, which the chart and the default alert use): an
 * EMA9/20 cross arms a direction; while the ribbon stays crossed, the first candle that CLOSES beyond EMA50, with EMA50's 5-candle slope
 * not falling (long) or rising (short) by 0.1% or more, confirms it at once; directions alternate; the stop is EMA50 -/+ 0.5% at the
 * confirming candle and the target 2R from that close. S1 re-derives every signal on 40 random 300-candle series with an implementation
 * written from that text and compares each with detectEMASignals. S2 pins that the alert cron, the alert preview, the chart hook and the
 * backtest all call that one function.
 *
 * WHAT IT CANNOT PROVE: the STRICT (Anti-Chop) mode (ATR clearance, spread and hold), that exchange candles equal TradingView's, or that
 * TradingView seeds its EMA the same way (with 300 candles the seed's weight on EMA50 is below 0.001%, so the lines agree in practice). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { calcEMA } from '../lib/grok.ts';
import { emaArr, detectEMASignals, DEFAULT_FILTER_PARAMS, type OHLCV } from '../lib/strategyCore.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const cut = (src: string, re: RegExp, label: string) => {
  const all = [...src.matchAll(new RegExp(re.source, 'g'))];
  assert.equal(all.length, 1, `${label}: found ${all.length} times, not once - re-read the source`);
  return all[0][0];
};
/** Replace exactly once, or fail: a type annotation that moved must not leave a copy untested. */
const once = (s: string, from: string, to: string) => {
  assert.equal(s.split(from).length - 1, 1, `"${from}" is not in the cut-out source exactly once`);
  return s.replace(from, () => to);
};

/* The two copies that are not exported are cut out of their files and evaluated with their type annotations removed. */
const SA_SRC = once(once(cut(stripTsComments(read('app/api/signal-accuracy/route.ts')), /function emaArr\([\s\S]*?\n\}\n/, 'signal-accuracy emaArr'),
  'function emaArr(closes: number[], period: number): number[] {', 'function emaArr(closes, period) {'), 'new Array<number>(', 'new Array(');
const saEma = new Function(`${SA_SRC}\nreturn emaArr;`)() as (c: number[], p: number) => number[];
const KL_SRC = once(once(cut(stripTsComments(read('components/KLineProChart.tsx')), /function computeEmaSeries\([\s\S]*?\n\}\n/, 'KLineProChart computeEmaSeries'),
  'function computeEmaSeries(bars: Array<{ timestamp: number; close: number }>, period: number): EmaPoint[] {', 'function computeEmaSeries(bars, period) {'),
  'const out: EmaPoint[] = ', 'const out = ');
const klSeries = new Function(`${KL_SRC}\nreturn computeEmaSeries;`)() as (b: { timestamp: number; close: number }[], p: number) => { timestamp: number; value: number }[];
const klEma = (c: number[], p: number) => {
  const pts = klSeries(c.map((close, i) => ({ timestamp: i, close })), p);
  const out = new Array<number>(c.length).fill(NaN);
  for (const pt of pts) out[pt.timestamp] = pt.value;
  return out;
};
const COPIES: Array<[string, (c: number[], p: number) => (number | null)[]]> = [
  ['lib/grok.ts calcEMA', calcEMA], ['lib/strategyCore.ts emaArr', emaArr], ['app/api/signal-accuracy emaArr', saEma], ['components/KLineProChart computeEmaSeries', klEma],
];
const undef = (v: number | null | undefined) => v == null || Number.isNaN(v);

/** The oracle: SMA seed on the N-th close, then k = 2 / (N + 1). Written from the definition, not from any copy above. */
function oracleEma(c: number[], n: number): number[] {
  const out = c.map(() => NaN);
  if (c.length < n) return out;
  let e = 0; for (let i = 0; i < n; i++) e += c[i] / n;
  out[n - 1] = e;
  for (let i = n; i < c.length; i++) { e = e + (2 / (n + 1)) * (c[i] - e); out[i] = e; }
  return out;
}

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A random walk whose drift changes every 20-60 candles, so the ribbon crosses both ways. */
function candles(n: number, seed: number): OHLCV[] {
  const r = rng(seed);
  const out: OHLCV[] = [];
  let close = 100 * (0.5 + r()), drift = 0, left = 0;
  for (let i = 0; i < n; i++) {
    if (left-- <= 0) { drift = (r() - 0.5) * 0.012; left = 20 + Math.floor(r() * 40); }
    const open = close;
    close = Math.max(0.01, open * (1 + drift + (r() - 0.5) * 0.02));
    out.push({ time: 1_700_000_000_000 + i * 3_600_000, open, high: Math.max(open, close) * (1 + r() * 0.005), low: Math.min(open, close) * (1 - r() * 0.005), close, volume: 1000 * r() });
  }
  return out;
}

test('M1. the EMA matches two series worked by hand: SMA seed on the N-th close, then k = 2 / (N + 1)', () => {
  const cases: Array<[number[], number, (number | null)[]]> = [
    [[2, 4, 6, 8, 10, 12], 3, [null, null, 4, 6, 8, 10]],                 // k = 0.5
    [[10, 11, 12, 13, 14, 15, 16], 4, [null, null, null, 11.5, 12.5, 13.5, 14.5]], // k = 0.4: 14*.4 + 11.5*.6 = 12.5 ...
  ];
  for (const [name, f] of COPIES) {
    for (const [closes, n, want] of cases) {
      const got = f(closes, n);
      assert.equal(got.length, closes.length, `${name}: length`);
      want.forEach((w, i) => {
        if (w === null) assert.ok(undef(got[i]), `${name}: N=${n} bar ${i} should be undefined, got ${got[i]}`);
        else assert.ok(Math.abs((got[i] as number) - w) < 1e-12, `${name}: N=${n} bar ${i}: want ${w}, got ${got[i]}`);
      });
    }
    assert.ok(f([1, 2], 3).every(undef), `${name}: fewer closes than the period must give no EMA at all`);
  }
});

test('M2. every copy equals the oracle on 30 random series, for the periods the app draws (9, 20, 50, 100, 200)', () => {
  for (let s = 1; s <= 30; s++) {
    const closes = candles(300, s).map((c) => c.close);
    for (const n of [9, 20, 50, 100, 200]) {
      const want = oracleEma(closes, n);
      for (const [name, f] of COPIES) {
        const got = f(closes, n);
        for (let i = 0; i < closes.length; i++) {
          if (Number.isNaN(want[i])) { assert.ok(undef(got[i]), `${name} seed ${s} N=${n} bar ${i}: should be undefined`); continue; }
          assert.ok(Math.abs((got[i] as number) - want[i]) <= 1e-9 * want[i], `${name} seed ${s} N=${n} bar ${i}: want ${want[i]}, got ${got[i]}`);
        }
      }
    }
  }
});

test('M3. the EMA smoothing factor 2 / (N + 1) is computed in exactly the four files tested above', () => {
  const files = ['app/api/signal-accuracy/route.ts', 'components/KLineProChart.tsx', 'lib/grok.ts', 'lib/strategyCore.ts'];
  const K = /=\s*2\s*\/\s*\(\s*[A-Za-z_]\w*\s*\+\s*1\s*\)/;
  assert.match('const k = 2 / (period + 1);', K, 'the detector misses the known form');
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const e of (readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }))) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(rel); continue; }
      if (/\.(ts|tsx)$/.test(e.name) && K.test(stripTsComments(read(rel)))) found.push(rel);
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(d);
  assert.deepEqual(found.sort(), files, 'a new EMA copy: add it to COPIES in this file, or import emaArr from lib/strategyCore.ts instead');
});

/* ── the BUY/SELL signal ───────────────────────────────────────────────── */

type Sig = { dir: 'long' | 'short'; armIndex: number; index: number; sl: number; tp: number };

/** The DEFAULT-mode rule, written from lib/strategyCore.ts's prose (see the header), on the oracle EMA. */
function oracleSignals(c: OHLCV[]): Sig[] {
  const cl = c.map((x) => x.close);
  const e9 = oracleEma(cl, 9), e20 = oracleEma(cl, 20), e50 = oracleEma(cl, 50);
  const slopeOK = (k: number, dir: 'long' | 'short') => {
    if (k < 5 || Number.isNaN(e50[k - 5])) return true;
    const s = (e50[k] - e50[k - 5]) / e50[k - 5];
    return dir === 'long' ? s > -0.001 : s < 0.001;
  };
  const out: Sig[] = [];
  let last: 'long' | 'short' | null = null;
  for (let i = 1; i < c.length; i++) {
    if (Number.isNaN(e9[i]) || Number.isNaN(e20[i])) continue;
    for (const dir of ['long', 'short'] as const) {
      const up = dir === 'long';
      const crossed = up ? e9[i] > e20[i] && e9[i - 1] <= e20[i - 1] : e9[i] < e20[i] && e9[i - 1] >= e20[i - 1];
      if (!crossed || last === dir) continue;
      for (let k = i; k < c.length; k++) {
        if (up ? e9[k] < e20[k] : e9[k] > e20[k]) break;
        if (Number.isNaN(e50[k])) continue;
        if ((up ? cl[k] > e50[k] : cl[k] < e50[k]) && slopeOK(k, dir)) {
          const sl = up ? e50[k] * 0.995 : e50[k] * 1.005;
          out.push({ dir, armIndex: i, index: k, sl, tp: cl[k] + (cl[k] - sl) * 2 });
          last = dir;
          break;
        }
      }
    }
  }
  return out;
}

test('S1. detectEMASignals (DEFAULT mode) gives exactly the oracle\'s signals on 40 random series: same candles, direction, stop and target', () => {
  let total = 0;
  for (let s = 1; s <= 40; s++) {
    const c = candles(300, 1000 + s);
    const { signalLongs, signalShorts } = detectEMASignals(c, '1h', DEFAULT_FILTER_PARAMS);
    const got = [...signalLongs, ...signalShorts].sort((a, b) => a.armIndex - b.armIndex || a.index - b.index);
    const want = oracleSignals(c).sort((a, b) => a.armIndex - b.armIndex || a.index - b.index);
    assert.equal(got.length, want.length, `seed ${1000 + s}: ${got.length} signals, the rule gives ${want.length}`);
    want.forEach((w, j) => {
      const g = got[j];
      assert.deepEqual([g.dir, g.armIndex, g.index, g.pending], [w.dir, w.armIndex, w.index, false], `seed ${1000 + s} signal ${j}`);
      assert.equal(g.timestamp, c[w.armIndex].time, 'the marker sits on the arming cross');
      assert.ok(Math.abs(g.sl - w.sl) <= 1e-9 * w.sl && Math.abs(g.tp - w.tp) <= 1e-9 * Math.abs(w.tp), `seed ${1000 + s} signal ${j}: stop/target`);
    });
    for (let j = 1; j < got.length; j++) assert.notEqual(got[j].dir, got[j - 1].dir, `seed ${1000 + s}: two ${got[j].dir} signals in a row`);
    total += got.length;
  }
  assert.ok(total >= 80, `only ${total} signals over 40 series: the generator no longer exercises the rule`);
});

test('S2. one signal: the alert cron, the alert preview, the chart hook and the backtest all call detectEMASignals', () => {
  for (const f of ['app/api/telegram/alert/route.ts', 'app/api/alerts/preview/route.ts', 'lib/useEMAStrategy.ts', 'lib/backtestEngine.ts']) {
    assert.match(stripTsComments(read(f)), /detectEMASignals\(/, `${f} no longer calls detectEMASignals`);
  }
  for (const f of ['app/api/telegram/alert/route.ts', 'app/api/alerts/preview/route.ts']) {
    assert.match(stripTsComments(read(f)), /fetchRibbonCandles\(/, `${f} no longer reads the same candles as the other alert path`);
  }
});
