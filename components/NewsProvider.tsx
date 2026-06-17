'use client';
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { classifyNews, GEO_KEYWORDS, classifyEcon } from '@/lib/classify';

// Finnhub calls go through /api/news/finnhub — key stays server-side

export interface Alert {
  id: number;
  headline: string;
  source: string;
  ts: number;
  type: 'red' | 'amber' | 'purple';
  link?: string;
  image?: string;   // thumbnail URL from RSS <media:content> or Finnhub image field
}

export interface EconEvent {
  name: string;
  type: string;
  impact: string;
  dt: Date;
  h: number;
  dateStr: string;
}

export interface GeoEvent {
  headline: string;
  source: string;
  tag: string;
  style: string;
  note: string;
  timeStr: string;
  ts: number;
}

export interface WhaleAlert {
  id: number;
  symbol: string;       // 'BTC' | 'ETH'
  side: 'BUY' | 'SELL';
  usdValue: number;
  price: number;
  qty: number;
  ts: number;
}

interface NewsCtx {
  alerts: Alert[];
  dismissAlert: (id: number) => void;
  econEvents: EconEvent[];
  geoEvents: GeoEvent[];
  eventsLoaded: boolean;
  alertsLoaded: boolean;  // true after first RSS + Finnhub fetch cycle completes
  newsActive: boolean;
  latestHeadlines: string[];
  whaleAlerts: WhaleAlert[];
}

const NewsContext = createContext<NewsCtx | null>(null);
export function useNews() { return useContext(NewsContext)!; }

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

function toPHT(dt: Date): string {
  try {
    return dt.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' }) + ' PHT';
  } catch {
    return dt.toISOString();
  }
}

function countdown(h: number): string {
  if (h < 0) return 'Just passed';
  if (h < 0.5) return 'Happening NOW';
  if (h < 24) return Math.round(h) + 'h away';
  const d = Math.floor(h / 24), r = Math.round(h % 24);
  return d + 'd' + (r ? ' ' + r + 'h' : '') + ' away';
}

/* ── Fallback econ events — used when Finnhub calendar is unavailable ── */
function firstFridayUTC(y: number, m: number): Date {
  const d = new Date(Date.UTC(y, m, 1));
  d.setUTCDate(1 + (5 - d.getUTCDay() + 7) % 7);
  d.setUTCHours(13, 30, 0, 0); // 8:30 AM EDT
  return d;
}

function getFallbackEconEvents(now: Date): EconEvent[] {
  const out: EconEvent[] = [];
  const maxH = 90 * 24;

  // FOMC 2026 rate decision dates (2 PM EST = 18:00 UTC)
  ['2026-07-29T18:00:00Z', '2026-09-16T18:00:00Z', '2026-10-28T18:00:00Z', '2026-12-09T19:00:00Z'].forEach(s => {
    const dt = new Date(s);
    const h = (dt.getTime() - now.getTime()) / 3600000;
    if (h >= 0 && h <= maxH) out.push({ name: 'FOMC Rate Decision', type: 'FOMC', impact: 'high', dt, h, dateStr: toPHT(dt) });
  });

  // NFP: first Friday of each month, 8:30 AM EDT
  for (const y of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    for (let m = 0; m <= 11; m++) {
      const dt = firstFridayUTC(y, m);
      const h = (dt.getTime() - now.getTime()) / 3600000;
      if (h >= 0 && h <= maxH) out.push({ name: 'Nonfarm Payrolls (NFP)', type: 'NFP', impact: 'high', dt, h, dateStr: toPHT(dt) });
    }
  }

  // CPI: ~12th of each month, 8:30 AM EDT
  for (const y of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    for (let m = 0; m <= 11; m++) {
      const dt = new Date(Date.UTC(y, m, 12, 13, 30, 0));
      const h = (dt.getTime() - now.getTime()) / 3600000;
      if (h >= 0 && h <= maxH) out.push({ name: 'Consumer Price Index (CPI) MoM', type: 'CPI', impact: 'high', dt, h, dateStr: toPHT(dt) });
    }
  }

  const priority: Record<string, number> = { FOMC: 0, NFP: 1, CPI: 2 };
  out.sort((a, b) => {
    const pa = priority[a.type] ?? 9, pb = priority[b.type] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.dt.getTime() - b.dt.getTime();
  });
  return out;
}

export default function NewsProvider({ children }: { children: React.ReactNode }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [econEvents, setEconEvents] = useState<EconEvent[]>([]);
  const [geoEvents, setGeoEvents] = useState<GeoEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [latestHeadlines, setLatestHeadlines] = useState<string[]>([]);
  const [whaleAlerts, setWhaleAlerts] = useState<WhaleAlert[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const alertIdRef = useRef(0);
  const whaleIdRef = useRef(0);
  const seenWhaleIds = useRef<Set<number>>(new Set());

  const pushAlert = useCallback((headline: string, source: string, ts: number, type: 'red' | 'amber' | 'purple', link?: string, image?: string) => {
    const key = headline.slice(0, 60);
    if (seenRef.current.has(key)) return;
    seenRef.current.add(key);

    setLatestHeadlines(prev => [headline, ...prev].slice(0, 25));

    const id = alertIdRef.current++;
    setAlerts(prev => [...prev, { id, headline, source, ts, type, link, image }]);

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(headline, {
        body: source + ' · ' + timeAgo(ts),
        requireInteraction: type === 'red',
        tag: key,
      });
    }
  }, []);

  const dismissAlert = useCallback((id: number) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  /* ── Finnhub REST news — primary source (crypto + general) ── */
  const fetchFinnhubNews = useCallback(async () => {
    try {
      const [cryptoRes, generalRes] = await Promise.allSettled([
        fetch('/api/news/finnhub?type=crypto').then(r => r.json()),
        fetch('/api/news/finnhub?type=general').then(r => r.json()),
      ]);

      const cryptoItems: Record<string, string | number>[] =
        cryptoRes.status === 'fulfilled' && Array.isArray(cryptoRes.value) ? cryptoRes.value : [];
      const generalItems: Record<string, string | number>[] =
        generalRes.status === 'fulfilled' && Array.isArray(generalRes.value) ? generalRes.value : [];

      // Crypto: always classify as at least 'purple' even if keywords miss
      cryptoItems.slice(0, 40).forEach(a => {
        const headline = (a.headline || '') as string;
        if (!headline) return;
        const type = classifyNews(headline) ?? 'purple';
        const ts = (a.datetime as number) || Math.floor(Date.now() / 1000);
        const img = (a.image as string) || undefined;
        pushAlert(headline, (a.source as string) || 'Finnhub', ts, type, undefined, img);
      });

      // General: only include if keyword matches
      generalItems.slice(0, 30).forEach(a => {
        const headline = (a.headline || '') as string;
        if (!headline) return;
        const type = classifyNews(headline);
        if (!type) return;
        const ts = (a.datetime as number) || Math.floor(Date.now() / 1000);
        const img = (a.image as string) || undefined;
        pushAlert(headline, (a.source as string) || 'Finnhub', ts, type, undefined, img);
      });
    } catch { /* */ }
  }, [pushAlert]);

  /* ── Finnhub econ calendar (falls back to computed schedule if unavailable) ── */
  const fetchEconEvents = useCallback(async () => {
    const now = new Date();
    let finnhubEvents: EconEvent[] = [];

    try {
      const from = now.toISOString().slice(0, 10);
      const to = new Date(+now + 60 * 864e5).toISOString().slice(0, 10);
      const res = await fetch(`/api/news/finnhub?type=calendar&from=${from}&to=${to}`);
      if (res.ok) {
        const data = await res.json();
        const raw: Record<string, string | number>[] = Array.isArray(data.economicCalendar) ? data.economicCalendar : [];
        const out: EconEvent[] = [];
        raw.forEach(e => {
          const name = (e.event || e.name || e.description || e.title || '') as string;
          if (!name) return;
          const cls = classifyEcon(name);
          if (!cls) return;
          let dt: Date | null = null;
          try {
            if (e.time && typeof e.time === 'number' && e.time > 1e9) dt = new Date(e.time * 1000);
            else if (e.time && typeof e.time === 'string' && (e.time as string).length > 10) dt = new Date(e.time as string);
            else if (e.date) dt = new Date((e.date as string) + 'T12:00:00Z');
          } catch { /* */ }
          if (!dt || isNaN(dt.getTime())) return;
          const h = (dt.getTime() - now.getTime()) / 3600000;
          if (h < 0) return;
          out.push({ name, type: cls.type, impact: cls.impact, dt, h, dateStr: toPHT(dt) });
        });
        out.sort((a, b) => a.dt.getTime() - b.dt.getTime());
        const seenNames = new Set<string>();
        finnhubEvents = out.filter(e => {
          if (seenNames.has(e.name)) return false;
          seenNames.add(e.name);
          return true;
        });
      }
    } catch { /* */ }

    const events = finnhubEvents.length > 0 ? finnhubEvents : getFallbackEconEvents(now);
    setEconEvents(events);
    setEventsLoaded(true);

    events.filter(e => e.h < 1).forEach(e => {
      pushAlert(`Upcoming: ${e.name} — ${countdown(e.h)}`, 'Calendar', Math.floor(Date.now() / 1000), 'amber');
    });
  }, [pushAlert]);

  /* ── Finnhub geo news ── */
  const fetchGeoEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/news/finnhub?type=general');
      const articles: Record<string, string | number>[] = await res.json();
      if (!Array.isArray(articles)) return;
      const now = Math.floor(Date.now() / 1000);
      const matched: GeoEvent[] = [];
      const seen = new Set<string>();
      articles.forEach(a => {
        const headline = ((a.headline || a.summary || '') as string).toLowerCase();
        if (!headline) return;
        if (a.datetime && (now - (a.datetime as number)) > 12 * 3600) return;
        for (const g of GEO_KEYWORDS) {
          if (matched.length >= 8) break;
          const hit = g.kw.some(k => headline.includes(k));
          if (!hit) continue;
          const key = ((a.headline || '') as string).slice(0, 50);
          if (seen.has(key)) continue;
          seen.add(key);
          const h = (now - (a.datetime as number)) / 3600;
          const timeStr = h < 1 ? Math.round(h * 60) + 'm ago' : h.toFixed(1) + 'h ago';
          matched.push({ headline: a.headline as string || '', source: a.source as string || 'Finnhub', tag: g.tag, style: g.style, note: g.note, timeStr, ts: a.datetime as number || now });

          const type = classifyNews(a.headline as string || '') || 'amber';
          pushAlert(a.headline as string || '', a.source as string || 'Finnhub', a.datetime as number || now, type);
        }
      });
      matched.sort((a, b) => b.ts - a.ts);
      setGeoEvents(matched);
    } catch { /* */ }
  }, [pushAlert]);

  /* ── Reuters / AP / BBC / CoinDesk / CoinTelegraph / Decrypt / The Block RSS ── */
  const fetchRSSNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news-rss');
      if (!res.ok) return;
      const { items } = await res.json() as { items: { title: string; source: string; pubDate: number; link?: string; image?: string; cat: string }[] };
      const cutoff = Math.floor(Date.now() / 1000) - 6 * 3600; // ignore articles older than 6h
      items.forEach(item => {
        if (item.pubDate < cutoff) return;
        // Crypto-category items always get at least 'purple'
        const type = classifyNews(item.title) ?? (item.cat === 'crypto' ? 'purple' : null);
        if (!type) return;
        pushAlert(item.title, item.source, item.pubDate, type, item.link, item.image);
      });
    } catch { /* ignore */ }
  }, [pushAlert]);

  /* ── Whale trade listener ── */
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as WhaleAlert & { id: number };
      if (seenWhaleIds.current.has(d.id)) return;
      seenWhaleIds.current.add(d.id);
      if (seenWhaleIds.current.size > 500) seenWhaleIds.current.clear();
      const alert: WhaleAlert = { ...d, id: whaleIdRef.current++ };
      setWhaleAlerts(prev => [alert, ...prev].slice(0, 30));
    };
    window.addEventListener('whale-trade', handler);
    return () => window.removeEventListener('whale-trade', handler);
  }, []);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Fire all sources immediately on mount; mark loaded after first cycle
    Promise.allSettled([fetchFinnhubNews(), fetchRSSNews()]).then(() => setAlertsLoaded(true));
    fetchEconEvents();
    fetchGeoEvents();

    const intervals = [
      setInterval(fetchFinnhubNews,  2 * 60 * 1000),    // every 2 min
      setInterval(fetchRSSNews,      60 * 1000),         // every 1 min — Reuters/AP/Al Jazeera/CoinDesk
      setInterval(fetchEconEvents,  60 * 60 * 1000),    // every 1h
      setInterval(fetchGeoEvents,    3 * 60 * 1000),    // every 3 min
    ];

    return () => {
      intervals.forEach(clearInterval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const newsActive = alerts.some(a => Date.now() / 1000 - a.ts < 5 * 60);

  return (
    <NewsContext.Provider value={{ alerts, dismissAlert, econEvents, geoEvents, eventsLoaded, alertsLoaded, newsActive, latestHeadlines, whaleAlerts }}>
      {children}
    </NewsContext.Provider>
  );
}
