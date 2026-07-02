// Daily usage quotas reset at midnight UTC (server-side fact). This converts that
// instant into the viewer's own local wall-clock time — never hardcoded to any one
// timezone (not UTC, not PHT) — so it's correct for whoever is looking at the screen.
export function nextResetLocalTime(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Converts any fixed UTC clock time (e.g. a cron schedule) into the viewer's local
// wall-clock time — same principle as nextResetLocalTime, generalized to an arbitrary hour.
export function utcHourToLocalTime(utcHour: number, utcMinute = 0): string {
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, utcMinute, 0));
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
