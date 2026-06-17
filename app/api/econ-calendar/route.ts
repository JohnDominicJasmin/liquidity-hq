import { NextResponse } from 'next/server';
import { classifyEcon } from '@/lib/classify';

const FINNHUB_KEY = process.env.FINNHUB_KEY ?? '';

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
};

const MONTHS = ['January','February','March','April','May','June','July','August',
                'September','October','November','December'];

// ── Source 1: Finnhub economic calendar (when key is configured) ──────────────
async function tryFinnhub(from: string, to: string): Promise<CalEvent[]> {
  if (!FINNHUB_KEY) return [];
  const r = await fetch(
    `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${FINNHUB_KEY}`,
    { next: { revalidate: 3600 } },
  );
  if (!r.ok) return [];
  const data = await r.json();
  const raw: Record<string, string | number | null>[] =
    Array.isArray(data.economicCalendar) ? data.economicCalendar : [];

  return raw.flatMap(e => {
    const rawName = String(e.event || e.name || e.description || e.title || '');
    if (!rawName) return [];
    const country = String(e.country || '').toUpperCase();
    if (country && country !== 'US') return [];
    const impact = String(e.impact || '').toLowerCase();
    if (impact && impact !== 'high') return [];

    let isoDate = '';
    try {
      if (typeof e.time === 'number' && e.time > 1e9)
        isoDate = new Date(e.time * 1000).toISOString();
      else if (typeof e.time === 'string' && (e.time as string).length > 10)
        isoDate = new Date(e.time as string).toISOString();
      else if (e.date)
        isoDate = new Date(`${String(e.date)}T12:00:00Z`).toISOString();
    } catch { /* skip */ }
    if (!isoDate || isNaN(new Date(isoDate).getTime())) return [];

    const cls = classifyEcon(rawName);
    const displayName = cls ? (DISPLAY_NAMES[cls.type] ?? rawName) : rawName;
    const type = cls?.type ?? 'MACRO';
    const fmt = (v: string | number | null | undefined) =>
      v != null && v !== '' ? String(v) : undefined;

    return [{ name: displayName, type, isoDate, impact: 'high',
      previous: fmt(e.prev ?? e.previous), estimate: fmt(e.estimate), actual: fmt(e.actual) }];
  });
}

// ── Source 2: ForexFactory XML feed ───────────────────────────────────────────
// FF occasionally rate-limits with a 200 HTML page — check content before parsing.
// Module-level cache keeps dev from hammering the endpoint.
const _ffCache: { data: CalEvent[]; ts: number } = { data: [], ts: 0 };
const FF_TTL = 60 * 60 * 1000;

async function tryForexFactory(now: Date): Promise<CalEvent[]> {
  if (Date.now() - _ffCache.ts < FF_TTL && _ffCache.data.length > 0) return _ffCache.data;

  const feeds = [
    'https://nfs.faireconomy.media/ff_calendar_thisweek.xml',
    'https://nfs.faireconomy.media/ff_calendar_nextweek.xml',
  ];
  const results: CalEvent[] = [];

  for (const url of feeds) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiquidityHQ/1.0)' },
        next: { revalidate: 3600 },
      });
      if (!r.ok) continue;
      const text = await r.text();
      // Rate-limit returns HTML — bail if it's not XML
      if (!text.trimStart().startsWith('<?xml')) continue;

      const blocks: string[] = [];
      let pos = 0;
      while (true) {
        const s = text.indexOf('<event>', pos);
        if (s === -1) break;
        const e = text.indexOf('</event>', s);
        if (e === -1) break;
        blocks.push(text.slice(s, e + 8));
        pos = e + 8;
      }

      for (const block of blocks) {
        // Extract plain or CDATA-wrapped values
        const get = (tag: string): string => {
          const cdata = block.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
          if (cdata) return cdata[1].trim();
          const plain = block.match(new RegExp(`<${tag}>([^<]+)<\\/${tag}>`));
          return plain ? plain[1].trim() : '';
        };

        const country = (block.match(/<country>([\s\S]*?)<\/country>/) || [])[1]?.trim() ?? '';
        if (country !== 'USD') continue;
        if (get('impact') !== 'High') continue;

        const title   = get('title');
        const dateStr = get('date'); // MM-DD-YYYY
        const timeStr = get('time'); // "2:00pm" / "All Day" / "Tentative"
        if (!title || !dateStr) continue;

        // Parse MM-DD-YYYY
        const [mm, dd, yyyy] = dateStr.split('-').map(Number);
        if (!mm || !dd || !yyyy) continue;
        const monthIdx = mm - 1;

        // Parse 12-hour ET time → UTC
        let hours = 12, minutes = 0;
        const tm = timeStr.match(/^(\d+):(\d+)(am|pm)$/i);
        if (tm) {
          hours   = parseInt(tm[1]);
          minutes = parseInt(tm[2]);
          const pm = tm[3].toLowerCase() === 'pm';
          if (pm  && hours !== 12) hours += 12;
          if (!pm && hours === 12) hours  = 0;
        }
        // EDT (UTC-4) Apr–Oct, EST (UTC-5) Nov–Mar
        const offset = (monthIdx >= 3 && monthIdx <= 9) ? 4 : 5;
        const dt = new Date(Date.UTC(yyyy, monthIdx, dd, hours + offset, minutes, 0));
        if (isNaN(dt.getTime())) continue;

        const h = (dt.getTime() - now.getTime()) / 3600000;
        if (h < -24) continue;

        const cls = classifyEcon(title);
        const displayName = cls ? (DISPLAY_NAMES[cls.type] ?? title) : title;
        const type = cls?.type ?? 'MACRO';
        const fmt = (v: string) => v !== '' ? v : undefined;

        results.push({
          name: displayName, type, isoDate: dt.toISOString(), impact: 'high',
          previous: fmt(get('previous')),
          estimate: fmt(get('forecast')),
          actual:   fmt(get('actual')),
        });
      }
    } catch { /* skip this feed */ }
  }

  if (results.length > 0) { _ffCache.data = results; _ffCache.ts = Date.now(); }
  return results;
}

// ── Source 3: Federal Reserve public FOMC calendar ────────────────────────────
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
      const utcHour = (monthIdx >= 3 && monthIdx <= 9) ? 18 : 19; // 2 PM EDT/EST
      const dt = new Date(Date.UTC(year, monthIdx, lastDay, utcHour, 0, 0));
      const h  = (dt.getTime() - now.getTime()) / 3600000;
      if (h < -24 || h > 90 * 24) continue;
      events.push({ name: 'FOMC Rate Decision', type: 'FOMC', isoDate: dt.toISOString(), impact: 'high' });
    }
  }
  return events;
}

// ── Source 4: Computed schedule for key US macro releases ─────────────────────
// Approximate release patterns — accurate within a few days. Used when no live
// feed is available. Covers the 8 most market-moving releases.
function computeMacroSchedule(now: Date): CalEvent[] {
  const events: CalEvent[] = [];
  const maxH = 90 * 24;

  const push = (name: string, type: string, dt: Date) => {
    const h = (dt.getTime() - now.getTime()) / 3600000;
    if (h >= 0 && h <= maxH) events.push({ name, type, isoDate: dt.toISOString(), impact: 'high' });
  };

  for (const y of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    for (let m = 0; m <= 11; m++) {
      // ── NFP: first Friday, 8:30 AM ET (13:30 UTC Apr–Oct, 14:30 Nov–Mar)
      const nfpFri = new Date(Date.UTC(y, m, 1));
      nfpFri.setUTCDate(1 + (5 - nfpFri.getUTCDay() + 7) % 7);
      const nfpUTC = (m >= 3 && m <= 9) ? 13 : 14;
      nfpFri.setUTCHours(nfpUTC, 30, 0, 0);
      push('Nonfarm Payrolls (NFP)', 'NFP', nfpFri);

      // ── CPI: ~12th, 8:30 AM ET
      const cpiOffset = (m >= 3 && m <= 9) ? 4 : 5;
      push('Consumer Price Index (CPI) MoM', 'CPI', new Date(Date.UTC(y, m, 12, 8 + cpiOffset, 30, 0)));

      // ── PPI: ~11th, 8:30 AM ET (one day before CPI)
      const ppiOffset = cpiOffset;
      push('Producer Price Index (PPI)', 'PPI', new Date(Date.UTC(y, m, 11, 8 + ppiOffset, 30, 0)));

      // ── PCE: last Friday of month, 8:30 AM ET
      const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const lastFri = new Date(Date.UTC(y, m, lastDay));
      lastFri.setUTCDate(lastDay - (lastFri.getUTCDay() === 0 ? 1 : lastFri.getUTCDay() === 6 ? 0 : lastFri.getUTCDay() - 5 < 0 ? lastFri.getUTCDay() + 2 : lastFri.getUTCDay() - 5));
      // Simpler: walk back from last day to find Friday
      const pceDay = new Date(Date.UTC(y, m, lastDay));
      while (pceDay.getUTCDay() !== 5) pceDay.setUTCDate(pceDay.getUTCDate() - 1);
      const pceOffset = (m >= 3 && m <= 9) ? 4 : 5;
      pceDay.setUTCHours(8 + pceOffset, 30, 0, 0);
      push('Personal Consumption Expenditures (PCE)', 'PCE', pceDay);

      // ── Retail Sales: ~15th, 8:30 AM ET
      push('Retail Sales', 'RETAIL', new Date(Date.UTC(y, m, 15, 8 + cpiOffset, 30, 0)));

      // ── GDP advance release: 4th week of Jan, Apr, Jul, Oct
      if (m === 0 || m === 3 || m === 6 || m === 9) {
        const gdpOffset = (m >= 3 && m <= 9) ? 4 : 5;
        push('Gross Domestic Product (GDP)', 'GDP', new Date(Date.UTC(y, m, 25, 8 + gdpOffset, 30, 0)));
      }
    }
  }
  return events;
}

export async function GET() {
  const now  = new Date();
  const from = new Date(+now - 864e5).toISOString().slice(0, 10);
  const to   = new Date(+now + 90 * 864e5).toISOString().slice(0, 10);

  // Source 1: Finnhub — comprehensive 90-day when key is configured
  try {
    const events = await tryFinnhub(from, to);
    if (events.length > 0) {
      return NextResponse.json({ events, source: 'finnhub' },
        { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } });
    }
  } catch { /* fall through */ }

  // Source 2+3+4: ForexFactory (near-term) + Fed FOMC + computed macro schedule
  try {
    const [ffEvents, fomcEvents, macroEvents] = await Promise.all([
      tryForexFactory(now),
      tryFedFOMC(now),
      Promise.resolve(computeMacroSchedule(now)),
    ]);

    // Merge with deduplication: ForexFactory wins for near-term.
    // FOMC scrape + computed macro fill in events beyond ForexFactory's two-week window.
    const seen = new Set<string>();
    const merged: CalEvent[] = [];

    const add = (e: CalEvent, key: string) => {
      if (!seen.has(key)) { seen.add(key); merged.push(e); }
    };

    for (const e of ffEvents)   add(e, `${e.type}|${e.isoDate.slice(0, 10)}`);
    for (const e of fomcEvents) add(e, `FOMC|${e.isoDate.slice(0, 10)}`);
    for (const e of macroEvents) add(e, `${e.type}|${e.isoDate.slice(0, 10)}`);

    const source = ffEvents.length > 0 ? 'forexfactory+fed+computed' : 'fed+computed';
    return NextResponse.json({ events: merged, source },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } });
  } catch { /* */ }

  return NextResponse.json({ events: [], source: 'none' });
}
