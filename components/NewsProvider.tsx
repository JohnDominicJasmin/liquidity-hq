'use client';
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { classifyNews, GEO_KEYWORDS, classifyEcon } from '@/lib/classify';

const FINNHUB_KEY = 'd7f177pr01qi33g80jm0d7f177pr01qi33g80jmg';

export interface Alert {
  id: number;
  headline: string;
  source: string;
  ts: number;
  type: 'red' | 'amber' | 'purple';
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

export default function NewsProvider({ children }: { children: React.ReactNode }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [econEvents, setEconEvents] = useState<EconEvent[]>([]);
  const [geoEvents, setGeoEvents] = useState<GeoEvent[]>([]);
  const [latestHeadlines, setLatestHeadlines] = useState<string[]>([]);
  const [whaleAlerts, setWhaleAlerts] = useState<WhaleAlert[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const alertIdRef = useRef(0);
  const cpLastRef = useRef(0);
  const newsWSRef = useRef<WebSocket | null>(null);
  const wsRetriesRef = useRef(0);
  const whaleIdRef = useRef(0);
  const seenWhaleIds = useRef<Set<number>>(new Set());

  const pushAlert = useCallback((headline: string, source: string, ts: number, type: 'red' | 'amber' | 'purple') => {
    const key = headline.slice(0, 60);
    if (seenRef.current.has(key)) return;
    seenRef.current.add(key);

    setLatestHeadlines(prev => [headline, ...prev].slice(0, 10));

    const id = alertIdRef.current++;
    setAlerts(prev => [...prev, { id, headline, source, ts, type }]);

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

  /* ── Finnhub WS (supplementary live stream) ── */
  const startNewsWS = useCallback(() => {
    if (newsWSRef.current) { try { newsWSRef.current.close(); } catch { /* */ } }
    const ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);
    newsWSRef.current = ws;

    ws.onopen = () => {
      wsRetriesRef.current = 0;
      ws.send(JSON.stringify({ type: 'subscribe-news', symbol: '*' }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'news' && msg.data) {
          const items = Array.isArray(msg.data) ? msg.data : [msg.data];
          items.forEach((n: Record<string, string | number>) => {
            const headline = (n.headline || n.summary || '') as string;
            if (!headline) return;
            const type = classifyNews(headline);
            if (!type) return;
            pushAlert(headline, (n.source as string) || 'Finnhub', (n.datetime as number) || Math.floor(Date.now() / 1000), type);
          });
        }
      } catch { /* */ }
    };

    ws.onclose = () => {
      wsRetriesRef.current++;
      const delay = Math.min(30, wsRetriesRef.current * 5) * 1000;
      setTimeout(startNewsWS, delay);
    };
  }, [pushAlert]);

  /* ── Finnhub REST news — primary source (crypto + general) ── */
  const fetchFinnhubNews = useCallback(async () => {
    try {
      const [cryptoRes, generalRes] = await Promise.allSettled([
        fetch(`https://finnhub.io/api/v1/news?category=crypto&token=${FINNHUB_KEY}`).then(r => r.json()),
        fetch(`https://finnhub.io/api/v1/news?category=general&minId=0&token=${FINNHUB_KEY}`).then(r => r.json()),
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
        pushAlert(headline, (a.source as string) || 'Finnhub', ts, type);
      });

      // General: only include if keyword matches
      generalItems.slice(0, 30).forEach(a => {
        const headline = (a.headline || '') as string;
        if (!headline) return;
        const type = classifyNews(headline);
        if (!type) return;
        const ts = (a.datetime as number) || Math.floor(Date.now() / 1000);
        pushAlert(headline, (a.source as string) || 'Finnhub', ts, type);
      });
    } catch { /* */ }
  }, [pushAlert]);

  /* ── CryptoPanic poll — fixed URL (removed invalid /free/ path and filter=important) ── */
  const pollCryptoPanic = useCallback(async () => {
    try {
      const res = await fetch(
        'https://cryptopanic.com/api/v1/posts/?auth_token=free&kind=news&public=true'
      );
      if (!res.ok) return;
      const d = await res.json();
      const results = d.results || [];
      results.forEach((n: Record<string, string | Record<string, string>>) => {
        const ts = n.published_at
          ? Math.floor(new Date(n.published_at as string).getTime() / 1000)
          : Math.floor(Date.now() / 1000);
        if (ts <= cpLastRef.current) return;
        const headline = (n.title as string) || '';
        if (!headline) return;
        const type = classifyNews(headline) ?? 'purple';
        const src = (n.source as Record<string, string>)?.title || 'CryptoPanic';
        pushAlert(headline, src, ts, type);
      });
      if (results.length > 0) {
        const latest = Math.floor(new Date((results[0] as Record<string, string>).published_at).getTime() / 1000);
        if (latest > cpLastRef.current) cpLastRef.current = latest;
      }
    } catch { /* */ }
  }, [pushAlert]);

  /* ── Finnhub econ calendar ── */
  const fetchEconEvents = useCallback(async () => {
    try {
      const now = new Date();
      const from = now.toISOString().slice(0, 10);
      const to = new Date(+now + 60 * 864e5).toISOString().slice(0, 10);
      const res = await fetch(`https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${FINNHUB_KEY}`);
      const data = await res.json();
      const raw: Record<string, string | number>[] = data.economicCalendar || data || [];
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
      setEconEvents(out);

      out.filter(e => e.h < 1).forEach(e => {
        pushAlert(`Upcoming: ${e.name} — ${countdown(e.h)}`, 'Finnhub Calendar', Math.floor(Date.now() / 1000), 'amber');
      });
    } catch { /* */ }
  }, [pushAlert]);

  /* ── Finnhub geo news ── */
  const fetchGeoEvents = useCallback(async () => {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/news?category=general&minId=0&token=${FINNHUB_KEY}`);
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

    // Fire all sources immediately on mount
    startNewsWS();
    fetchFinnhubNews();   // PRIMARY: REST poll — most reliable
    fetchEconEvents();
    fetchGeoEvents();
    pollCryptoPanic();    // SECONDARY: CryptoPanic

    /* Polling intervals */
    const cpInterval = () => {
      const pht = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
      const h = pht.getHours();
      return (h >= 20 || h < 7) ? 5 * 60 * 1000 : 15 * 60 * 1000;
    };
    let cpTimer: ReturnType<typeof setTimeout>;
    const scheduleCryptoPanic = () => {
      cpTimer = setTimeout(() => { pollCryptoPanic(); scheduleCryptoPanic(); }, cpInterval());
    };
    scheduleCryptoPanic();

    const intervals = [
      setInterval(fetchFinnhubNews,  5 * 60 * 1000),    // every 5 min
      setInterval(fetchEconEvents,   60 * 60 * 1000),   // every 1h
      setInterval(fetchGeoEvents,    15 * 60 * 1000),   // every 15 min
    ];

    return () => {
      intervals.forEach(clearInterval);
      clearTimeout(cpTimer);
      newsWSRef.current?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const newsActive = alerts.some(a => Date.now() / 1000 - a.ts < 5 * 60);

  return (
    <NewsContext.Provider value={{ alerts, dismissAlert, econEvents, geoEvents, newsActive, latestHeadlines, whaleAlerts }}>
      {children}
    </NewsContext.Provider>
  );
}
