'use client';
import { useState } from 'react';
import { useNews, Alert } from './NewsProvider';

type Filter = 'all' | 'bearish' | 'bullish' | 'neutral';

function isNYSession(): boolean {
  // NY session: 13:30–18:00 UTC (Mon–Fri)
  const d = new Date();
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= 810 && mins < 1080;
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

const FILTER_MAP: Record<Filter, Alert['type'] | null> = {
  all: null, bearish: 'red', bullish: 'purple', neutral: 'amber',
};

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All', bearish: '▼ Bearish', bullish: '▲ Bullish', neutral: '◆ Neutral',
};

export default function NewsFeed() {
  const { alerts } = useNews();
  const [filter, setFilter] = useState<Filter>('all');
  const nySession = isNYSession();

  const filtered = filter === 'all'
    ? alerts
    : alerts.filter(a => a.type === FILTER_MAP[filter]);

  return (
    <div className="nf-wrap">
      <div className="nf-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="lbl" style={{ margin: 0 }}>News Feed</div>
          {nySession && (
            <span className="nf-ny-badge">NY Session</span>
          )}
        </div>
        <div style={{ fontSize: '0.625rem', color: '#444' }}>
          {alerts.length} alerts · {nySession ? '5m refresh' : '15m refresh'}
        </div>
      </div>

      <div className="nf-filters">
        {(['all', 'bearish', 'bullish', 'neutral'] as Filter[]).map(f => (
          <button
            key={f}
            className={`nf-filter-btn${filter === f ? ' on' : ''} nf-${f}`}
            onClick={() => setFilter(f)}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: '#444', textAlign: 'center', padding: '1.5rem 0' }}>
          {alerts.length === 0 ? 'Waiting for news...' : 'No alerts match this filter.'}
        </div>
      ) : (
        <div className="nf-list">
          {filtered.map(a => (
            <div key={a.id} className={`nf-item nf-item-${a.type}`}>
              <div className="nf-item-top">
                <span className={`nf-type-dot dot-${a.type}`} />
                <span className="nf-source">{a.source}</span>
                <span className="nf-time">{timeAgo(a.ts)}</span>
              </div>
              <div className="nf-headline">{a.headline}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: '0.625rem', color: 'var(--txt3)', marginTop: 10, paddingTop: 8, borderTop: '0.5px solid var(--bdr)' }}>
        Sources: Finnhub REST + RSS (Reuters/AP/CoinDesk) · Finnhub Calendar &amp; Geo news - classified by keyword. Not Grok API.
      </div>
    </div>
  );
}
