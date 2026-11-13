// Daily usage quotas reset at midnight UTC (server-side fact). This converts that
// instant into the viewer's own local wall-clock time - never hardcoded to any one
// timezone - not UTC, and not a single fixed zone - so it's correct for whoever is looking.
export function nextResetLocalTime(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  // timeZoneName: 'short' - the value was already correctly localized, but the
  // string alone ("8:00 AM") didn't say which zone that was, ambiguous to the
  // viewer (AUDIT.md AUTH-7). Label it explicitly instead of hardcoding one zone.
  return next.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

// Converts any fixed UTC clock time (e.g. a cron schedule) into the viewer's local
// wall-clock time - same principle as nextResetLocalTime, generalized to an arbitrary hour.
export function utcHourToLocalTime(utcHour: number, utcMinute = 0): string {
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, utcMinute, 0));
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

/**
 * The viewer's own timezone abbreviation ("GMT+8", "BST", "EDT"), for labelling a
 * clock that is already rendering their local time. Replaces a hardcoded zone label
 * suffixes, which claimed one specific zone for a number that was never in it.
 */
export function localZoneAbbr(): string {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date());
  return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
}

/**
 * Renders a fixed UTC window (a market session from lib/session.ts) as a range in
 * the viewer's own timezone, e.g. London Open 07:00-10:00 UTC shows as
 * "3:00 PM - 6:00 PM GMT+8" in Manila and "8:00 AM - 11:00 AM BST" in London.
 *
 * These used to be pre-baked strings in the labels table, written in one fixed zone,
 * which meant every trader elsewhere read someone else's clock - and the strings
 * drifted from the enforced UTC logic besides (the London label claimed
 * "9:30-11AM UTC" while session.ts uses 07:00-10:00).
 *
 * `utcDay` pins the window to a UTC weekday (0=Sun) for windows like God Tier;
 * omit it for daily windows. Weekday names are included whenever the window is
 * day-pinned or straddles local midnight, since "Sun 11 PM - Mon 3 AM" is a
 * different claim from "11 PM - 3 AM" and the viewer's day can differ from UTC's.
 */
export function utcWindowToLocalRange(
  startHour: number, startMin: number,
  endHour: number, endMin: number,
  utcDay?: number,
  /** The SITE language (not the browser's). When it is not English the range reads in the 24-hour form with that language's own weekday names, the same shape the daily session line already has (#1185, PM); English keeps the browser's own format. */
  locale?: string,
): string {
  const now = new Date();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (utcDay !== undefined) {
    base.setUTCDate(base.getUTCDate() + ((utcDay - base.getUTCDay() + 7) % 7));
  }
  const start = new Date(base.getTime()); start.setUTCHours(startHour, startMin, 0, 0);
  const end   = new Date(base.getTime()); end.setUTCHours(endHour, endMin, 0, 0);
  // A window whose end is not after its start crosses UTC midnight (e.g. Asia
  // 23:00-03:00), so the end belongs to the following day.
  if (end.getTime() <= start.getTime()) end.setUTCDate(end.getUTCDate() + 1);

  const siteLocale = locale && locale !== 'en' ? locale : undefined;
  const time = (d: Date, withZone: boolean) => d.toLocaleTimeString(siteLocale, {
    hour: siteLocale ? '2-digit' : 'numeric', minute: '2-digit', ...(siteLocale ? { hourCycle: 'h23' as const } : {}), ...(withZone ? { timeZoneName: 'short' as const } : {}),
  });
  const showDay = utcDay !== undefined
    || start.toLocaleDateString(undefined) !== end.toLocaleDateString(undefined);
  const day = (d: Date) => d.toLocaleDateString(siteLocale, { weekday: 'short' });

  const from = showDay ? `${day(start)} ${time(start, false)}` : time(start, false);
  const to   = showDay ? `${day(end)} ${time(end, true)}`      : time(end, true);
  return `${from} - ${to}`;
}
