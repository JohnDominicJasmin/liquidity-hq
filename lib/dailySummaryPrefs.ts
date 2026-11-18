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

/** Local calendar date (YYYY-MM-DD), hour and minute of an instant in `timeZone`. Null or a zone Intl rejects falls back to UTC, the same
 *  fallback the send window and every alert stamp use. */
export function localDateTime(timeZone: string | null, ms: number): { date: string; hour: number; min: number } {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms));
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), min: Number(get('minute')) };
  };
  try { return read(timeZone || 'UTC'); } catch { return read('UTC'); }
}

/* "ALREADY SENT" IS A LOCAL DATE, NOT A COOLDOWN (QA finding F1, PM 2026-11-18). A 23 h cooldown from the last send skipped a day for
 * anyone who moved the hour more than 1 h earlier (sent 09:05, new hour 07:00 the next morning = 22 h later = still cooling). Now:
 * due when the user's local clock is inside their chosen hour's window AND the last send (`lastSentAtMs`, the epoch ms the cron's
 * cooldown ledger already stores under daily_summary_<chatId>) fell on an EARLIER local date in their CURRENT timezone. So:
 *   - hour moved earlier after today's send: nothing more today, sends tomorrow at the new hour;
 *   - hour moved later before today's send: one send today at the new hour; after today's send: none more today;
 *   - timezone changed: "today" is judged in the new zone, so at most one send per local date there;
 *   - DST day: dates and hours come from Intl in the user's zone; a chosen hour that does not exist that day (spring-forward gap) is
 *     not sent that day; a repeated hour (fall-back) sends once, because the second pass is the same local date. */
export function summaryDueNow(lastSentAtMs: number | undefined, chosenHour: number, timeZone: string | null, nowMs: number): boolean {
  const now = localDateTime(timeZone, nowMs);
  if (!inSummaryWindow(now.hour, now.min, chosenHour)) return false;
  if (lastSentAtMs === undefined || !Number.isFinite(lastSentAtMs)) return true;
  return localDateTime(timeZone, lastSentAtMs).date < now.date;
}
