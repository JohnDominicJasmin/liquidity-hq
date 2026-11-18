/* Whether a Telegram alert may go to one person right now (owner sweep 2026-11-18).
 *
 * Three holds, all stored on user_settings and all optional (null = not set):
 *   alert_paused        true after /pause in the bot, until /resume or Resume on /alerts
 *   alert_snooze_until  a time; nothing is sent before it (the 1 h / 4 h / tomorrow buttons on /alerts)
 *   alert_quiet_start / alert_quiet_end   whole hours 0-23 in the person's own timezone (user_settings.timezone, UTC when unknown).
 *                       start < end: quiet from start up to (not including) end, e.g. 1-7 = 01:00-06:59.
 *                       start > end: the window crosses midnight, e.g. 22-7 = 22:00-06:59.
 *                       start == end, or either one null: no quiet hours.
 *
 * Pure and dependency-free so QA can pin it directly; the alert cron reads the rows (lib/telegramAlertHolds.ts) and calls this. */

export interface AlertHoldSettings {
  alert_paused?: boolean | null;
  alert_snooze_until?: string | null;
  alert_quiet_start?: number | null;
  alert_quiet_end?: number | null;
  timezone?: string | null;
}

export type AlertHold = 'paused' | 'snoozed' | 'quiet' | null;

/** A whole hour 0-23. Anything else (a string, 24, 7.5, NaN) is not a quiet-hours bound. */
export function isQuietHour(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
}

/** The hour 0-23 on the wall clock of `timeZone` at `nowMs`. An unknown or invalid zone reads as UTC. */
export function localHourIn(timeZone: string | null | undefined, nowMs: number): number {
  const d = new Date(nowMs);
  if (timeZone) {
    try {
      const part = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' })
        .formatToParts(d).find((p) => p.type === 'hour');
      const h = part ? parseInt(part.value, 10) : NaN;
      if (Number.isFinite(h)) return h % 24;
    } catch { /* invalid zone: UTC below */ }
  }
  return d.getUTCHours();
}

/** True when `hour` falls inside the quiet window [start, end). Crosses midnight when start > end. */
export function inQuietWindow(start: number | null | undefined, end: number | null | undefined, hour: number): boolean {
  if (!isQuietHour(start) || !isQuietHour(end) || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Which hold stops alerts for this person at `nowMs`, or null when alerts may be sent. Paused wins over snoozed, snoozed over quiet. */
export function alertHoldAt(s: AlertHoldSettings | null | undefined, nowMs: number): AlertHold {
  if (!s) return null;
  if (s.alert_paused === true) return 'paused';
  if (s.alert_snooze_until) {
    const until = Date.parse(s.alert_snooze_until);
    if (Number.isFinite(until) && nowMs < until) return 'snoozed';
  }
  if (inQuietWindow(s.alert_quiet_start, s.alert_quiet_end, localHourIn(s.timezone, nowMs))) return 'quiet';
  return null;
}

/** True when no Telegram alert may go to this person at `nowMs` (paused, snoozed, or inside quiet hours). */
export function isQuietNow(s: AlertHoldSettings | null | undefined, nowMs: number): boolean {
  return alertHoldAt(s, nowMs) !== null;
}
