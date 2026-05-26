'use client';
import { useState, useEffect, useRef } from 'react';
import { useNews } from './NewsProvider';
import { tagLabel } from '@/lib/classify';

const AUTO_MS = 12000;

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

export default function BreakingAlert() {
  const { alerts, dismissAlert } = useNews();
  const [visible, setVisible] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = alerts[alerts.length - 1] ?? null;

  useEffect(() => {
    if (!current) return;
    setVisible(current.id);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setVisible(null);
      setTimeout(() => dismissAlert(current.id), 400);
    }, AUTO_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return null;

  const show = visible === current.id;

  return (
    <div className="breaking-alert">
      <div className={`ba-card type-${current.type}${show ? ' show' : ''}`}>
        <div className="ba-top">
          <span className="ba-tag">{tagLabel(current.type)}</span>
          <span className="ba-close" onClick={() => {
            setVisible(null);
            setTimeout(() => dismissAlert(current.id), 400);
          }}>✕</span>
        </div>
        <div className="ba-headline">{current.headline}</div>
        <div className="ba-meta">
          <span className="ba-source">{current.source}</span>
          <span className="ba-time">{timeAgo(current.ts)}</span>
        </div>
        <div className="ba-bar">
          <div className="ba-bar-fill" style={{ transitionDuration: AUTO_MS + 'ms', width: show ? '0%' : '100%' }} />
        </div>
      </div>
    </div>
  );
}
