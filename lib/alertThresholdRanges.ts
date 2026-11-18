/* The ranges of the notification thresholds in Settings, in one place: the number fields' min / max (app/(main)/settings/page.tsx) and the
 * server's check (app/api/settings/route.ts) read the same table, so the page cannot offer a value the server stores differently.
 *
 * Each range only holds values the alert checks can actually reach:
 *   squeeze_threshold  40-80  the Telegram cron's calcSqueezeScore tops out at 80 (40 funding + 40 long/short). The field allowed 95, and any
 *                             value above 80 could never fire (#2560 open list). Below 40 is a single weak input, not a squeeze.
 *   rsi_ob / rsi_os    60-90 / 10-40  RSI(14) spans 0-100; both ends are reachable.
 *   fng_fear / fng_greed  1-40 / 60-99  the Fear & Greed index spans 0-100.
 *   fr_threshold       0.01-0.5 (%)   funding per 8 h; real extremes reach these.
 * Unchanged from the page's previous min / max except squeeze. */
export const SQUEEZE_SCORE_MAX = 80;

export const THRESHOLD_RANGES = {
  fr_threshold:      { min: 0.01, max: 0.5 },
  fng_fear:          { min: 1, max: 40 },
  fng_greed:         { min: 60, max: 99 },
  rsi_ob:            { min: 60, max: 90 },
  rsi_os:            { min: 10, max: 40 },
  squeeze_threshold: { min: 40, max: SQUEEZE_SCORE_MAX },
} as const;

export type ThresholdField = keyof typeof THRESHOLD_RANGES;

export function isThresholdField(key: string): key is ThresholdField {
  return Object.prototype.hasOwnProperty.call(THRESHOLD_RANGES, key);
}

/** The value brought inside its range, or null when it is not a finite number at all. */
export function clampThreshold(field: ThresholdField, value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const { min, max } = THRESHOLD_RANGES[field];
  return Math.min(max, Math.max(min, value));
}
