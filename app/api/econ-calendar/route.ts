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

export type CalEvent = { name: string; type: string; isoDate: string; impact: string };

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
  const raw: Record<string, string | number>[] =
    Array.isArray(data.economicCalendar) ? data.economicCalendar : [];

  return raw.flatMap(e => {
    const rawName = String(e.event || e.name || e.description || e.title || '');
    const cls = classifyEcon(rawName);
    if (!cls) return [];
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
    return [{ name: DISPLAY_NAMES[cls.type] ?? rawName, type: cls.type, isoDate, impact: cls.impact }];
  });
}

// ── Source 2: Federal Reserve public FOMC calendar page ───────────────────────
async function tryFedFOMC(now: Date): Promise<CalEvent[]> {
  const r = await fetch('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiquidityHQ/1.0)' },
    next: { revalidate: 86400 },
  });
  if (!r.ok) return [];
  const html = await r.text();
  const events: CalEvent[] = [];

  // Split into year sections: ["prefix", "2026", "2026 html", "2027", "2027 html", ...]
  const parts = html.split(/<a id="\d+">((\d{4}) FOMC Meetings)<\/a>/);
  for (let i = 1; i < parts.length; i += 3) {
    const year = parseInt(parts[i + 1]);
    const block = parts[i + 2] ?? '';
    const pairs = [...block.matchAll(
      /fomc-meeting__month[^>]+><strong>(\w+)<\/strong>[\s\S]*?fomc-meeting__date[^>]+>([\d\-\*\s]+)</g,
    )];
    for (const [, month, rawDate] of pairs) {
      const monthIdx = MONTHS.indexOf(month);
      if (monthIdx === -1) continue;
      const lastDay = parseInt(rawDate.trim().replace(/\*/g, '').split('-').pop() ?? '');
      if (isNaN(lastDay)) continue;
      // Rate decision: 2 PM EDT (UTC-4) Apr–Oct = 18:00Z, 2 PM EST (UTC-5) Nov–Mar = 19:00Z
      const utcHour = (monthIdx >= 3 && monthIdx <= 9) ? 18 : 19;
      const dt = new Date(Date.UTC(year, monthIdx, lastDay, utcHour, 0, 0));
      const h = (dt.getTime() - now.getTime()) / 3600000;
      if (h < -24 || h > 90 * 24) continue;
      events.push({ name: 'FOMC Rate Decision', type: 'FOMC', isoDate: dt.toISOString(), impact: 'high' });
    }
  }
  return events;
}

// ── Source 3: Algorithmic NFP + CPI schedule (server-side only) ───────────────
// NFP = first Friday of each month, 8:30 AM EDT (13:30 UTC)
// CPI = approximately 12th of each month, 8:30 AM EDT (13:30 UTC)
function computeNFPCPI(now: Date): CalEvent[] {
  const events: CalEvent[] = [];
  const maxH = 90 * 24;
  for (const y of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    for (let m = 0; m <= 11; m++) {
      // NFP: first Friday
      const fri = new Date(Date.UTC(y, m, 1));
      fri.setUTCDate(1 + (5 - fri.getUTCDay() + 7) % 7);
      fri.setUTCHours(13, 30, 0, 0);
      const hFri = (fri.getTime() - now.getTime()) / 3600000;
      if (hFri >= 0 && hFri <= maxH)
        events.push({ name: 'Nonfarm Payrolls (NFP)', type: 'NFP', isoDate: fri.toISOString(), impact: 'high' });

      // CPI: ~12th
      const cpi = new Date(Date.UTC(y, m, 12, 13, 30, 0));
      const hCPI = (cpi.getTime() - now.getTime()) / 3600000;
      if (hCPI >= 0 && hCPI <= maxH)
        events.push({ name: 'Consumer Price Index (CPI) MoM', type: 'CPI', isoDate: cpi.toISOString(), impact: 'high' });
    }
  }
  return events;
}

export async function GET() {
  const now = new Date();
  const from = new Date(+now - 864e5).toISOString().slice(0, 10);
  const to   = new Date(+now + 90 * 864e5).toISOString().slice(0, 10);

  // Try Finnhub first — if it returns events, trust it fully
  try {
    const events = await tryFinnhub(from, to);
    if (events.length > 0) {
      return NextResponse.json({ events, source: 'finnhub' },
        { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } });
    }
  } catch { /* fall through */ }

  // No Finnhub — combine Fed FOMC scrape + computed NFP/CPI
  try {
    const [fomcEvents, nfpCpiEvents] = await Promise.all([
      tryFedFOMC(now),
      Promise.resolve(computeNFPCPI(now)),
    ]);
    const events = [...fomcEvents, ...nfpCpiEvents];
    return NextResponse.json({ events, source: 'fed+computed' },
      { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' } });
  } catch { /* */ }

  return NextResponse.json({ events: [], source: 'none' });
}
