'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useNews } from './NewsProvider';

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

  // Filter by severity + recency
  const items = useMemo(() => {
    const now = Date.now() / 1000;
    return alerts
      .filter(a => {
        if (a.type === 'red')   return now - a.ts < 7200;  // 2 hours
        if (a.type === 'amber') return now - a.ts < 3600;  // 1 hour
        return now - a.ts < 900;                            // 15 min for purple
      })
      .slice(0, 12);
  }, [alerts]);

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
      .map(a => `${a.headline}  (${a.source} · ${timeAgo(a.ts)})`)
      .join('          ·          '),
  [sorted]);

  // Calculate animation duration based on content width for constant 80px/s speed
  useEffect(() => {
    if (!spanRef.current) return;
    const w = spanRef.current.offsetWidth;
    setDuration(Math.max(8, Math.round(w / 80)));
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
