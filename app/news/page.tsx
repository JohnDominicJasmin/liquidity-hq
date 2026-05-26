'use client';
import { useState } from 'react';
import { useNews } from '@/components/NewsProvider';
import { GEO_KEYWORDS, ECON_NOTES } from '@/lib/classify';

type Tab = 'foryou' | 'all' | 'geo' | 'crypto' | 'events';

const TABS: { id: Tab; label: string }[] = [
  { id: 'foryou',  label: '⚡ For You'  },
  { id: 'all',     label: '📰 All'      },
  { id: 'geo',     label: '🌍 War & Geo' },
  { id: 'crypto',  label: '₿ Crypto'   },
  { id: 'events',  label: '📅 Events'   },
];

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60)    return 'just now';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function getGeoMeta(headline: string): { tag: string; note: string } | null {
  const h = headline.toLowerCase();
  for (const g of GEO_KEYWORDS) {
    if (g.kw.some(k => h.includes(k))) return { tag: g.tag, note: g.note };
  }
  return null;
}

const TYPE_CONFIG = {
  red:    { bg: '#1e0d0d', border: '#662222', dot: '#ff9a92', label: '🔴 Breaking' },
  amber:  { bg: '#1a1400', border: '#553d00', dot: '#f5cc7a', label: '🟡 Macro'    },
  purple: { bg: '#110f1e', border: '#2d2660', dot: '#b8aeff', label: '🟣 Crypto'   },
};

function askGrok(headline: string) {
  window.dispatchEvent(new CustomEvent('grok-chat', {
    detail: {
      coin: 'btc',
      prompt: `Breaking news: "${headline}"\n\nHow does this affect BTC and crypto markets right now? What's the likely short-term price impact, direction bias, and should I adjust my position?`,
    },
  }));
}

export default function NewsPage() {
  const { alerts, geoEvents, econEvents } = useNews();
  const [tab, setTab] = useState<Tab>('foryou');

  /* ── For You: red + amber alerts enriched with impact note ── */
  const catalysts = alerts
    .filter(a => a.type === 'red' || a.type === 'amber')
    .map(a => ({ ...a, geo: getGeoMeta(a.headline) }));

  /* Add geo events not already in alerts */
  const geoAlertHeadlines = new Set(catalysts.map(c => c.headline.slice(0, 50)));
  const extraGeo = geoEvents.filter(g => !geoAlertHeadlines.has(g.headline.slice(0, 50)));

  /* ── Tab content ── */
  const tabContent = {
    foryou:  catalysts,
    all:     alerts,
    geo:     alerts.filter(a => a.type === 'red'),
    crypto:  alerts.filter(a => a.type === 'purple'),
    events:  [],   // handled separately
  };

  const isEmpty = tab !== 'events' && tabContent[tab].length === 0;

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#e8e8e8', marginBottom: 2 }}>News</div>
        <div style={{ fontSize: 12, color: '#606060', marginBottom: 12 }}>
          Live feed · Finnhub WS + CryptoPanic · {alerts.length} alerts
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="ntab-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`ntab-btn${tab === t.id ? ' on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'foryou' && catalysts.length > 0 && (
              <span className="ntab-count">{catalysts.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── For You tab ── */}
      {tab === 'foryou' && (
        <div className="nfeed">
          {catalysts.length === 0 && extraGeo.length === 0 && (
            <div className="nfeed-empty">
              <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
              <div style={{ fontSize: 14, color: '#a0a0a0', fontWeight: 600 }}>Scanning for catalysts…</div>
              <div style={{ fontSize: 12, color: '#444', marginTop: 4 }}>High-impact news will appear here</div>
            </div>
          )}

          {catalysts.map(a => {
            const cfg = TYPE_CONFIG[a.type];
            const geo = a.geo;
            return (
              <div key={a.id} className="ncard ncard-catalyst" style={{ background: cfg.bg, borderColor: cfg.border }}>
                <div className="ncard-top">
                  <span className="ncard-type-badge" style={{ color: cfg.dot, borderColor: cfg.border }}>
                    {geo ? geo.tag : cfg.label}
                  </span>
                  <span className="ncard-meta">{a.source} · {timeAgo(a.ts)}</span>
                </div>
                <div className="ncard-headline">{a.headline}</div>
                {geo && (
                  <div className="ncard-impact">
                    <span className="ncard-impact-icon">💡</span>
                    <span className="ncard-impact-text">{geo.note}</span>
                  </div>
                )}
                <button className="ncard-ask-btn" onClick={() => askGrok(a.headline)}>
                  Ask Grok →
                </button>
              </div>
            );
          })}

          {/* Extra geo events */}
          {extraGeo.map((g, i) => (
            <div key={i} className="ncard ncard-catalyst" style={{ background: '#1a0f14', borderColor: '#662244' }}>
              <div className="ncard-top">
                <span className="ncard-type-badge" style={{ color: '#ff9a92', borderColor: '#662244' }}>
                  {g.tag}
                </span>
                <span className="ncard-meta">{g.source} · {g.timeStr}</span>
              </div>
              <div className="ncard-headline">{g.headline}</div>
              <div className="ncard-impact">
                <span className="ncard-impact-icon">💡</span>
                <span className="ncard-impact-text">{g.note}</span>
              </div>
              <button className="ncard-ask-btn" onClick={() => askGrok(g.headline)}>
                Ask Grok →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── All / Geo / Crypto tabs ── */}
      {(tab === 'all' || tab === 'geo' || tab === 'crypto') && (
        <div className="nfeed">
          {isEmpty && (
            <div className="nfeed-empty">
              <div style={{ fontSize: 24, marginBottom: 8 }}>📭</div>
              <div style={{ fontSize: 13, color: '#606060' }}>
                {tab === 'geo' ? 'No war/conflict alerts yet' : tab === 'crypto' ? 'No crypto news yet' : 'No alerts yet — waiting for feed'}
              </div>
            </div>
          )}
          {tabContent[tab].map(a => {
            const cfg = TYPE_CONFIG[a.type];
            const geo = getGeoMeta(a.headline);
            return (
              <div key={a.id} className="ncard" style={{ background: cfg.bg, borderColor: cfg.border }}>
                <div className="ncard-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="ncard-dot" style={{ background: cfg.dot }} />
                    <span className="ncard-meta">{a.source}</span>
                    {geo && <span className="ncard-geo-tag">{geo.tag}</span>}
                  </div>
                  <span className="ncard-meta">{timeAgo(a.ts)}</span>
                </div>
                <div className="ncard-headline">{a.headline}</div>
                <div style={{ marginTop: 8 }}>
                  <button className="ncard-ask-sm" onClick={() => askGrok(a.headline)}>Ask Grok</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Events tab ── */}
      {tab === 'events' && (
        <div className="nfeed">
          {econEvents.length === 0 && (
            <div className="nfeed-empty">
              <div style={{ fontSize: 13, color: '#606060' }}>No upcoming high-impact events in the next 60 days</div>
            </div>
          )}
          {econEvents.map((e, i) => {
            const note = ECON_NOTES[e.type];
            const urgent = e.h < 2;
            const soon   = e.h < 24;
            return (
              <div key={i} className="ncard" style={{
                background: urgent ? '#1e1400' : '#161616',
                borderColor: urgent ? '#664400' : soon ? '#3a2e00' : 'rgba(255,255,255,0.07)',
              }}>
                <div className="ncard-top">
                  <span className="ncard-type-badge" style={{
                    color: urgent ? '#f28b82' : soon ? '#f5cc7a' : '#a0a0a0',
                    borderColor: urgent ? '#662222' : soon ? '#553d00' : 'rgba(255,255,255,0.1)',
                  }}>
                    {e.type}
                  </span>
                  <span className="ncard-meta" style={{ color: urgent ? '#f28b82' : soon ? '#f5cc7a' : '#606060' }}>
                    {e.h < 0.5 ? '🔴 NOW' : e.h < 2 ? `⚠ ${Math.round(e.h * 60)}m away` : e.h < 24 ? `${Math.round(e.h)}h away` : e.dateStr}
                  </span>
                </div>
                <div className="ncard-headline">{e.name}</div>
                {note && (
                  <div className="ncard-impact">
                    <span className="ncard-impact-icon">💡</span>
                    <span className="ncard-impact-text">{note}</span>
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ fontSize: 10, color: '#333', marginTop: 8, textAlign: 'center' }}>
            Source: Finnhub Economic Calendar — high-impact events only
          </div>
        </div>
      )}
    </div>
  );
}
