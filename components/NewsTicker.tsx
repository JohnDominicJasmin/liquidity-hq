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

  // Tick every 60s so aged-out items drop from the ticker without waiting for new alerts
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Filter by severity + recency — re-evaluated every tick
  const items = useMemo(() => {
    const now = Date.now() / 1000;
    return alerts
      .filter(a => {
        if (a.type === 'red')   return now - a.ts < 7200;  // 2 hours
        if (a.type === 'amber') return now - a.ts < 3600;  // 1 hour
        return now - a.ts < 900;                            // 15 min for purple
      })
      .slice(0, 12);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts, tick]);  // tick forces re-evaluation of timestamps every 60s

  // Sort: red first → amber → purple → newest within each tier
  const sorted = useMemo(() => {
    const order = { red: 0, amber: 1, purple: 2 } as const;
    return [...items].sort((a, b) => {
      if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
      return b.ts - a.ts;
    });
  }, [items]);

  const topType = items.some(a => a.type === 'red')
    ? 'red'
    : items.some(a => a.type === 'amber')
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

  // Toggle body class so app-content top-padding can adjust
  useEffect(() => {
    document.body.classList.toggle('ticker-on', items.length > 0);
    return () => document.body.classList.remove('ticker-on');
  }, [items.length]);

  if (items.length === 0) return null;

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
    </div>
  );
}
