'use client';
import { useState } from 'react';
import { useNews } from '@/components/NewsProvider';
import { GEO_KEYWORDS, ECON_NOTES } from '@/lib/classify';

type Tab = 'foryou' | 'breaking' | 'all' | 'geo' | 'crypto' | 'events';

const TABS: { id: Tab; label: string }[] = [
  { id: 'foryou',   label: 'For You'   },
  { id: 'breaking', label: 'Breaking'  },
  { id: 'all',      label: 'All'       },
  { id: 'geo',      label: 'War & Geo' },
  { id: 'crypto',   label: 'Crypto'    },
  { id: 'events',   label: 'Events'    },
];

/* ── Decode HTML entities in headlines (&#39; → ' etc.) ── */
function decodeEntities(str: string): string {
  return str
    .replace(/&#8216;|&#8217;|&lsquo;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&#38;|&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, c => {
      const n = parseInt(c.slice(2, -1), 10);
      return isNaN(n) ? c : String.fromCharCode(n);
    });
}

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

/* ── Source color map ── */
const SOURCE_COLORS: Record<string, string> = {
  'Reuters':          '#f59e0b',
  'Reuters World':    '#f59e0b',
  'Reuters Business': '#f59e0b',
  'AP News':          '#60a5fa',
  'AP Business':      '#60a5fa',
  'BBC World':        '#e11d48',
  'BBC Business':     '#e11d48',
  'CoinDesk':         '#a78bfa',
  'CoinTelegraph':    '#34d399',
  'Decrypt':          '#fb923c',
  'The Block':        '#38bdf8',
  'CryptoSlate':      '#818cf8',
  'Bitcoin Magazine': '#fbbf24',
  'Finnhub':          '#94a3b8',
};

/* ── Card type config ── */
const TYPE_CFG = {
  red:    { dot: '#f87171', label: 'Breaking', accentBg: 'rgba(248,113,113,0.08)'  },
  amber:  { dot: '#fbbf24', label: 'Macro',    accentBg: 'rgba(251,191,36,0.07)'  },
  purple: { dot: '#a78bfa', label: 'Crypto',   accentBg: 'rgba(167,139,250,0.07)' },
};

/* ── Market impact chip — first 6 words of note ── */
function ImpactChip({ note, color }: { note: string; color: string }) {
  // derive a very short label: first 5 words
  const short = note.split(' ').slice(0, 7).join(' ').replace(/—.*/, '').trim();
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 20,
      background: `${color}18`, border: `0.5px solid ${color}44`,
      fontSize: 10, color, fontWeight: 600, letterSpacing: '.02em',
      lineHeight: 1.6, whiteSpace: 'nowrap',
      maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {short}
    </span>
  );
}

/* ── Source pill ── */
function SourcePill({ source }: { source: string }) {
  const col = SOURCE_COLORS[source] ?? 'var(--txt3)';
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
      color: col, textTransform: 'uppercase', opacity: 0.9,
    }}>{source}</span>
  );
}

type AlertItem = ReturnType<typeof useNews>['alerts'][0];

/* ────────────────────────────────────────────────
   HERO CARD — top breaking story, full width, image
──────────────────────────────────────────────── */
function HeroCard({ a }: { a: AlertItem }) {
  const cfg   = TYPE_CFG[a.type];
  const geo   = getGeoMeta(a.headline);
  const label = geo ? geo.tag : cfg.label;
  const note  = geo?.note ?? null;

  return (
    <div
      className="ncard-hero"
      style={{ borderColor: cfg.dot }}
      onClick={() => a.link && window.open(a.link, '_blank', 'noopener')}
    >
      {/* Image strip */}
      {a.image && (
        <div className="ncard-hero-img-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={a.image}
            alt=""
            className="ncard-hero-img"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
          />
          <div className="ncard-hero-img-fade" />
        </div>
      )}

      <div className="ncard-hero-body">
        <div className="ncard-hero-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="ncard-type-badge" style={{ color: cfg.dot, fontSize: 11 }}>
              {label}
            </span>
            <SourcePill source={a.source} />
            {note && <ImpactChip note={note} color={cfg.dot} />}
          </div>
          <span className="ncard-meta">{timeAgo(a.ts)}</span>
        </div>

        <div className="ncard-hero-headline">
          {decodeEntities(a.headline)}
        </div>

        <div className="ncard-hero-actions">
          <button className="ncard-ask-btn" style={{ fontSize: 12 }} onClick={e => { e.stopPropagation(); askGrok(a.headline); }}>
            Ask LiquidityAI →
          </button>
          {a.link && (
            <a href={a.link} target="_blank" rel="noopener noreferrer" className="ncard-read-btn"
              style={{ fontSize: 12 }} onClick={e => e.stopPropagation()}>
              Read more ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   STANDARD NEWS CARD — with optional thumbnail
──────────────────────────────────────────────── */
function NewsCard({ a, hero = false }: { a: AlertItem & { geo?: { tag: string; note: string } | null }; hero?: boolean }) {
  if (hero) return <HeroCard a={a} />;

  const cfg   = TYPE_CFG[a.type];
  const geo   = getGeoMeta(a.headline);
  const label = geo ? geo.tag : cfg.label;
  const note  = geo?.note ?? null;
  const hasImg = !!a.image;

  return (
    <div
      className="ncard ncard-v2"
      style={{ borderLeftColor: cfg.dot, cursor: a.link ? 'pointer' : 'default' }}
      onClick={() => a.link && window.open(a.link, '_blank', 'noopener')}
    >
      <div className="ncard-v2-inner">
        {/* Text column */}
        <div className="ncard-v2-text">
          <div className="ncard-v2-top">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span className="ncard-type-badge" style={{ color: cfg.dot }}>{label}</span>
              <SourcePill source={a.source} />
            </div>
            <span className="ncard-meta">{timeAgo(a.ts)}</span>
          </div>

          <div className="ncard-v2-headline">{decodeEntities(a.headline)}</div>

          {note && (
            <div style={{ marginBottom: 8 }}>
              <ImpactChip note={note} color={cfg.dot} />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
            <button className="ncard-ask-btn" style={{ margin: 0 }} onClick={() => askGrok(a.headline)}>
              Ask LiquidityAI →
            </button>
            {a.link && (
              <a href={a.link} target="_blank" rel="noopener noreferrer" className="ncard-read-btn">
                Read more ↗
              </a>
            )}
          </div>
        </div>

        {/* Thumbnail */}
        {hasImg && (
          <div className="ncard-v2-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.image}
              alt=""
              className="ncard-v2-thumb-img"
              onError={e => { (e.target as HTMLImageElement).closest('.ncard-v2-thumb')?.remove(); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   PAGE
──────────────────────────────────────────────── */
export default function NewsPage() {
  const { alerts, geoEvents, econEvents, whaleAlerts, alertsLoaded } = useNews();
  const [tab, setTab] = useState<Tab>('foryou');

  /* ── Categorise ── */
  const breaking = alerts
    .filter(a => a.type === 'red')
    .sort((a, b) => b.ts - a.ts);

  const catalysts = alerts
    .filter(a => a.type === 'red' || a.type === 'amber')
    .map(a => ({ ...a, geo: getGeoMeta(a.headline) }))
    .sort((a, b) => b.ts - a.ts);

  const cryptoNews = alerts
    .filter(a => a.type === 'purple')
    .sort((a, b) => b.ts - a.ts);

  const geoAlertKeys = new Set(catalysts.map(c => c.headline.slice(0, 50)));
  const extraGeo = geoEvents.filter(g => !geoAlertKeys.has(g.headline.slice(0, 50)));

  const hasHighImpact = catalysts.length > 0 || whaleAlerts.length > 0 || extraGeo.length > 0;
  const foryouFallback = !hasHighImpact && cryptoNews.length > 0;

  const tabContent: Record<Exclude<Tab, 'events' | 'breaking'>, typeof alerts> = {
    foryou:  hasHighImpact ? catalysts : cryptoNews.slice(0, 15),
    all:     [...alerts].sort((a, b) => b.ts - a.ts),
    geo:     alerts.filter(a => a.type === 'red').sort((a, b) => b.ts - a.ts),
    crypto:  cryptoNews,
  };

  const hasBadge = (t: Tab) => {
    if (t === 'foryou')   return (catalysts.length + whaleAlerts.length) > 0;
    if (t === 'breaking') return breaking.length > 0;
    return false;
  };

  const isEmpty = (tab !== 'events' && tab !== 'foryou' && tab !== 'breaking') &&
    tabContent[tab as Exclude<Tab,'events'|'breaking'>].length === 0;
  const foryouEmpty = tab === 'foryou' && !hasHighImpact && cryptoNews.length === 0;

  /* ── Render a feed with optional hero treatment for first card ── */
  function Feed({ items, showHero = false }: { items: typeof alerts; showHero?: boolean }) {
    return (
      <div className="nfeed">
        {items.map((a, i) => (
          <NewsCard key={a.id} a={a} hero={showHero && i === 0} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 2, letterSpacing: '-0.3px' }}>
          News
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 12 }}>
          Reuters · AP · BBC · CoinDesk · CoinTelegraph · Decrypt · The Block · Finnhub
          <span style={{ marginLeft: 8, fontWeight: 700, color: alerts.length > 0 ? 'var(--green)' : 'var(--txt3)' }}>
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
              <span className="ntab-count">
                {t.id === 'breaking' ? breaking.length : catalysts.length + whaleAlerts.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Breaking ── */}
      {tab === 'breaking' && (
        <div className="nfeed">
          {breaking.length === 0 ? (
            <div className="nfeed-empty">
              <div style={{ fontSize: 28, marginBottom: 10 }}>📡</div>
              <div style={{ fontSize: 14, color: 'var(--txt2)', fontWeight: 600, marginBottom: 4 }}>No breaking news</div>
              <div style={{ fontSize: 12, color: 'var(--txt3)' }}>War · blockades · sanctions · crashes will appear here</div>
            </div>
          ) : (
            breaking.map((a, i) => <NewsCard key={a.id} a={a} hero={i === 0} />)
          )}
        </div>
      )}

      {/* ── For You ── */}
      {tab === 'foryou' && (
        <div className="nfeed">
          {foryouFallback && (
            <div style={{
              padding: '8px 12px', borderRadius: 10, marginBottom: 8,
              background: 'var(--bg2)', border: '0.5px solid var(--bdr)',
              fontSize: 11, color: 'var(--txt3)', lineHeight: 1.5,
            }}>
              No breaking catalysts right now — showing latest crypto news
            </div>
          )}

          {!alertsLoaded && alerts.length === 0 && (
            <div className="nfeed-empty">
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 12 }}>
                {[0,1,2].map(i => (
                  <span key={i} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--txt3)', animation: `pulse 1.4s ${i * 0.2}s infinite` }} />
                ))}
              </div>
              <div style={{ fontSize: 13, color: 'var(--txt2)', fontWeight: 600, marginBottom: 4 }}>Loading feeds…</div>
              <div style={{ fontSize: 11, color: 'var(--txt3)' }}>Reuters · AP · BBC · CoinDesk · CoinTelegraph · Decrypt · The Block</div>
            </div>
          )}

          {foryouEmpty && alertsLoaded && (
            <div className="nfeed-empty">
              <div style={{ fontSize: 28, marginBottom: 10 }}>📡</div>
              <div style={{ fontSize: 14, color: 'var(--txt2)', fontWeight: 600, marginBottom: 4 }}>Scanning for catalysts…</div>
              <div style={{ fontSize: 12, color: 'var(--txt3)' }}>High-impact news + whale trades will appear here</div>
              <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 12, opacity: 0.7 }}>
                Reuters · AP · BBC · CoinDesk · CoinTelegraph · Decrypt · The Block · Finnhub
              </div>
            </div>
          )}

          {/* Whale alerts */}
          {whaleAlerts.slice(0, 8).map((w) => {
            const isBuy = w.side === 'BUY';
            const col   = isBuy ? 'var(--green)' : 'var(--red)';
            return (
              <div key={w.id} className="ncard ncard-v2 ncard-whale" style={{ borderLeftColor: col }}>
                <div className="ncard-v2-inner">
                  <div className="ncard-v2-text">
                    <div className="ncard-v2-top">
                      <span className="ncard-type-badge" style={{ color: col }}>
                        🐋 {w.symbol} Whale {isBuy ? 'BUY' : 'SELL'}
                      </span>
                      <span className="ncard-meta">{timeAgo(w.ts)}</span>
                    </div>
                    <div className="ncard-v2-headline" style={{ color: col, fontSize: 15 }}>
                      {fmtUSD(w.usdValue)} {isBuy ? 'bought' : 'sold'} at ${w.price.toLocaleString()}
                      <span style={{ color: 'var(--txt3)', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>
                        ({w.qty.toFixed(3)} {w.symbol})
                      </span>
                    </div>
                    <ImpactChip
                      note={isBuy ? 'Institutional accumulation — watch follow-through' : 'Distribution signal — sell pressure incoming'}
                      color={col}
                    />
                    <div style={{ marginTop: 8 }}>
                      <button className="ncard-ask-btn" style={{ margin: 0 }} onClick={() =>
                        window.dispatchEvent(new CustomEvent('grok-chat', {
                          detail: { coin: w.symbol.toLowerCase() as 'btc' | 'eth', prompt: `A whale just ${isBuy ? 'bought' : 'sold'} ${fmtUSD(w.usdValue)} of ${w.symbol} at $${w.price.toLocaleString()}. What does this mean for the next 1-4 hours?` },
                        }))
                      }>Ask LiquidityAI →</button>
                    </div>
                  </div>
                  {/* Whale icon block instead of image */}
                  <div className="ncard-v2-whale-icon" style={{ color: col }}>
                    {isBuy ? '↑' : '↓'}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Catalysts / fallback crypto — first card is hero */}
          {tabContent.foryou.map((a, i) => <NewsCard key={a.id} a={a} hero={i === 0 && whaleAlerts.length === 0} />)}

          {/* Extra geo events */}
          {extraGeo.map((g, i) => (
            <div key={i} className="ncard ncard-v2" style={{ borderLeftColor: '#a78bfa' }}>
              <div className="ncard-v2-inner">
                <div className="ncard-v2-text">
                  <div className="ncard-v2-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="ncard-type-badge" style={{ color: '#a78bfa' }}>{g.tag}</span>
                      <SourcePill source={g.source} />
                    </div>
                    <span className="ncard-meta">{g.timeStr}</span>
                  </div>
                  <div className="ncard-v2-headline">{decodeEntities(g.headline)}</div>
                  <ImpactChip note={g.note} color="#a78bfa" />
                  <div style={{ marginTop: 8 }}>
                    <button className="ncard-ask-btn" style={{ margin: 0 }} onClick={() => askGrok(g.headline)}>Ask LiquidityAI →</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── All / Geo / Crypto ── */}
      {(tab === 'all' || tab === 'geo' || tab === 'crypto') && (
        <div className="nfeed">
          {isEmpty && (
            <div className="nfeed-empty">
              <div style={{ fontSize: 24, marginBottom: 8 }}>📭</div>
              <div style={{ fontSize: 13, color: 'var(--txt3)' }}>
                {tab === 'geo'     ? 'No war/conflict alerts yet'
                : tab === 'crypto' ? 'No crypto news yet'
                : 'Fetching news — feeds loading…'}
              </div>
            </div>
          )}
          {tabContent[tab as Exclude<Tab,'events'|'breaking'>].map((a, i) => (
            <NewsCard key={a.id} a={a} hero={i === 0} />
          ))}
        </div>
      )}

      {/* ── Events ── */}
      {tab === 'events' && (
        <div className="nfeed">
          {econEvents.length === 0 && (
            <div className="nfeed-empty">
              <div style={{ fontSize: 13, color: 'var(--txt3)' }}>No upcoming high-impact events in the next 60 days</div>
            </div>
          )}
          {econEvents.map((e, i) => {
            const note   = ECON_NOTES[e.type];
            const urgent = e.h < 2;
            const soon   = e.h < 24;
            const accentColor = urgent ? '#f87171' : soon ? '#fbbf24' : 'var(--purple)';
            return (
              <div key={i} className="ncard ncard-v2" style={{ borderLeftColor: accentColor }}>
                <div className="ncard-v2-inner">
                  <div className="ncard-v2-text">
                    <div className="ncard-v2-top">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="ncard-type-badge" style={{ color: accentColor }}>{e.type}</span>
                        <span style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 10,
                          background: urgent ? 'rgba(248,113,113,0.12)' : soon ? 'rgba(251,191,36,0.10)' : 'var(--bg2)',
                          color: urgent || soon ? accentColor : 'var(--txt3)',
                          fontWeight: 600, border: `0.5px solid ${accentColor}44`,
                        }}>
                          {e.impact} impact
                        </span>
                      </div>
                      <span className="ncard-meta" style={{ color: urgent ? 'var(--red)' : soon ? 'var(--amber)' : 'var(--txt3)' }}>
                        {e.h < 0.5 ? '🔴 NOW'
                        : e.h < 2   ? `⚡ ${Math.round(e.h * 60)}m away`
                        : e.h < 24  ? `${Math.round(e.h)}h away`
                        : e.dateStr}
                      </span>
                    </div>
                    <div className="ncard-v2-headline">{decodeEntities(e.name)}</div>
                    {note && <ImpactChip note={note} color={accentColor} />}
                  </div>
                </div>
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
