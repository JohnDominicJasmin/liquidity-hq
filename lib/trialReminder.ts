/* The trial-ending-soon cutoff for app/api/trial-reminder/route.ts (#1227).
 *
 * Pure and dependency-free so QA can test it directly rather than only
 * through a live cron run - same shape as closedCandleTtl (lib/candles.ts)
 * and paidPeriodLapsed (lib/paidPeriod.ts): the route passes Date.now(), a
 * test passes whatever instant it wants to assert against.
 */

/**
 * The upper bound of the "trial ends soon" window: any trial ending at or
 * before this instant is due a reminder. The route also filters on
 * `trial_ends_at > now` directly - that boundary needs no extraction, since
 * it is `nowMs` itself with no arithmetic to get wrong.
 */
export function trialReminderCutoff(nowMs: number, windowDays: number): string {
  return new Date(nowMs + windowDays * 86_400_000).toISOString();
}
