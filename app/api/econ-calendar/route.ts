import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { fetchFredRows, FRED_TTL_DEFAULT } from '@/lib/fred';
import { cached } from '@/lib/apiCache';
import { etToUtcMs, scheduledInstants, SCHEDULE_READ_ON, SCHEDULE_COVERS_THROUGH } from '@/lib/econSchedule';
import { polledCacheControl } from '@/lib/cacheHeaders';

const DISPLAY_NAMES: Record<string, string> = {
  FOMC:   'FOMC Rate Decision',
  NFP:    'Nonfarm Payrolls (NFP)',
  CPI:    'Consumer Price Index (CPI) MoM',
  PPI:    'Producer Price Index (PPI)',
  PCE:    'Personal Consumption Expenditures (PCE)',
  GDP:    'Gross Domestic Product (GDP)',
  RETAIL: 'Retail Sales',
  FED:    'Fed Speaker',
};

export type CalEvent = {
  name: string; type: string; isoDate: string; impact: string;
  previous?: string; estimate?: string; actual?: string;
  /* True when the DATE is a guess rather than a published one (#245). No source in this route produces one any more (#1625: every date is
     read from the agencies' own schedules, lib/econSchedule.ts), but the field stays in the payload shape so the page's marker still has
     something to read if an estimating source is ever added back. Absent on every entry today. */
  estimated?: boolean;
};

const MONTHS = ['January','February','March','April','May','June','July','August',
                'September','October','November','December'];

// ── Federal Reserve public FOMC calendar ──────────────────────────────────────
// Live read of the Fed's own page; lib/econSchedule.ts carries the same dates as a fallback for when the page cannot be read.
async function tryFedFOMC(now: Date): Promise<CalEvent[]> {
  const r = await fetch('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiquidityHQ/1.0)' },
    next: { revalidate: 86400 },
  });
  if (!r.ok) return [];
  const html = await r.text();
  const events: CalEvent[] = [];

  const parts = html.split(/<a id="\d+">((\d{4}) FOMC Meetings)<\/a>/);
  for (let i = 1; i < parts.length; i += 3) {
    const year  = parseInt(parts[i + 1]);
    const block = parts[i + 2] ?? '';
    const pairs = [...block.matchAll(
      /fomc-meeting__month[^>]+><strong>(\w+)<\/strong>[\s\S]*?fomc-meeting__date[^>]+>([\d\-\*\s]+)</g,
    )];
    for (const [, month, rawDate] of pairs) {
      const monthIdx = MONTHS.indexOf(month);
      if (monthIdx === -1) continue;
      const lastDay = parseInt(rawDate.trim().replace(/\*/g, '').split('-').pop() ?? '');
      if (isNaN(lastDay)) continue;
      // The decision is announced at 2:00 PM ET on the last day of the meeting. ET -> UTC with daylight saving (the old month-range rule
      // got the March and November switch weeks wrong), via the same helper the schedule table uses.
      const ymd = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      let ms: number;
      try { ms = etToUtcMs(ymd, '14:00'); } catch { continue; }
      const h  = (ms - now.getTime()) / 3600000;
      if (h < -24 || h > 90 * 24) continue;
      events.push({ name: 'FOMC Rate Decision', type: 'FOMC', isoDate: new Date(ms).toISOString(), impact: 'high' });
    }
  }
  return events;
}

// ── FRED: Free actual values for recently-released events ────────────────────
// The fetch/parse/cache lives in lib/fred.ts - /api/macro needs the same thing
// for the 10Y real yield (#311), and two copies of a CSV parser is one too many.

const FRED_CFG: Record<string, { id: string; fmt: 'rate' | 'mom_change' | 'mom_pct' | 'qoq_ann' }> = {
  FOMC:   { id: 'DFEDTARU', fmt: 'rate' },       // Fed Funds target upper bound (daily)
  NFP:    { id: 'PAYEMS',   fmt: 'mom_change' },  // Nonfarm payrolls level (monthly K)
  CPI:    { id: 'CPIAUCSL', fmt: 'mom_pct' },     // CPI seasonally adjusted (monthly)
  PPI:    { id: 'PPIACO',   fmt: 'mom_pct' },     // PPI all commodities (monthly)
  PCE:    { id: 'PCE',      fmt: 'mom_pct' },     // PCE (monthly)
  GDP:    { id: 'GDP',      fmt: 'qoq_ann' },     // GDP (quarterly)
  RETAIL: { id: 'RSAFS',   fmt: 'mom_pct' },      // Retail sales (monthly)
};

function fredActual(rows: [number, number][], eventTs: number, fmt: string): string | undefined {
  if (rows.length < 2) return undefined;
  let i = rows.length - 1;
  while (i >= 0 && rows[i][0] > eventTs) i--;
  if (i < 1) return undefined;
  const cur = rows[i][1], prev = rows[i - 1][1];
  if (fmt === 'rate')       return cur.toFixed(2) + '%';
  if (fmt === 'mom_change') { const d = Math.round(cur - prev); return (d >= 0 ? '+' : '') + d + 'K'; }
  if (fmt === 'mom_pct')    { if (!prev) return; const p = ((cur - prev) / prev) * 100; return (p >= 0 ? '+' : '') + p.toFixed(1) + '%'; }
  if (fmt === 'qoq_ann')    { if (!prev) return; const a = (Math.pow(cur / prev, 4) - 1) * 100; return (a >= 0 ? '+' : '') + a.toFixed(1) + '%'; }
}

async function enrichWithFRED(events: CalEvent[], now: Date): Promise<void> {
  const windowMs = 30 * 24 * 3600_000;
  const past = events.filter(e => {
    const diff = new Date(e.isoDate).getTime() - now.getTime();
    // Include events up to 6h in the future so a release that has just come out picks its number up
    return diff < 6 * 3600_000 && diff > -windowMs && !e.actual;
  });
  if (past.length === 0) return;

  const needed = [...new Set(past.map(e => FRED_CFG[e.type]?.id).filter(Boolean))] as string[];
  const data = Object.fromEntries(await Promise.all(needed.map(async id => [id, await fetchFredRows(id, FRED_TTL_DEFAULT)])));

  for (const e of past) {
    const cfg = FRED_CFG[e.type];
    if (!cfg || !data[cfg.id]?.length) continue;
    const v = fredActual(data[cfg.id], new Date(e.isoDate).getTime(), cfg.fmt);
    if (v) e.actual = v;
  }
}

/* ONE HOUR, THE SAME HOUR THE RESPONSE HEADER HAS ALWAYS PROMISED (#1397). */
const CALENDAR_TTL_MS = 60 * 60_000;

/* Thrown when NO event can be produced, so `cached()` never stores an empty calendar - a throwing fetcher is never remembered.
 *
 * An empty result is "unavailable", not "a quiet quarter": the schedule table covers well past the 90-day window (lib/econSchedule.ts), so
 * it only comes up empty once the table has expired and nobody refreshed it. The route then answers source 'none' and the pages say the
 * calendar is unavailable, rather than showing "no events" as if nothing were scheduled. */
class NoCalendarData extends Error {}

async function buildCalendar(): Promise<{ events: CalEvent[]; source: string; scheduleReadOn: string; coversThrough: string }> {
  const now = new Date();

  /* EVERY date here is a published one (#1625). The agencies' schedules (BLS CPI/NFP/PPI, BEA GDP/PCE, Census retail sales) are the
     checked-in table; FOMC prefers a live read of the Fed's page and falls back to the table's FOMC rows for the months the read missed. */
  let fomc: CalEvent[] = [];
  try { fomc = await tryFedFOMC(now); } catch { /* the table covers it */ }
  const fomcMonths = new Set(fomc.map(e => e.isoDate.slice(0, 7)));

  const events: CalEvent[] = [...fomc];
  for (const r of scheduledInstants(now)) {
    if (r.type === 'FOMC' && fomcMonths.has(r.isoDate.slice(0, 7))) continue;
    events.push({ name: DISPLAY_NAMES[r.type], type: r.type, isoDate: r.isoDate, impact: 'high' });
  }
  if (events.length === 0) throw new NoCalendarData();

  events.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  await enrichWithFRED(events, now);
  return {
    events,
    source: 'official schedules: BLS, BEA, Census, Fed',
    scheduleReadOn: SCHEDULE_READ_ON,
    coversThrough: SCHEDULE_COVERS_THROUGH,
  };
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!rateLimit(`econ-calendar:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
  console.log(`[econ-calendar] ip=${ip}`);

  try {
    const body = await cached('econ-calendar', CALENDAR_TTL_MS, buildCalendar);
    return NextResponse.json(body,
      { headers: { 'Cache-Control': polledCacheControl(3600) } });
  } catch {
    /* Uncached, and deliberately without the Cache-Control header the good path
       carries: the next request should try the upstreams again immediately.
       source 'none' is how the pages tell "unavailable" from "nothing scheduled". */
    return NextResponse.json({ events: [], source: 'none' });
  }
}
