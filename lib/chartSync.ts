/* Keeping the chart's period, its candles and the selected timeframe in agreement (#1572). Pure, so it can be tested without a chart.
 *
 * Three ways they were measured to disagree, all on localhost with the real chart:
 *   1. The timeframe changed BEFORE the chart object existed (the chart is created after an async import). The chart was then
 *      created on the stale timeframe from mount time, and nothing ever re-synced it: period 1h, selected 4h.
 *   2. klinecharts keeps the previous candle list until the new load calls back, so a load that never lands leaves the old
 *      timeframe's candles under the new period (30-minute candles under "1 minute").
 *   3. A history load that failed (offline) was never retried: 0 bars until the user switched timeframe again.
 * One cheap periodic check heals 1 and 2 whatever caused them; 3 has its own backoff. */

export type ChartPeriod = { span: number; type: string };

const UNIT_MS: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 };

/** The length of one candle of a period, or null for a unit this does not know (month and year are not offered). */
export function periodMs(p: ChartPeriod | null | undefined): number | null {
  if (!p) return null;
  const u = UNIT_MS[p.type];
  return u && Number.isFinite(p.span) && p.span > 0 ? u * p.span : null;
}

/** The typical spacing of the candles at the end of a list: the median gap between consecutive timestamps. The median, not the
 *  last gap, so one missing candle or a half-formed one does not read as another timeframe. Null when there is too little data. */
export function medianBarStepMs(timestamps: number[], sample = 12): number | null {
  const ts = timestamps.slice(-sample);
  if (ts.length < 4) return null;
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) { const g = ts[i] - ts[i - 1]; if (g > 0) gaps.push(g); }
  if (gaps.length < 3) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** How long the load for the current timeframe may stay unanswered before it is treated as lost and started again. History fetches
 *  retry for roughly 15 s and fall back to a second exchange, so this is well past a slow answer. */
export const STALE_LOAD_MS = 45_000;

export type ChartCheck =
  | { ok: true }
  | { ok: false; heal: 'set-period' | 'reload'; reason: string };

/** What, if anything, is wrong. `loadDelivered` is whether the load for the CURRENT timeframe has called back: until it has, the
 *  candle list is legitimately still the previous timeframe's, so only the period and the age of the load are judged. */
export function checkChartSync(i: {
  wanted: ChartPeriod;
  actual: ChartPeriod | null;
  timestamps: number[];
  loadDelivered: boolean;
  loadAgeMs: number;
}): ChartCheck {
  const want = periodMs(i.wanted);
  const have = periodMs(i.actual);
  if (want === null) return { ok: true };
  if (have !== want) return { ok: false, heal: 'set-period', reason: `chart period ${i.actual ? i.actual.span + i.actual.type : 'none'} but ${i.wanted.span}${i.wanted.type} is selected` };
  if (!i.loadDelivered) {
    return i.loadAgeMs > STALE_LOAD_MS ? { ok: false, heal: 'reload', reason: `history load unanswered for ${Math.round(i.loadAgeMs / 1000)} s` } : { ok: true };
  }
  const step = medianBarStepMs(i.timestamps);
  if (step !== null && step !== want) return { ok: false, heal: 'reload', reason: `candles are ${Math.round(step / 60_000)} min apart but ${Math.round(want / 60_000)} min is selected` };
  return { ok: true };
}

/** Backoff for retrying a history load that failed: 5 s, 10 s, 20 s, 40 s, then every 60 s. */
export const HISTORY_RETRY_BASE_MS = 5_000;
export const HISTORY_RETRY_MAX_MS = 60_000;
export function historyRetryDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return Math.min(HISTORY_RETRY_BASE_MS * 2 ** n, HISTORY_RETRY_MAX_MS);
}
