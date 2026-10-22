/* An alert is never sent for a candle that has not closed (#1651 finding 2, owner's decision 2026-10-22: "alert only on finished candles").
 *
 * THE ORACLE is the owner's rule, not the code: a message that has gone out cannot be taken back, so an alert may only be judged on candles
 * whose close has happened. The Arena chart deliberately keeps drawing its live marker on the forming candle, so the two surfaces disagree
 * for up to one candle BY DESIGN, and that is asserted here too rather than left as a comment.
 *
 * Three layers, because one of them alone would not catch a regression:
 *  1. `closedCandles` itself, on every timeframe, including the exact boundary.
 *  2. THE RULE: a market where the forming candle alone makes a new signal produces nothing from the closed candles, and the real signal
 *     appears once the candle closes. Found by a seeded search over random markets with the REAL `detectEMASignals`, so the test is about
 *     the signal rule rather than about a hand-made series that happens to work.
 *  3. The wiring: both alert paths and both preview branches pass their candles through the helper. A pure helper nobody calls is worth
 *     nothing, and the whole defect was a caller reading one candle too many.
 *
 * WHAT IT CANNOT PROVE: the cron end to end - a real Telegram send, the dedup key, two overlapping runs. Dev's probe on #1687 covers that
 * through the real route; this file is the rule and the wiring. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closedCandles, EMA_SIGNAL_TFS, type EMASignalTF } from '../lib/ribbonCandles.ts';
import { detectEMASignals, DEFAULT_FILTER_PARAMS, type OHLCV } from '../lib/strategyCore.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const TF_MS: Record<EMASignalTF, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '1d': 86_400_000,
};

/* ── 1. the helper ─────────────────────────────────────────────────────────── */

const bar = (time: number, close = 100): OHLCV => ({ time, open: close, high: close, low: close, close, volume: 1 });

test('C1. every timeframe: the forming candle is dropped, the one that closes exactly now is kept', () => {
  const now = Date.UTC(2026, 9, 22, 12, 0, 0);
  for (const tf of EMA_SIGNAL_TFS) {
    const span = TF_MS[tf];
    const candles = [
      bar(now - span * 3),   // closed long ago
      bar(now - span * 2),   // closed long ago
      bar(now - span),       // closes exactly NOW
      bar(now),              // still forming: closes one span from now
    ];
    const kept = closedCandles(candles, tf, now);
    assert.deepEqual(kept.map((c) => c.time), [now - span * 3, now - span * 2, now - span],
      `${tf}: expected the three closed candles and not the forming one`);
  }
});

test('C1b. the boundary is inclusive on the close and exclusive one millisecond before it', () => {
  const t = Date.UTC(2026, 9, 22, 11, 0, 0), tf: EMASignalTF = '1h', span = TF_MS[tf];
  assert.equal(closedCandles([bar(t)], tf, t + span).length, 1, 'a candle whose close time is exactly now has closed');
  assert.equal(closedCandles([bar(t)], tf, t + span - 1).length, 0, 'one millisecond before its close it is still forming');
});

test('C1c. the input is not mutated and the result is a new array', () => {
  const now = Date.UTC(2026, 9, 22, 12, 0, 0);
  const candles = [bar(now - 7_200_000), bar(now - 3_600_000), bar(now)];
  const before = JSON.stringify(candles);
  const kept = closedCandles(candles, '1h', now);
  assert.equal(JSON.stringify(candles), before, 'closedCandles changed the array it was given');
  assert.notEqual(kept, candles, 'the result is the same array object: a caller could mutate the input through it');
});

test('C1d. an empty series, and a series that is entirely unclosed, both give an empty result rather than throwing', () => {
  const now = Date.UTC(2026, 9, 22, 12, 0, 0);
  assert.deepEqual(closedCandles([], '15m', now), []);
  assert.deepEqual(closedCandles([bar(now), bar(now + 900_000)], '15m', now), []);
});

/* ── 2. the rule, against the real signal detector ─────────────────────────── */

/** A deterministic random walk. Plain LCG so the series is identical on every machine and in every container. */
function market(seed: number, n: number, startMs: number, spanMs: number): OHLCV[] {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: OHLCV[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = Math.max(1, open * (1 + (rnd() - 0.5) * 0.02));
    const high = Math.max(open, close) * (1 + rnd() * 0.004);
    const low = Math.min(open, close) * (1 - rnd() * 0.004);
    out.push({ time: startMs + i * spanMs, open, high, low, close, volume: 100 + rnd() * 50 });
    price = close;
  }
  return out;
}

const signalTimes = (candles: OHLCV[], tf: EMASignalTF) => {
  const { signalLongs, signalShorts } = detectEMASignals(candles, tf, DEFAULT_FILTER_PARAMS);
  return new Set([...signalLongs, ...signalShorts].map((s) => s.timestamp));
};

test('C2. THE RULE: a signal that exists only on the forming candle is not alerted, and appears once that candle closes', () => {
  const tf: EMASignalTF = '1h', span = TF_MS[tf];
  const start = Date.UTC(2026, 6, 1, 0, 0, 0);

  /* Search seeded markets for one where the newest, still-forming candle carries a signal that the earlier candles alone do not. This is
     the shape QA measured on #1651 (about 12% of armed signals, rough in both directions) and the shape Dev's probe reproduced.
     THE SEARCH DOES NOT USE `closedCandles`: it slices the newest candle off itself. An earlier version of this test asked the helper for
     the closed set here, so a helper that filtered nothing made the search find no market and the test failed on its own PRECONDITION -
     red, but pointing at the search instead of at the helper. Found by mutating the helper to a no-op. */
  let found: { candles: OHLCV[]; nowDuring: number; formingTime: number } | null = null;
  for (let seed = 1; seed <= 400 && !found; seed++) {
    const candles = market(seed, 120, start, span);
    const formingTime = candles[candles.length - 1].time;
    const nowDuring = formingTime + span / 2;                       // halfway through the newest candle
    const live = signalTimes(candles, tf);
    const withoutNewest = signalTimes(candles.slice(0, -1), tf);
    if (live.has(formingTime) && !withoutNewest.has(formingTime)) found = { candles, nowDuring, formingTime };
  }
  assert.ok(found, 'precondition: no seeded market produced a signal on the forming candle - the search, not the rule, needs looking at');
  const { candles, nowDuring, formingTime } = found;

  // Mid-candle: the alert path sees nothing for that candle.
  const duringAlert = signalTimes(closedCandles(candles, tf, nowDuring), tf);
  assert.equal(duringAlert.has(formingTime), false,
    'an alert would have gone out for a candle that had not closed - the thing the owner decided must not happen');

  // The same moment, the chart's own view (every candle) DOES carry it: the two surfaces differ by design.
  assert.equal(signalTimes(candles, tf).has(formingTime), true,
    'the chart no longer draws the live marker either: this test is about alerts, and chart parity was kept on purpose');

  // Once the candle closes, the alert path sees exactly that signal.
  const afterClose = signalTimes(closedCandles(candles, tf, formingTime + span), tf);
  assert.equal(afterClose.has(formingTime), true, 'the signal never arrives at all: the alert was dropped rather than delayed');
});

test('C2b. nothing else is dropped: a fully closed series survives the filter whole, candles and signals alike', () => {
  const tf: EMASignalTF = '1h', span = TF_MS[tf];
  const start = Date.UTC(2026, 6, 1, 0, 0, 0);
  for (const seed of [7, 23, 101, 999]) {
    const candles = market(seed, 160, start, span);
    const now = candles[candles.length - 1].time + span;            // every candle has closed
    /* The candle count first, and this is the assertion that matters. Comparing only the SIGNALS let a filter that dropped one extra
       candle pass whenever no signal happened to sit in it - found by mutating the helper to drop two windows instead of one, which
       changed nothing about these four seeds' signals. An alert delayed by a whole extra candle is the defect this file is about. */
    assert.deepEqual(closedCandles(candles, tf, now).map((c) => c.time), candles.map((c) => c.time),
      `seed ${seed}: a closed series lost a candle, so every alert on it would be late by that much`);
    assert.deepEqual([...signalTimes(closedCandles(candles, tf, now), tf)].sort(), [...signalTimes(candles, tf)].sort(),
      `seed ${seed}: filtering a fully closed series changed the signals, so the filter is doing more than dropping the forming candle`);
  }
});

/* ── 3. the wiring ────────────────────────────────────────────────────────── */

test('C3. both alert paths and both preview branches judge CLOSED candles', () => {
  const cron = read('app/api/telegram/alert/route.ts');
  for (const fn of ['checkEMASignal', 'checkStructureSignal']) {
    const at = cron.indexOf(`async function ${fn}(`);
    assert.ok(at > 0, `${fn} is gone from the cron route`);
    const body = cron.slice(at, at + 4000);
    assert.match(body, /closedCandles\(await fetchRibbonCandles\(/,
      `${fn} reads fetchRibbonCandles directly: it would judge the forming candle again`);
  }
  const preview = read('app/api/alerts/preview/route.ts');
  assert.match(preview, /detectEMASignals\(\s*\n?\s*closedCandles\(/, 'the preview\'s EMA branch does not filter to closed candles');
  assert.match(preview, /detectStructureSignals\(closedCandles\(/, 'the preview\'s structure branch does not filter to closed candles');
  assert.equal(preview.includes('detectEMASignals(\n          candles,'), false, 'the preview still passes the raw candles somewhere');
});

test('C3b. the timeframes the structure alert uses are all known to the helper, or every structure alert stops silently', () => {
  /* closedCandles types its timeframe as EMASignalTF and looks the span up in a table. A structure timeframe outside that set would make
     the span undefined, every comparison NaN, and EVERY structure alert vanish with no error and fired=0 - the silent-stop shape
     lib/ribbonCandles.ts's own header warns about. Asserted because the types that prevent it today are not what a future edit reads. */
  const structure = read('lib/structurePrefs.ts');
  const tfs = /STRUCTURE_TFS\s*=\s*\[([^\]]+)\]/.exec(structure)?.[1];
  assert.ok(tfs, 'STRUCTURE_TFS moved: re-read lib/structurePrefs.ts');
  const names = [...tfs.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(names.length > 0, 'STRUCTURE_TFS parsed as empty');
  for (const tf of names) {
    assert.ok((EMA_SIGNAL_TFS as readonly string[]).includes(tf), `structure timeframe ${tf} is not in EMA_SIGNAL_TFS, so closedCandles cannot measure it`);
    assert.equal(closedCandles([bar(0)], tf as EMASignalTF, TF_MS[tf as EMASignalTF]).length, 1, `closedCandles has no span for ${tf}`);
  }
});
