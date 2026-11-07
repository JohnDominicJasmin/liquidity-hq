export interface Window {
  name: string;
  label: string;
  color: string;
  bg: string;
}

// All session detection runs in UTC so it works correctly for every timezone. The windows below
// are stated in UTC only - they used to carry a second set of times in the operator's own zone,
// which read as authoritative and was meaningless to every other reader.

function utc(d: Date): { day: number; mins: number } {
  return { day: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/* ── Market holidays ──────────────────────────────────────────────────────
   Reduced/zero liquidity windows for the four sessions this app tracks.
   Dates are the region's own local calendar date (fixed UTC offset - DST is
   ignored, at most an hour off near a session boundary, which doesn't
   change which day a holiday falls on for these purposes).
   Sourced 2026-07 from SIFMA/NYSE (NY), gov.uk (London), Nippon.com/Japan
   Travel (Asia/Tokyo), China Briefing / State Council notice (China).

   ── THE TABLE IS KEYED BY YEAR, AND THAT IS THE FIX, NOT THE 2027 DATA ──

   This was a single `HOLIDAYS_2026` with `getHoliday` reading it directly, so
   from 2027-01-01 every market holiday became an ordinary trading day - no
   error, no log line, the app simply saying the market is open on Christmas.
   QA's `qa/e2e/clock.spec.ts` fires 60 days early on purpose to catch it with
   time to act, and it did: it went red in early November 2026.

   ADDING A YEAR IS NOW DATA. The lookup reads the year off the REGION-LOCAL
   date, not the UTC one, so 2027-01-01 in Tokyo resolves against 2027 even
   while it is still 2026-12-31 in UTC. A year that is absent still returns
   null, as before - the failure mode is unchanged, it just no longer arrives
   on a date nobody chose.

   2027 SOURCES, because three of the four are rule-derivable and one is not:
     NY      NYSE Group's 2026/2027/2028 holiday calendar, published
             2025-12-23. Three dates are observances rather than the date
             itself - Juneteenth and Christmas fall on a Saturday and
             Independence Day on a Sunday.
     London  Privy Council proclamation sealed 2026-07-08 appoints 1 January,
             3 May and 28 December 2027; Easter, spring and summer follow the
             fixed rules. Christmas Day is a Saturday and Boxing Day a Sunday,
             so both move to substitutes.
     Asia    Japan's holidays are set in law, with a Sunday moving to the next
             working day. 2027 has exactly one such substitute: Vernal Equinox
             Day falls on Sunday 21 March, so 22 March is a holiday too.
     China   **NOT PUBLISHED YET - see the comment on the China block.** ── */

export type HolidayRegion = 'NY' | 'London' | 'Asia' | 'China';

interface HolidayRange { start: string; end: string; name: string } // 'YYYY-MM-DD' inclusive

const REGION_UTC_OFFSET: Record<HolidayRegion, number> = {
  NY: -5, London: 0, Asia: 9, China: 8,
};

const HOLIDAYS_BY_YEAR: Record<string, Record<HolidayRegion, HolidayRange[]>> = {
  '2026': {
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
  },

  '2027': {
    NY: [
      { start: '2027-01-01', end: '2027-01-01', name: "New Year's Day" },
      { start: '2027-01-18', end: '2027-01-18', name: 'Martin Luther King Jr. Day' },
      { start: '2027-02-15', end: '2027-02-15', name: "Presidents' Day" },
      { start: '2027-03-26', end: '2027-03-26', name: 'Good Friday' },
      { start: '2027-05-31', end: '2027-05-31', name: 'Memorial Day' },
      /* 19 June 2027 is a Saturday, so the exchange observes the Friday. */
      { start: '2027-06-18', end: '2027-06-18', name: 'Juneteenth (observed)' },
      /* 4 July 2027 is a Sunday, so the exchange observes the Monday. */
      { start: '2027-07-05', end: '2027-07-05', name: 'Independence Day (observed)' },
      { start: '2027-09-06', end: '2027-09-06', name: 'Labor Day' },
      { start: '2027-11-25', end: '2027-11-25', name: 'Thanksgiving Day' },
      /* 25 December 2027 is a Saturday, so the exchange observes the Friday. */
      { start: '2027-12-24', end: '2027-12-24', name: 'Christmas Day (observed)' },
    ],
    London: [
      { start: '2027-01-01', end: '2027-01-01', name: "New Year's Day" },
      { start: '2027-03-26', end: '2027-03-26', name: 'Good Friday' },
      { start: '2027-03-29', end: '2027-03-29', name: 'Easter Monday' },
      { start: '2027-05-03', end: '2027-05-03', name: 'Early May Bank Holiday' },
      { start: '2027-05-31', end: '2027-05-31', name: 'Spring Bank Holiday' },
      { start: '2027-08-30', end: '2027-08-30', name: 'Summer Bank Holiday' },
      /* Christmas Day is a Saturday and Boxing Day a Sunday in 2027, so BOTH move. */
      { start: '2027-12-27', end: '2027-12-27', name: 'Christmas Day (substitute)' },
      { start: '2027-12-28', end: '2027-12-28', name: 'Boxing Day (substitute)' },
    ],
    Asia: [
      { start: '2027-01-01', end: '2027-01-01', name: "New Year's Day" },
      { start: '2027-01-11', end: '2027-01-11', name: 'Coming of Age Day' },
      { start: '2027-02-11', end: '2027-02-11', name: 'National Foundation Day' },
      { start: '2027-02-23', end: '2027-02-23', name: "Emperor's Birthday" },
      /* Vernal Equinox Day falls on Sunday 21 March 2027, so the Monday is a
         substitute holiday - the only one Japan has in 2027. */
      { start: '2027-03-21', end: '2027-03-22', name: 'Spring Equinox Day' },
      { start: '2027-04-29', end: '2027-05-05', name: 'Golden Week' },
      { start: '2027-07-19', end: '2027-07-19', name: 'Marine Day' },
      { start: '2027-08-11', end: '2027-08-11', name: 'Mountain Day' },
      /* Respect for the Aged Day (20th) and the Autumnal Equinox (23rd) have two
         working days between them in 2027 - not the single run 2026's "Silver Week"
         was, so they are listed separately rather than merged into one range. */
      { start: '2027-09-20', end: '2027-09-20', name: 'Respect for the Aged Day' },
      { start: '2027-09-23', end: '2027-09-23', name: 'Autumnal Equinox Day' },
      { start: '2027-10-11', end: '2027-10-11', name: 'Sports Day' },
      { start: '2027-11-03', end: '2027-11-03', name: 'Culture Day' },
      { start: '2027-11-23', end: '2027-11-23', name: 'Labor Thanksgiving Day' },
    ],
    /* CHINA 2027 IS INCOMPLETE ON PURPOSE AND WILL UNDERSTATE EVERY WINDOW.
     *
     * China's holiday LENGTHS are not law. They are an arrangement the State
     * Council publishes each November or December for the year ahead, with
     * make-up weekend workdays attached. As of 2026-11-05 the 2027 notice is
     * NOT OUT: sources put the Spring Festival break at 5, 9 or 11 February
     * and none of them is official.
     *
     * So these are the statutory days whose DATES are fixed - the lunar new
     * year itself, the solar terms and the two civil dates - and nothing about
     * how far the breaks extend around them. A reader will see an ordinary
     * trading day inside a real Golden Week.
     *
     * WHY NOT LEAVE IT EMPTY: 6 February 2027 is the lunar new year, the
     * largest liquidity event in the Chinese calendar, and an empty list would
     * print "open" on it. Understating a window is a smaller error than
     * denying the day.
     *
     * WHY NOT GUESS THE WINDOWS: a fabricated 7-day range is indistinguishable
     * from a sourced one to the next reader, and this file already carries real
     * ranges from the 2026 notice. A wrong range that looks sourced is worse
     * than a short one that says it is short.
     *
     * TWO LUNAR HOLIDAYS ARE ABSENT ENTIRELY - Dragon Boat and Mid-Autumn.
     * Their dates come off the lunar calendar and I could not source them for
     * 2027, so they are omitted rather than approximated.
     *
     * REVISIT IN DECEMBER 2026 once the notice is published. Until then this
     * block is the one part of the 2027 table that is not sourced end to end. */
    China: [
      { start: '2027-01-01', end: '2027-01-01', name: "New Year's Day" },
      { start: '2027-02-06', end: '2027-02-06', name: 'Spring Festival' },
      { start: '2027-04-05', end: '2027-04-05', name: 'Qingming Festival' },
      { start: '2027-05-01', end: '2027-05-02', name: 'Labour Day' },
      { start: '2027-10-01', end: '2027-10-03', name: 'National Day' },
    ],
  },
};

function localDateStr(d: Date, utcOffsetHours: number): string {
  const t = new Date(d.getTime() + utcOffsetHours * 3600_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// Returns the holiday name if `d` falls on a holiday for that region, else null.
export function getHoliday(region: HolidayRegion, d: Date): string | null {
  const dateStr = localDateStr(d, REGION_UTC_OFFSET[region]);
  /* THE YEAR COMES OFF THE REGION-LOCAL DATE STRING, not `d.getUTCFullYear()`.
     `dateStr` is already shifted into the region's own calendar above, so 1 January
     in Tokyo resolves against 2027 while it is still 31 December in UTC - which is
     exactly the boundary a New Year's Day holiday sits on. */
  const ranges = HOLIDAYS_BY_YEAR[dateStr.slice(0, 4)]?.[region] ?? [];
  const hit = ranges.find(r => dateStr >= r.start && dateStr <= r.end);
  return hit ? hit.name : null;
}

// All regions currently on holiday for `d` - including China, which has no
// dedicated session window in this file but is still worth surfacing.
export function getActiveHolidays(d: Date): { region: HolidayRegion; name: string }[] {
  return (['NY', 'London', 'Asia', 'China'] as const)
    .map(region => ({ region, name: getHoliday(region, d) }))
    .filter((h): h is { region: HolidayRegion; name: string } => h.name !== null);
}

// Returns current time - no timezone conversion needed; UTC methods handle it.
export function getLocalNow(): Date {
  return new Date();
}

// God Tier: Sun 15:00–19:00 UTC
export function isGodTier(d: Date): boolean {
  const { day, mins } = utc(d);
  return day === 0 && mins >= 900 && mins < 1140;
}

// Prime: Daily 18:00–21:00 UTC
export function isPrime(d: Date): boolean {
  const { mins } = utc(d);
  return mins >= 1080 && mins < 1260;
}

// Mon Evening: Mon 12:00–15:00 UTC
export function isMonEvening(d: Date): boolean {
  const { day, mins } = utc(d);
  return day === 1 && mins >= 720 && mins < 900;
}

// London Open: Weekdays 07:00–10:00 UTC
export function isLondon(d: Date): boolean {
  if (getHoliday('London', d)) return false;
  const { day, mins } = utc(d);
  if (day === 0 || day === 6) return false;
  return mins >= 420 && mins < 600;
}

// Asia session: Weekdays 23:00–03:00 UTC (crosses UTC midnight)
export function isAsia(d: Date): boolean {
  if (getHoliday('Asia', d)) return false;
  const { day, mins } = utc(d);
  if (mins >= 1380) return day >= 0 && day <= 4; // Sun–Thu evening
  if (mins < 180)   return day >= 1 && day <= 5; // Mon–Fri early morning
  return false;
}

// Pre-NY: Tue–Fri 12:00–13:30 UTC (Mon excluded - Mon Evening covers it)
// Gated on the NY holiday too - no point anticipating a session that won't open.
export function isPreNY(d: Date): boolean {
  if (getHoliday('NY', d)) return false;
  const { day, mins } = utc(d);
  if (day === 0 || day === 6 || day === 1) return false;
  return mins >= 720 && mins < 810;
}

// NY Session: Mon–Fri 13:30–18:00 UTC
// Mon special: Mon Evening ends at 15:00 UTC, so NY picks up from there
export function isNY(d: Date): boolean {
  if (getHoliday('NY', d)) return false;
  const { day, mins } = utc(d);
  if (day === 0 || day === 6) return false;
  if (day === 1) return mins >= 900 && mins < 1080; // Mon 15:00–18:00 UTC
  return mins >= 810 && mins < 1080;               // Tue–Fri 13:30–18:00 UTC
}

// Dead Zone: Weekdays 04:00–07:00 UTC
export function isDead(d: Date): boolean {
  const { day, mins } = utc(d);
  if (day === 0 || day === 6) return false;
  return mins >= 240 && mins < 420;
}

/* Priority order matters - first match wins.
 *
 * The colours below are deliberately hardcoded and deliberately NOT theme
 * tokens. Each row pairs a foreground with its OWN explicit dark background,
 * and .session-pill applies both together. Because the background is fixed, the
 * pair is already correct in BOTH themes.
 *
 * Swapping the foreground for a token breaks that: the light-theme token is a
 * dark colour and the background stays dark. Measured during the issue #53 sweep
 * - .session-pill dropped to 2.30:1 before this was reverted. If a colour here
 * needs to change, change the pair. */
export function getCurrentWindow(d: Date): Window | null {
  if (isGodTier(d))    return { name: 'God Tier',     label: 'Sun 15:00–19:00 UTC',    color: '#f0c070', bg: '#3d2e00' };
  if (isPrime(d))      return { name: 'Prime',        label: 'Daily 18:00–21:00 UTC',   color: '#7de0a4', bg: '#152b1e' };
  if (isMonEvening(d)) return { name: 'Mon Evening',  label: 'Mon 12:00–15:00 UTC',     color: '#5aa3ff', bg: '#12233f' };
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
