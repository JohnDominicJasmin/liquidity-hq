/* The daily-summary preferences that both the browser (/alerts, lib/settings.ts) and the cron read. No imports on purpose: the
   browser bundle must not pull in the exchange fetchers that lib/dailySummary.ts carries. Why it is opt-in: lib/dailySummary.ts. */
export const DAILY_SUMMARY_ON_KEY = 'daily_summary_on';
export const DEFAULT_DAILY_SUMMARY_HOUR = 7;
/** Minutes after the chosen hour in which a cron tick still sends (ticks are every 5 minutes; two slow ticks must not skip the day). */
export const DAILY_SUMMARY_WINDOW_MIN = 30;

/* Only the opt-in row decides. The legacy `daily_summary` mute row is ignored: nobody holds the new row until they switch it on, so an old
   mute is already OFF, and honouring it as well would leave a user who switches it back on with a page saying ON and a cron saying OFF. */
export function isDailySummaryOn(keys: Set<string> | undefined): boolean {
  return keys?.has(DAILY_SUMMARY_ON_KEY) ?? false;
}

/** A stored or submitted hour is valid when it is null (use the default) or a whole number 0-23. */
export function isValidSummaryHour(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23);
}

/** The hour to send at: the stored one when valid, else 7. */
export function summaryHour(raw: unknown): number {
  return typeof raw === 'number' && isValidSummaryHour(raw) ? raw : DEFAULT_DAILY_SUMMARY_HOUR;
}

/** Inside the send window: the chosen local hour, minutes 0-30 inclusive. */
export function inSummaryWindow(localHour: number, localMin: number, chosenHour: number): boolean {
  return localHour === chosenHour && localMin <= DAILY_SUMMARY_WINDOW_MIN;
}

/** "07:00" for 7. */
export function formatSummaryHour(hour: number): string {
  return `${String(summaryHour(hour)).padStart(2, '0')}:00`;
}
