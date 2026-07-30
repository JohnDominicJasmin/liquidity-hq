'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useNews } from './NewsProvider';

function decodeEntities(str: string): string {
  if (typeof document === 'undefined') return str;
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

export default function NewsTicker() {
  const { alerts } = useNews();
  const spanRef = useRef<HTMLSpanElement>(null);
  const [duration, setDuration] = useState(60);
  const [dismissedTs, setDismissedTs] = useState(0);

  // Tick every 60s so aged-out items drop from the ticker without waiting for new alerts
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Restore the last dismissal so a dismissed batch stays hidden across reloads -
  // the ticker only comes back when a newer alert arrives (ts beyond this mark).
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem('lhq_ticker_dismissed_ts') || 0);
      if (v) setDismissedTs(v);
    } catch {}
  }, []);

  // Filter by severity + recency, rank, THEN cap - in that order.
  //
  // The cap used to be applied before the sort, which silently made this a
  // "first 12 that arrived" list rather than a "12 most important" one:
  // `alerts` is in arrival order, and NewsProvider hydrates oldest-first, so a
  // freshly-pushed breaking headline landed at the end of the array and was
  // sliced away before the severity sort ever saw it. Recency filtering hid
  // most of the damage, but a ticker that drops the newest item is exactly
  // backwards. Ranking first means the cap now discards the least important
  // items instead of the most recent ones.
  const sorted = useMemo(() => {
    const now = Date.now() / 1000;
    const order = { red: 0, amber: 1, purple: 2 } as const;
    return alerts
      .filter(a => {
        if (a.type === 'red')   return now - a.ts < 7200;  // 2 hours
        if (a.type === 'amber') return now - a.ts < 3600;  // 1 hour
        return now - a.ts < 900;                            // 15 min for purple
      })
      // filter() already returned a fresh array, so sorting in place here does
      // not mutate the alerts array held in NewsProvider's state.
      .sort((a, b) => {
        if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
        return b.ts - a.ts;
      })
      .slice(0, 12);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts, tick]);  // tick forces re-evaluation of timestamps every 60s

  const topType = sorted.some(a => a.type === 'red')
    ? 'red'
    : sorted.some(a => a.type === 'amber')
    ? 'amber'
    : 'purple';

  const label = topType === 'red' ? 'BREAKING' : topType === 'amber' ? 'ALERT' : 'NEWS';

  const text = useMemo(() =>
    sorted
      .map(a => `${decodeEntities(a.headline)}  (${a.source} · ${timeAgo(a.ts)})`)
      .join('          ·          '),
  [sorted]);

  // Calculate animation duration based on content width for constant 80px/s speed.
  // Defers via rAF to ensure layout has completed before measuring offsetWidth.
  useEffect(() => {
    let raf: number;
    const measure = () => {
      if (!spanRef.current) return;
      const w = spanRef.current.offsetWidth;
      if (w > 0) setDuration(Math.max(20, Math.round(w / 80)));
      else raf = requestAnimationFrame(measure); // layout not ready yet, retry
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  // Newest timestamp in the current batch; the ticker is hidden once dismissed
  // and only reappears when something newer than the dismissal arrives.
  const newestTs = useMemo(() => sorted.reduce((m, a) => Math.max(m, a.ts), 0), [sorted]);
  const visible = sorted.length > 0 && newestTs > dismissedTs;

  // Toggle body class so app-content top-padding can adjust
  useEffect(() => {
    document.body.classList.toggle('ticker-on', visible);
    return () => document.body.classList.remove('ticker-on');
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    setDismissedTs(newestTs);
    try { localStorage.setItem('lhq_ticker_dismissed_ts', String(newestTs)); } catch {}
  };

  return (
    <div className={`news-ticker ticker-${topType}`}>
      <div className="ticker-badge">{label}</div>
      <div className="ticker-sep" />
      <div className="ticker-track">
        <div
          className="ticker-content"
          style={{ animationDuration: `${duration}s` }}
        >
          <span ref={spanRef}>{text}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
          <span aria-hidden="true">{text}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
        </div>
      </div>
      <button
        className="ticker-close"
        onClick={dismiss}
        aria-label="Hide news until a newer alert"
        title="Hide until a newer alert"
        type="button"
      >
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <line x1="5" y1="5" x2="15" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="15" y1="5" x2="5" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
