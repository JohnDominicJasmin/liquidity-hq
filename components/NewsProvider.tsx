'use client';
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { GEO_KEYWORDS } from '@/lib/classify';
import { useNow } from '@/lib/useNow';
import { getSupabase } from '@/lib/supabase';
import { T } from '@/lib/tables';

// Push-based, not polled. A scheduled job (app/api/news/ingest and
// app/api/econ-calendar/ingest, see docs/INFRASTRUCTURE.md §2) does the
// upstream fetching once and writes to the news / econ snapshot tables; this
// provider reads each table once to hydrate, then subscribes via Supabase
// Realtime. Previously every open tab ran its own four timers against
// /api/news/finnhub (2min), /api/news-rss (1min), /api/news/finnhub geo (3min)
// and /api/econ-calendar (1h), so upstream load scaled with viewer count and a
// breaking headline could sit up to a full interval before showing up.

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
  previous?: string;
  estimate?: string;
  actual?: string;
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

// A row of the news table, as written by app/api/news/ingest.
interface NewsRow {
  dedup_key: string;
  headline: string;
  source: string;
  published_at: string;
  severity: string | null;
  cat: string;
  link: string | null;
  image: string | null;
}

// Matches app/api/econ-calendar's CalEvent - the raw snapshot shape, kept
// alongside the display-ready EconEvent because ConfluenceScore's macro-risk
// factor wants the unformatted isoDate.
export interface CalEvent {
  name: string; type: string; isoDate: string; impact: string;
  previous?: string; estimate?: string; actual?: string;
}

interface NewsCtx {
  alerts: Alert[];
  dismissAlert: (id: number) => void;
  econEvents: EconEvent[];
  econRaw: CalEvent[];
  geoEvents: GeoEvent[];
  eventsLoaded: boolean;
  alertsLoaded: boolean;  // true once the initial news read has been applied
  newsActive: boolean;
  latestHeadlines: string[];
  whaleAlerts: WhaleAlert[];
}

const NewsContext = createContext<NewsCtx | null>(null);
export function useNews() { return useContext(NewsContext)!; }

// Module-level flag - survives React StrictMode double-mount so permission is only requested once
let _notifRequested = false;

// Upper bounds for the two structures that would otherwise grow for the whole
// lifetime of a tab. Both sit comfortably above what anything renders: the
// ticker caps at 12 and drops anything past its 2h red window, and hydration
// reads at most 150 rows.
const ALERT_LIMIT = 300;
const SEEN_LIMIT  = 1000;

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

function toLocalTime(dt: Date): string {
  try {
    return dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
  const [econRaw, setEconRaw] = useState<CalEvent[]>([]);
  const [newsRows, setNewsRows] = useState<NewsRow[]>([]);
  // Replaces a `geoTick` counter that existed only to force the relative
  // timestamps below to recompute, and which had to be referenced with a
  // `void geoTick;` statement to stop it looking unused. useNow expresses the
  // same intent directly and hands back a clock the render can actually use.
  const nowMs = useNow(60_000);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [latestHeadlines, setLatestHeadlines] = useState<string[]>([]);
  const [whaleAlerts, setWhaleAlerts] = useState<WhaleAlert[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const alertIdRef = useRef(0);
  const whaleIdRef = useRef(0);
  const seenWhaleIds = useRef<Set<number>>(new Set());
  // Mirror the two loaded flags into refs so the Realtime fallback timer can
  // read their current values - it is created once and would otherwise close
  // over whatever they were on first render.
  const alertsLoadedRef = useRef(false);
  const eventsLoadedRef = useRef(false);

  const pushAlert = useCallback((
    headline: string,
    source: string,
    ts: number,
    type: 'red' | 'amber' | 'purple',
    link?: string,
    image?: string,
    // Hydration replays rows that already existed, so it passes false here.
    // Without that, every reload re-fired a desktop notification for anything
    // under 15 minutes old - and with a one-minute ingest cadence there is
    // almost always something that recent, so a refresh meant a burst of
    // notifications for news the user had already been told about. Only
    // genuinely live Realtime pushes should notify.
    notify = true,
  ) => {
    const key = headline.slice(0, 60);
    if (seenRef.current.has(key)) return;
    seenRef.current.add(key);
    // Bound the dedup set. Set preserves insertion order, so dropping from the
    // front evicts the oldest keys. Safe because ingest only ever serves the
    // last 6h and prunes past 12h, so an evicted headline cannot come back and
    // re-fire - whereas clearing the whole set (the pattern used for whale ids
    // below) would let everything still on screen re-add itself.
    if (seenRef.current.size > SEEN_LIMIT) {
      const excess = seenRef.current.size - SEEN_LIMIT;
      let i = 0;
      for (const k of seenRef.current) {
        if (i++ >= excess) break;
        seenRef.current.delete(k);
      }
    }

    setLatestHeadlines(prev => [headline, ...prev].slice(0, 25));

    const id = alertIdRef.current++;
    // Cap the alert list. It used to grow for the lifetime of the tab, bounded
    // only by how many distinct headlines arrived - a session left open all day
    // accumulated every one of them. Nothing displays alerts older than the
    // ticker's 2h red window anyway, so keeping the newest ALERT_LIMIT costs no
    // visible behaviour. Trimmed from the front since alerts are appended.
    setAlerts(prev => {
      const next = [...prev, { id, headline, source, ts, type, link, image }];
      return next.length > ALERT_LIMIT ? next.slice(next.length - ALERT_LIMIT) : next;
    });

    // Only notify for articles < 15 min old - prevents stale articles re-firing on page refresh
    const ageMs = Date.now() - ts * 1000;
    if (notify && 'Notification' in window && Notification.permission === 'granted' && ageMs < 15 * 60 * 1000) {
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

  /* ── One news row, from either the hydration read or a Realtime push ──
   * notify=false for the hydration pass: those rows already existed before
   * this tab opened, so re-announcing them on every reload is noise. */
  const ingestRow = useCallback((row: NewsRow, notify = true) => {
    const ts = Math.floor(new Date(row.published_at).getTime() / 1000);
    if (!row.headline || isNaN(ts)) return;
    // severity is null for rows that reached the table on a geo-keyword match
    // alone; those still belong in the ticker, at 'amber' as before.
    pushAlert(row.headline, row.source, ts, (row.severity as Alert['type']) ?? 'amber', row.link ?? undefined, row.image ?? undefined, notify);
    setNewsRows(prev => (prev.some(r => r.dedup_key === row.dedup_key) ? prev : [row, ...prev].slice(0, 200)));
  }, [pushAlert]);

  /* ── Economic calendar snapshot, from the read or a Realtime push ── */
  const applyEconSnapshot = useCallback((raw: CalEvent[]) => {
    const now = new Date();
    const seen = new Set<string>();
    const events: EconEvent[] = raw
      .flatMap(e => {
        const key = `${e.name}|${e.isoDate}`;
        if (seen.has(key)) return [];
        const dt = new Date(e.isoDate);
        if (isNaN(dt.getTime())) return [];
        const h = (dt.getTime() - now.getTime()) / 3600000;
        if (h < -24) return [];
        seen.add(key);
        return [{ name: e.name, type: e.type, impact: e.impact, dt, h, dateStr: toLocalTime(dt), previous: e.previous, estimate: e.estimate, actual: e.actual }];
      })
      .sort((a, b) => a.dt.getTime() - b.dt.getTime());
    setEconRaw(raw);
    setEconEvents(events);
    setEventsLoaded(true);
    events.filter(e => e.h >= 0 && e.h < 1).forEach(e => {
      pushAlert(`Upcoming: ${e.name} - ${countdown(e.h)}`, 'Calendar', Math.floor(Date.now() / 1000), 'amber');
    });
  }, [pushAlert]);

  useEffect(() => { alertsLoadedRef.current = alertsLoaded; }, [alertsLoaded]);
  useEffect(() => { eventsLoadedRef.current = eventsLoaded; }, [eventsLoaded]);

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
    if ('Notification' in window && Notification.permission === 'default' && !_notifRequested) {
      _notifRequested = true;
      Notification.requestPermission();
    }

    const sb = getSupabase();
    if (!sb) { setAlertsLoaded(true); setEventsLoaded(true); return; }

    let live = true;

    // Hydration fills in what existed before this tab opened - Realtime only
    // delivers changes made after the subscription is live, so without a read
    // a fresh tab would start blank until the next ingest run.
    //
    // It runs from inside the subscribe() callback, NOT alongside it, and that
    // ordering is the point: subscribing is an async websocket handshake, so
    // reading first leaves a window where a row is in neither the read's result
    // nor the not-yet-live subscription, and it is silently lost until the next
    // full page load. Subscribe-then-read cannot drop a row; it can only
    // duplicate one, and both paths already dedupe (pushAlert's seenRef and
    // newsRows' dedup_key check).
    //
    // Re-running on every SUBSCRIBED is deliberate too - the callback fires
    // again after a reconnect, which is exactly when a tab needs to catch up on
    // whatever it missed while the socket was down.
    const hydrateNews = async () => {
      const cutoff = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
      const { data } = await sb
        .from(T.news)
        .select('dedup_key, headline, source, published_at, severity, cat, link, image')
        .gte('published_at', cutoff)
        .order('published_at', { ascending: false })
        .limit(150);
      if (!live) return;
      // Oldest first so pushAlert's arrival order matches chronological order.
      // Explicit arrow rather than passing ingestRow straight to forEach -
      // forEach hands the index in as the second argument, which would land on
      // the notify parameter and make every row after the first notify.
      (data as NewsRow[] | null)?.slice().reverse().forEach(row => ingestRow(row, false));
      setAlertsLoaded(true);
    };

    const hydrateEcon = async () => {
      const { data } = await sb
        .from(T.econ_snapshot)
        .select('events')
        .eq('key', 'us_high_impact')
        .maybeSingle();
      if (!live) return;
      const events = (data as { events?: CalEvent[] } | null)?.events;
      if (events?.length) applyEconSnapshot(events);
      else setEventsLoaded(true);
    };

    const newsChannel = sb
      .channel('news-stream')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: T.news }, payload => {
        ingestRow(payload.new as NewsRow);
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED' && live) hydrateNews();
      });

    // Re-reads rather than using payload.new: the snapshot is one jsonb column
    // holding the whole 90-day calendar, and a read is cheap at one per hour.
    const econChannel = sb
      .channel('econ-snapshot')
      .on('postgres_changes', { event: '*', schema: 'public', table: T.econ_snapshot }, () => {
        if (live) hydrateEcon();
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED' && live) hydrateEcon();
      });

    // Realtime can fail entirely - blocked websocket, offline, project paused.
    // Without this the ticker would sit empty forever behind a spinner, since
    // the only read is now inside the subscribe callback that never fires.
    const hydrateFallback = setTimeout(() => {
      if (!live) return;
      if (!alertsLoadedRef.current) hydrateNews();
      if (!eventsLoadedRef.current) hydrateEcon();
    }, 5000);

    return () => {
      live = false;
      clearTimeout(hydrateFallback);
      sb.removeChannel(newsChannel);
      sb.removeChannel(econChannel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // "War & Geo" is derived from the same rows the ticker uses rather than its
  // own request - the geo keywords are what the ingest job already used to
  // decide these rows were worth storing, so re-running them here needs no
  // extra fetch. nowMs only exists to keep the relative timestamps moving now
  // that nothing re-fetches on a timer.
  const geoEvents: GeoEvent[] = (() => {
    const now = Math.floor(nowMs / 1000);
    const out: GeoEvent[] = [];
    const seen = new Set<string>();
    for (const row of [...newsRows].sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at))) {
      if (out.length >= 8) break;
      const ts = Math.floor(new Date(row.published_at).getTime() / 1000);
      if (now - ts > 12 * 3600) continue;
      const hay = row.headline.toLowerCase();
      const g = GEO_KEYWORDS.find(group => group.kw.some(k => hay.includes(k)));
      if (!g) continue;
      const key = row.headline.slice(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);
      const h = (now - ts) / 3600;
      out.push({
        headline: row.headline,
        source: row.source,
        tag: g.tag,
        style: g.style,
        note: g.note,
        timeStr: h < 1 ? Math.round(h * 60) + 'm ago' : h.toFixed(1) + 'h ago',
        ts,
      });
    }
    return out;
  })();

  // The display-only clock that used to live here (a setInterval bumping
  // geoTick) is now useNow above - same "keeps '12m ago' honest between
  // pushes" job, one less piece of state.

  const newsActive = alerts.some(a => nowMs / 1000 - a.ts < 5 * 60);

  return (
    <NewsContext.Provider value={{ alerts, dismissAlert, econEvents, econRaw, geoEvents, eventsLoaded, alertsLoaded, newsActive, latestHeadlines, whaleAlerts }}>
      {children}
    </NewsContext.Provider>
  );
}
