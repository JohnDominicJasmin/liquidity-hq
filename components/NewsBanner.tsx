'use client';
import { useState } from 'react';
import { useNews } from './NewsProvider';
import { ECON_NOTES } from '@/lib/classify';

function countdown(h: number): string {
  if (h < 0) return 'Just passed';
  if (h < 0.5) return 'Happening NOW';
  if (h < 24) return Math.round(h) + 'h away';
  const d = Math.floor(h / 24), r = Math.round(h % 24);
  return d + 'd' + (r ? ' ' + r + 'h' : '') + ' away';
}

export default function NewsBanner() {
  const { econEvents, geoEvents, eventsLoaded } = useNews();
  const [hidden, setHidden] = useState(false);

  if (hidden) return (
    <div className="news-banner">
      <div className="news-header">
        <span className="news-title">Catalysts & Events</span>
        <button className="news-toggle" onClick={() => setHidden(false)}>show</button>
      </div>
    </div>
  );

  const hasItems = econEvents.length > 0 || geoEvents.length > 0;

  return (
    <div className="news-banner">
      <div className="news-header">
        <span className="news-title">Catalysts & Events</span>
        {hasItems && <span className="news-scroll-hint">↔ scroll</span>}
        <button className="news-toggle" onClick={() => setHidden(true)}>hide</button>
      </div>
      <div className="news-scroll-outer">
      <div className="news-scroll">
        <div className="news-row">
          {!hasItems && (
            <div style={{ fontSize: 'var(--fs-caption)', color: '#555', padding: '8px 0' }}>
              {eventsLoaded ? 'No upcoming events' : 'Loading events…'}
            </div>
          )}

          {econEvents.map((e, i) => {
            const timeCls = e.h < 2 ? 'nc-time-urgent' : e.h < 24 ? 'nc-time-soon' : 'nc-time-ok';
            const isUrgent = e.impact === 'high' && e.h < 2;
            return (
              <div key={i} className={`nc nc-econ${isUrgent ? ' nc-urgent' : ''}`}>
                <div className="nc-tag">{e.type}</div>
                <div className="nc-name">{e.name}</div>
                <div className={`nc-time ${timeCls}`}>{countdown(e.h)}</div>
                <div className="nc-source">{e.dateStr}</div>
                <div className={`nc-impact${e.impact === 'med' ? ' nc-impact-med' : ''}`}>
                  {e.impact === 'high' ? 'High impact' : 'Med impact'}
                </div>
              </div>
            );
          })}

          {geoEvents.map((e, i) => {
            const cls = e.style === 'speech' ? 'nc-fed' : e.style === 'crypto' ? 'nc-crypto' : 'nc-geo';
            return (
              <div key={i} className={`nc ${cls}`}>
                <div className="nc-tag">{e.tag}</div>
                <div className="nc-name">{e.headline}</div>
                <div className="nc-time nc-time-ok">{e.timeStr}</div>
                <div className="nc-source">{e.source}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="news-scroll-fade" />
      </div>
    </div>
  );
}
