export interface Window {
  name: string;
  label: string;
  color: string;
  bg: string;
}

// All session detection runs in UTC so it works correctly for every timezone.
// PHT (UTC+8) equivalent UTC times are noted in comments.

function utc(d: Date): { day: number; mins: number } {
  return { day: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/* ── Market holidays ──────────────────────────────────────────────────────
   Reduced/zero liquidity windows for the four sessions this app tracks.
   Dates are the region's own local calendar date (fixed UTC offset — DST is
   ignored, at most an hour off near a session boundary, which doesn't
   change which day a holiday falls on for these purposes).
   Sourced 2026-07 from SIFMA/NYSE (NY), gov.uk (London), Nippon.com/Japan
   Travel (Asia/Tokyo), China Briefing / State Council notice (China).
   Update this table at the start of each year. ── */

export type HolidayRegion = 'NY' | 'London' | 'Asia' | 'China';

interface HolidayRange { start: string; end: string; name: string } // 'YYYY-MM-DD' inclusive

const REGION_UTC_OFFSET: Record<HolidayRegion, number> = {
  NY: -5, London: 0, Asia: 9, China: 8,
};

const HOLIDAYS_2026: Record<HolidayRegion, HolidayRange[]> = {
  NY: [
    { start: '2026-01-01', end: '2026-01-01', name: "New Year's Day" },
    { start: '2026-01-19', end: '2026-01-19', name: 'Martin Luther King Jr. Day' },
    { start: '2026-02-16', end: '2026-02-16', name: "Presidents' Day" },
    { start: '2026-04-03', end: '2026-04-03', name: 'Good Friday' },
    { start: '2026-05-25', end: '2026-05-25', name: 'Memorial Day' },
    { start: '2026-06-19', end: '2026-06-19', name: 'Juneteenth' },
    { start: '2026-07-03', end: '2026-07-03', name: 'Independence Day (observed)' },
    { start: '2026-09-07', end: '2026-09-07', name: 'Labor Day' },
    { start: '2026-11-26', end: '2026-11-26', name: 'Thanksgiving Day' },
    { start: '2026-12-25', end: '2026-12-25', name: 'Christmas Day' },
  ],
  London: [
    { start: '2026-01-01', end: '2026-01-01', name: "New Year's Day" },
    { start: '2026-04-03', end: '2026-04-03', name: 'Good Friday' },
    { start: '2026-04-06', end: '2026-04-06', name: 'Easter Monday' },
    { start: '2026-05-04', end: '2026-05-04', name: 'Early May Bank Holiday' },
    { start: '2026-05-25', end: '2026-05-25', name: 'Spring Bank Holiday' },
    { start: '2026-08-31', end: '2026-08-31', name: 'Summer Bank Holiday' },
    { start: '2026-12-25', end: '2026-12-25', name: 'Christmas Day' },
    { start: '2026-12-28', end: '2026-12-28', name: 'Boxing Day (substitute)' },
  ],
  Asia: [
    { start: '2026-01-01', end: '2026-01-01', name: "New Year's Day" },
    { start: '2026-01-12', end: '2026-01-12', name: 'Coming of Age Day' },
    { start: '2026-02-11', end: '2026-02-11', name: 'National Foundation Day' },
    { start: '2026-02-23', end: '2026-02-23', name: "Emperor's Birthday" },
    { start: '2026-03-20', end: '2026-03-20', name: 'Spring Equinox Day' },
    { start: '2026-04-29', end: '2026-05-06', name: 'Golden Week' },
    { start: '2026-07-20', end: '2026-07-20', name: 'Marine Day' },
    { start: '2026-08-11', end: '2026-08-11', name: 'Mountain Day' },
    { start: '2026-09-19', end: '2026-09-23', name: 'Silver Week' },
    { start: '2026-10-12', end: '2026-10-12', name: 'Sports Day' },
    { start: '2026-11-03', end: '2026-11-03', name: 'Culture Day' },
    { start: '2026-11-22', end: '2026-11-22', name: 'Labor Thanksgiving Day' },
  ],
  China: [
    { start: '2026-01-01', end: '2026-01-03', name: "New Year's Day" },
    { start: '2026-02-15', end: '2026-02-23', name: 'Spring Festival' },
    { start: '2026-04-04', end: '2026-04-06', name: 'Qingming Festival' },
    { start: '2026-05-01', end: '2026-05-05', name: 'Labour Day' },
    { start: '2026-06-19', end: '2026-06-21', name: 'Dragon Boat Festival' },
    { start: '2026-09-25', end: '2026-09-27', name: 'Mid-Autumn Festival' },
    { start: '2026-10-01', end: '2026-10-07', name: 'National Day Golden Week' },
  ],
};

function localDateStr(d: Date, utcOffsetHours: number): string {
  const t = new Date(d.getTime() + utcOffsetHours * 3600_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// Returns the holiday name if `d` falls on a holiday for that region, else null.
export function getHoliday(region: HolidayRegion, d: Date): string | null {
  const dateStr = localDateStr(d, REGION_UTC_OFFSET[region]);
  const ranges = HOLIDAYS_2026[region] ?? [];
  const hit = ranges.find(r => dateStr >= r.start && dateStr <= r.end);
  return hit ? hit.name : null;
}

// All regions currently on holiday for `d` — including China, which has no
// dedicated session window in this file but is still worth surfacing.
export function getActiveHolidays(d: Date): { region: HolidayRegion; name: string }[] {
  return (['NY', 'London', 'Asia', 'China'] as const)
    .map(region => ({ region, name: getHoliday(region, d) }))
    .filter((h): h is { region: HolidayRegion; name: string } => h.name !== null);
}

// Returns current time — no timezone conversion needed; UTC methods handle it.
export function getLocalNow(): Date {
  return new Date();
}

// God Tier: Sun 15:00–19:00 UTC (Sun 11PM – Mon 3AM PHT)
export function isGodTier(d: Date): boolean {
  const { day, mins } = utc(d);
  return day === 0 && mins >= 900 && mins < 1140;
}

// Prime: Daily 18:00–21:00 UTC (2AM – 5AM PHT)
export function isPrime(d: Date): boolean {
  const { mins } = utc(d);
  return mins >= 1080 && mins < 1260;
}

// Mon Evening: Mon 12:00–15:00 UTC (8PM – 11PM PHT)
export function isMonEvening(d: Date): boolean {
  const { day, mins } = utc(d);
  return day === 1 && mins >= 720 && mins < 900;
}

// London Open: Weekdays 07:00–10:00 UTC (3PM – 6PM PHT)
export function isLondon(d: Date): boolean {
  if (getHoliday('London', d)) return false;
  const { day, mins } = utc(d);
  if (day === 0 || day === 6) return false;
  return mins >= 420 && mins < 600;
}

// Asia session: Weekdays 23:00–03:00 UTC (7AM – 11AM PHT, crosses UTC midnight)
export function isAsia(d: Date): boolean {
  if (getHoliday('Asia', d)) return false;
  const { day, mins } = utc(d);
  if (mins >= 1380) return day >= 0 && day <= 4; // Sun–Thu evening
  if (mins < 180)   return day >= 1 && day <= 5; // Mon–Fri early morning
  return false;
}

// Pre-NY: Tue–Fri 12:00–13:30 UTC (8PM – 9:30PM PHT; Mon excluded — Mon Evening covers it)
// Gated on the NY holiday too — no point anticipating a session that won't open.
export function isPreNY(d: Date): boolean {
  if (getHoliday('NY', d)) return false;
  const { day, mins } = utc(d);
  if (day === 0 || day === 6 || day === 1) return false;
  return mins >= 720 && mins < 810;
}

// NY Session: Mon–Fri 13:30–18:00 UTC (9:30PM – 2AM PHT)
// Mon special: Mon Evening ends at 15:00 UTC, so NY picks up from there
export function isNY(d: Date): boolean {
  if (getHoliday('NY', d)) return false;
  const { day, mins } = utc(d);
  if (day === 0 || day === 6) return false;
  if (day === 1) return mins >= 900 && mins < 1080; // Mon 15:00–18:00 UTC
  return mins >= 810 && mins < 1080;               // Tue–Fri 13:30–18:00 UTC
}

// Dead Zone: Weekdays 04:00–07:00 UTC (12PM – 3PM PHT)
export function isDead(d: Date): boolean {
  const { day, mins } = utc(d);
  if (day === 0 || day === 6) return false;
  return mins >= 240 && mins < 420;
}

// Priority order matters — first match wins
export function getCurrentWindow(d: Date): Window | null {
  if (isGodTier(d))    return { name: 'God Tier',     label: 'Sun 15:00–19:00 UTC',    color: '#f0c070', bg: '#3d2e00' };
  if (isPrime(d))      return { name: 'Prime',        label: 'Daily 18:00–21:00 UTC',   color: '#7de0a4', bg: '#152b1e' };
  if (isMonEvening(d)) return { name: 'Mon Evening',  label: 'Mon 12:00–15:00 UTC',     color: '#b8aeff', bg: '#252040' };
  if (isNY(d))         return { name: 'NY Session',   label: 'Mon–Fri 13:30–18:00 UTC', color: '#60a5fa', bg: '#0a1929' };
  if (isLondon(d))     return { name: 'London Open',  label: 'Weekdays 07:00–10:00 UTC', color: '#7ab8f5', bg: '#0d1e30' };
  if (isPreNY(d))      return { name: 'Pre-NY',       label: 'Weekdays 12:00–13:30 UTC', color: '#94a3b8', bg: '#1a1f2e' };
  if (isAsia(d))       return { name: 'Asia Session', label: 'Weekdays 23:00–03:00 UTC', color: '#fbbf24', bg: '#2a1f00' };
  return null;
}

export function getUpcomingWindows(now: Date, count: number): { win: Window; countdown: string }[] {
  const results: { win: Window; countdown: string }[] = [];
  let check = new Date(now.getTime() + 60 * 1000);
  const limit = new Date(now.getTime() + 7 * 24 * 3600000);
  let lastAdded: string | null = null;

  while (check < limit && results.length < count) {
    const win = getCurrentWindow(check);
    if (win && win.name !== lastAdded) {
      let startCheck = new Date(check.getTime() - 15 * 60 * 1000);
      while (startCheck < check) {
        const sw = getCurrentWindow(startCheck);
        if (sw && sw.name === win.name) { check = startCheck; break; }
        startCheck = new Date(startCheck.getTime() + 60 * 1000);
      }
      const diff = check.getTime() - now.getTime();
      const dh = Math.floor(diff / 3600000);
      const dm = Math.floor((diff % 3600000) / 60000);
      const countdown = dh > 0 ? `${dh}h ${dm}m away` : `${dm}m away`;
      results.push({ win, countdown });
      lastAdded = win.name;
      check = new Date(check.getTime() + 3 * 3600000);
    } else {
      check = new Date(check.getTime() + 15 * 60 * 1000);
    }
  }
  return results;
}

export function getSessionName(d: Date): string {
  const win = getCurrentWindow(d);
  if (win) return win.name;
  if (isDead(d)) return 'Dead Zone';
  return 'Off-peak';
}
