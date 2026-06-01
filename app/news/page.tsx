'use client';
import { useState } from 'react';
import { useNews } from '@/components/NewsProvider';
import { GEO_KEYWORDS, ECON_NOTES } from '@/lib/classify';

type Tab = 'foryou' | 'all' | 'geo' | 'crypto' | 'events';

const TABS: { id: Tab; label: string }[] = [
  { id: 'foryou',  label: 'For You'   },
  { id: 'all',     label: 'All'       },
  { id: 'geo',     label: 'War & Geo' },
  { id: 'crypto',  label: 'Crypto'    },
  { id: 'events',  label: 'Events'    },
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

function fmtUSD(v: number): string {
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
  return '$' + (v / 1000).toFixed(0) + 'K';
}

function askGrok(headline: string) {
  window.dispatchEvent(new CustomEvent('grok-chat', {
    detail: {
      coin: 'btc',
      prompt: `Breaking news: "${headline}"\n\nHow does this affect BTC and crypto markets right now? What's the likely short-term price impact, direction bias, and should I adjust my position?`,
    },
  }));
}

/* ── Card background styles by type (dark-mode friendly) ── */
const TYPE_STYLE = {
  red:    { bg: 'rgba(185,28,28,0.08)',  border: 'rgba(220,38,38,0.30)',  dot: '#f87171', label: 'Breaking', labelBg: 'rgba(248,113,113,0.12)' },
  amber:  { bg: 'rgba(180,83,9,0.08)',   border: 'rgba(217,119,6,0.30)',  dot: '#fbbf24', label: 'Macro',    labelBg: 'rgba(251,191,36,0.12)'  },
  purple: { bg: 'rgba(109,40,217,0.06)', border: 'rgba(124,58,237,0.22)', dot: '#a78bfa', label: 'Crypto',   labelBg: 'rgba(167,139,250,0.12)' },
};

export default function NewsPage() {
  const { alerts, geoEvents, econEvents, whaleAlerts } = useNews();
  const [tab, setTab] = useState<Tab>('foryou');

  /* ── Categorise ── */
  const catalysts = alerts
    .filter(a => a.type === 'red' || a.type === 'amber')
    .map(a => ({ ...a, geo: getGeoMeta(a.headline) }))
    .sort((a, b) => b.ts - a.ts);

  const cryptoNews = alerts
    .filter(a => a.type === 'purple')
    .sort((a, b) => b.ts - a.ts);

  /* Extra geo events not already in alerts */
  const geoAlertKeys = new Set(catalysts.map(c => c.headline.slice(0, 50)));
  const extraGeo = geoEvents.filter(g => !geoAlertKeys.has(g.headline.slice(0, 50)));

  /* "For You" shows catalysts first; falls back to latest crypto if no catalysts */
  const hasHighImpact = catalysts.length > 0 || whaleAlerts.length > 0 || extraGeo.length > 0;
  const foryouFallback = !hasHighImpact && cryptoNews.length > 0;

  const tabContent: Record<Exclude<Tab, 'events'>, typeof alerts> = {
    foryou:  hasHighImpact ? catalysts : cryptoNews.slice(0, 15),
    all:     [...alerts].sort((a, b) => b.ts - a.ts),
    geo:     alerts.filter(a => a.type === 'red').sort((a, b) => b.ts - a.ts),
    crypto:  cryptoNews,
  };

  const hasBadge = (t: Tab) => {
    if (t === 'foryou') return (catalysts.length + whaleAlerts.length) > 0;
    return false;
  };

  const isEmpty = tab !== 'events' && tab !== 'foryou' && tabContent[tab as Exclude<Tab,'events'>].length === 0;
  const foryouEmpty = tab === 'foryou' && !hasHighImpact && cryptoNews.length === 0;

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 2, letterSpacing: '-0.3px' }}>
          News
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 12 }}>
          Live feed · Finnhub REST + WS + CryptoPanic
          <span style={{
            marginLeft: 8, fontWeight: 700,
            color: alerts.length > 0 ? 'var(--green)' : 'var(--txt3)',
          }}>
            · {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
          </span>
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
            {hasBadge(t.id) && (
              <span className="ntab-count">{catalysts.length + whaleAlerts.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── For You tab ── */}
      {tab === 'foryou' && (
        <div className="nfeed">
          {/* Fallback notice */}
          {foryouFallback && (
            <div style={{
              padding: '8px 12px', borderRadius: 10, marginBottom: 8,
              background: 'var(--bg2)', border: '0.5px solid var(--bdr)',
              fontSize: 11, color: 'var(--txt3)', lineHeight: 1.5,
            }}>
              📡 No breaking catalysts right now — showing latest crypto news
            </div>
          )}

          {/* Empty state */}
          {foryouEmpty && (
            <div className="nfeed-empty">
              <div style={{ fontSize: 28, marginBottom: 10 }}>📡</div>
              <div style={{ fontSize: 14, color: 'var(--txt2)', fontWeight: 600, marginBottom: 4 }}>
                Scanning for catalysts…
              </div>
              <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
                High-impact news + whale trades will appear here
              </div>
              <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 12, opacity: 0.7 }}>
                Sources: Finnhub · CryptoPanic · Whale detector
              </div>
            </div>
          )}

          {/* 🐋 Whale alerts */}
          {whaleAlerts.slice(0, 8).map((w) => {
            const isBuy = w.side === 'BUY';
            const col   = isBuy ? 'var(--green)' : 'var(--red)';
            const bg    = isBuy ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)';
            const bdr   = isBuy ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)';
            return (
              <div key={w.id} className="ncard ncard-catalyst ncard-whale"
                style={{ borderTopColor: col }}>
                <div className="ncard-top">
                  <span className="ncard-type-badge" style={{ color: col }}>
                    {w.symbol} Whale {isBuy ? 'BUY' : 'SELL'}
                  </span>
                  <span className="ncard-meta">{timeAgo(w.ts)}</span>
                </div>
                <div className="ncard-headline" style={{ color: col }}>
                  {fmtUSD(w.usdValue)} {isBuy ? 'bought' : 'sold'} at ${w.price.toLocaleString()}
                  <span style={{ color: 'var(--txt3)', fontSize: 11, marginLeft: 6 }}>
                    ({w.qty.toFixed(3)} {w.symbol})
                  </span>
                </div>
                <div className="ncard-impact">
                  <span className="ncard-impact-text">
                    {isBuy
                      ? 'Large aggressive buy — institutional accumulation signal. Watch for follow-through momentum.'
                      : 'Large aggressive sell — institutional distribution. Could signal incoming sell pressure.'}
                  </span>
                </div>
                <button className="ncard-ask-btn" onClick={() =>
                  window.dispatchEvent(new CustomEvent('grok-chat', {
                    detail: { coin: w.symbol.toLowerCase() as 'btc' | 'eth', prompt: `A whale just ${isBuy ? 'bought' : 'sold'} ${fmtUSD(w.usdValue)} of ${w.symbol} at $${w.price.toLocaleString()}. What does this mean for the next 1-4 hours?` },
                  }))
                }>Ask Grok →</button>
              </div>
            );
          })}

          {/* Catalysts / fallback crypto */}
          {tabContent.foryou.map(a => {
            const cfg = TYPE_STYLE[a.type];
            const geo = getGeoMeta(a.headline);
            return (
              <div key={a.id} className="ncard ncard-catalyst"
                style={{ borderTopColor: cfg.dot }}>
                <div className="ncard-top">
                  <span className="ncard-type-badge" style={{ color: cfg.dot }}>
                    {geo ? geo.tag : cfg.label}
                  </span>
                  <span className="ncard-meta">{a.source} · {timeAgo(a.ts)}</span>
                </div>
                <div className="ncard-headline">{a.headline}</div>
                {geo && (
                  <div className="ncard-impact">
                    <span className="ncard-impact-text">{geo.note}</span>
                  </div>
                )}
                <button className="ncard-ask-btn" onClick={() => askGrok(a.headline)}>Ask Grok →</button>
              </div>
            );
          })}

          {/* Extra geo events (not in alerts) */}
          {extraGeo.map((g, i) => (
            <div key={i} className="ncard ncard-catalyst"
              style={{ borderTopColor: '#a78bfa' }}>
              <div className="ncard-top">
                <span className="ncard-type-badge" style={{ color: '#a78bfa' }}>
                  {g.tag}
                </span>
                <span className="ncard-meta">{g.source} · {g.timeStr}</span>
              </div>
              <div className="ncard-headline">{g.headline}</div>
              <div className="ncard-impact">
                <span className="ncard-impact-text">{g.note}</span>
              </div>
              <button className="ncard-ask-btn" onClick={() => askGrok(g.headline)}>Ask Grok →</button>
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
              <div style={{ fontSize: 13, color: 'var(--txt3)' }}>
                {tab === 'geo'    ? 'No war/conflict alerts yet'
                : tab === 'crypto' ? 'No crypto news yet'
                : 'Fetching news — Finnhub + CryptoPanic loading…'}
              </div>
            </div>
          )}
          {tabContent[tab as Exclude<Tab,'events'>].map(a => {
            const cfg = TYPE_STYLE[a.type];
            const geo = getGeoMeta(a.headline);
            return (
              <div key={a.id} className="ncard ncard-catalyst" style={{ borderTopColor: cfg.dot }}>
                <div className="ncard-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="ncard-type-badge" style={{ color: cfg.dot }}>
                      {cfg.label}
                    </span>
                    {geo && <span className="ncard-geo-tag">{geo.tag}</span>}
                  </div>
                  <span className="ncard-meta">{a.source} · {timeAgo(a.ts)}</span>
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
              <div style={{ fontSize: 13, color: 'var(--txt3)' }}>
                No upcoming high-impact events in the next 60 days
              </div>
            </div>
          )}
          {econEvents.map((e, i) => {
            const note = ECON_NOTES[e.type];
            const urgent = e.h < 2;
            const soon   = e.h < 24;
            return (
              <div key={i} className={`ncard${urgent || soon ? ' ncard-catalyst' : ''}`}
                style={urgent || soon ? { borderTopColor: '#fbbf24' } : {}}>
                <div className="ncard-top">
                  <span className="ncard-type-badge" style={{
                    color: urgent ? '#fbbf24' : soon ? '#fbbf24' : 'var(--txt3)',
                  }}>
                    {e.type}
                  </span>
                  <span className="ncard-meta" style={{
                    color: urgent ? 'var(--amber)' : soon ? 'var(--amber)' : 'var(--txt3)',
                  }}>
                    {e.h < 0.5 ? '🔴 NOW'
                    : e.h < 2   ? `⚠ ${Math.round(e.h * 60)}m away`
                    : e.h < 24  ? `${Math.round(e.h)}h away`
                    : e.dateStr}
                  </span>
                </div>
                <div className="ncard-headline">{e.name}</div>
                {note && (
                  <div className="ncard-impact">
                    <span className="ncard-impact-text">{note}</span>
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 8, textAlign: 'center' }}>
            Source: Finnhub Economic Calendar — high-impact events only
          </div>
        </div>
      )}
    </div>
  );
}
