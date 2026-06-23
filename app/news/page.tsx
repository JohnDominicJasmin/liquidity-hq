'use client';
import { useState } from 'react';
import { useNews } from '@/components/NewsProvider';
import { GEO_KEYWORDS, ECON_NOTES, getCoinsInHeadline } from '@/lib/classify';

type Tab = 'foryou' | 'breaking' | 'all' | 'geo' | 'crypto' | 'events';

const TABS: { id: Tab; label: string }[] = [
  { id: 'foryou',   label: 'For You'   },
  { id: 'breaking', label: 'Breaking'  },
  { id: 'all',      label: 'All'       },
  { id: 'geo',      label: 'War & Geo' },
  { id: 'crypto',   label: 'Crypto'    },
  { id: 'events',   label: 'Calendar'  },
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

/* ── BTC sentiment from headline keywords ── */
type BtcSentiment = 'bullish' | 'bearish' | 'neutral';

function getBtcSentiment(headline: string): BtcSentiment {
  const h = headline.toLowerCase();
  const bearishKw = [
    'crash','dump','plunge','collapse','decline','drop','fall','slump',
    'ban','banned','restriction','crackdown','sanction',
    'hack','exploit','theft','stolen','robbery','kidnapping','arrested',
    'controversy','flaw','underperform','suspicious','warning','risk',
    'tightening','rate hike','hawkish','inflation rise','pressured',
    'war','attack','conflict','missile','invasion','airstrike',
    'lawsuit','charges','seized','fraud','scam',
    'bearish','bear market','sell-off','liquidation wave','weakening',
  ];
  const bullishKw = [
    'rally','surge','pump','breakout','record','all-time high','ath',
    'buy','bought','purchase','accumulate','inflow','flows into','flowing into','returns to crypto',
    'etf approved','approval','approved','adoption','launch',
    'institutional','strategic reserve',
    'rate cut','dovish','easing',
    'saylor','microstrategy','blackrock buys','grayscale',
    'bullish','bull run','upside','relief rally',
    'super pac','crypto-friendly','pro-crypto','crypto pac',
  ];
  for (const kw of bearishKw) if (h.includes(kw)) return 'bearish';
  for (const kw of bullishKw) if (h.includes(kw)) return 'bullish';
  return 'neutral';
}

function SentimentBadge({ headline }: { headline: string }) {
  const s = getBtcSentiment(headline);
  const coins = getCoinsInHeadline(headline);
  const prefix = coins.length === 1 ? `${coins[0]}: ` : '';
  const cfg = s === 'bullish'
    ? { bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.3)',   color: '#34d399', label: `${prefix}Bullish ↗` }
    : s === 'bearish'
    ? { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)',  color: '#f87171', label: `${prefix}Bearish ↘` }
    : { bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)',  color: '#64748b', label: prefix ? `${prefix}Neutral` : 'Neutral' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 7px', borderRadius: 20,
      background: cfg.bg, border: `0.5px solid ${cfg.border}`,
      fontSize: 10, color: cfg.color, fontWeight: 700,
      letterSpacing: '.02em', lineHeight: 1.6, whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

/* ── Coin Buzz Bar — summary of coin mentions across all alerts ── */
function CoinBuzzBar({ mentions }: { mentions: { symbol: string; total: number; bullish: number; bearish: number }[] }) {
  if (mentions.length < 2) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '8px 0 10px', overflowX: 'auto', scrollbarWidth: 'none',
    }}>
      <span style={{
        fontSize: 10, color: 'var(--txt3)', fontWeight: 600,
        letterSpacing: '.05em', textTransform: 'uppercase', flexShrink: 0,
      }}>
        Coin buzz
      </span>
      {mentions.map(m => {
        const pctBull = m.total > 0 ? m.bullish / m.total : 0;
        const pctBear = m.total > 0 ? m.bearish / m.total : 0;
        const sentiment = pctBull >= 0.55 ? 'bull' : pctBear >= 0.55 ? 'bear' : 'mix';
        const col = sentiment === 'bull' ? '#34d399' : sentiment === 'bear' ? '#f87171' : '#94a3b8';
        const arrow = sentiment === 'bull' ? ' ↗' : sentiment === 'bear' ? ' ↘' : '';
        return (
          <span key={m.symbol} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '3px 8px', borderRadius: 20,
            background: `${col}14`, border: `0.5px solid ${col}44`,
            fontSize: 11, color: col, fontWeight: 700,
            letterSpacing: '.03em', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {m.symbol}
            <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, fontSize: 10 }}>·</span>
            <span style={{ fontWeight: 500, fontSize: 10 }}>{m.total}{arrow}</span>
          </span>
        );
      })}
    </div>
  );
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
   HERO CARD — first story, spans all 3 columns
──────────────────────────────────────────────── */
function HeroCard({ a }: { a: AlertItem }) {
  const cfg   = TYPE_CFG[a.type];
  const geo   = getGeoMeta(a.headline);
  const label = geo ? geo.tag : cfg.label;

  return (
    <div
      className="ncard-grid ncard-grid-hero"
      style={{ cursor: a.link ? 'pointer' : 'default' }}
      onClick={() => a.link && window.open(a.link, '_blank', 'noopener')}
    >
      {a.image ? (
        <div className="ncard-grid-img-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.image} alt="" className="ncard-grid-img"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
          <div className="ncard-grid-img-fade" />
        </div>
      ) : (
        <div className="ncard-grid-placeholder">
          <span style={{ fontSize: 44, opacity: 0.12, userSelect: 'none' }}>📰</span>
        </div>
      )}
      <div className="ncard-grid-body">
        <div className="ncard-grid-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="ncard-type-badge" style={{ color: cfg.dot }}>{label}</span>
            <SourcePill source={a.source} />
            <SentimentBadge headline={a.headline} />
          </div>
          <span className="ncard-meta">{timeAgo(a.ts)}</span>
        </div>
        <div className="ncard-grid-headline">{decodeEntities(a.headline)}</div>
        <div className="ncard-grid-actions" onClick={e => e.stopPropagation()}>
          <button className="ncard-ask-btn" style={{ margin: 0, fontSize: 12 }} onClick={() => askGrok(a.headline)}>
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
   GRID NEWS CARD — one cell in the 3-col grid
──────────────────────────────────────────────── */
function NewsCard({ a, hero = false }: { a: AlertItem & { geo?: { tag: string; note: string } | null }; hero?: boolean }) {
  if (hero) return <HeroCard a={a} />;

  const cfg    = TYPE_CFG[a.type];
  const geo    = getGeoMeta(a.headline);
  const label  = geo ? geo.tag : cfg.label;
  const hasImg = !!a.image;

  return (
    <div
      className="ncard-grid"
      style={{ cursor: a.link ? 'pointer' : 'default' }}
      onClick={() => a.link && window.open(a.link, '_blank', 'noopener')}
    >
      {hasImg ? (
        <div className="ncard-grid-img-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.image} alt="" className="ncard-grid-img"
            onError={e => { (e.target as HTMLImageElement).closest('.ncard-grid-img-wrap')?.remove(); }} />
          <div className="ncard-grid-img-fade" />
        </div>
      ) : (
        <div className="ncard-grid-placeholder">
          <span style={{ fontSize: 44, opacity: 0.12, userSelect: 'none' }}>📰</span>
        </div>
      )}
      <div className="ncard-grid-body">
        <div className="ncard-grid-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="ncard-type-badge" style={{ color: cfg.dot }}>{label}</span>
            <SourcePill source={a.source} />
            <SentimentBadge headline={a.headline} />
          </div>
          <span className="ncard-meta">{timeAgo(a.ts)}</span>
        </div>
        <div className="ncard-grid-headline">{decodeEntities(a.headline)}</div>
        <div className="ncard-grid-actions" onClick={e => e.stopPropagation()}>
          <button className="ncard-ask-btn" style={{ margin: 0, fontSize: 11 }} onClick={() => askGrok(a.headline)}>
            Ask LiquidityAI →
          </button>
          {a.link && (
            <a href={a.link} target="_blank" rel="noopener noreferrer" className="ncard-read-btn"
              style={{ fontSize: 11 }} onClick={e => e.stopPropagation()}>
              Read more ↗
            </a>
          )}
        </div>
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

  /* ── Coin mention tally ── */
  const coinMentions = (() => {
    const map: Record<string, { total: number; bullish: number; bearish: number }> = {};
    alerts.forEach(a => {
      const coins = getCoinsInHeadline(a.headline);
      const sent = getBtcSentiment(a.headline);
      coins.forEach(c => {
        if (!map[c]) map[c] = { total: 0, bullish: 0, bearish: 0 };
        map[c].total++;
        if (sent === 'bullish') map[c].bullish++;
        else if (sent === 'bearish') map[c].bearish++;
      });
    });
    return Object.entries(map)
      .map(([symbol, v]) => ({ symbol, ...v }))
      .sort((a, b) => b.total - a.total);
  })();

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

      {/* ── Coin buzz summary ── */}
      {tab !== 'events' && <CoinBuzzBar mentions={coinMentions} />}

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
              <div key={w.id} className="ncard-grid">
                <div className="ncard-grid-placeholder" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 30, color: col, fontWeight: 800, opacity: 0.8,
                }}>
                  {isBuy ? '↑' : '↓'}
                </div>
                <div className="ncard-grid-body">
                  <div className="ncard-grid-top">
                    <span className="ncard-type-badge" style={{ color: col }}>
                      🐋 {w.symbol} Whale {isBuy ? 'BUY' : 'SELL'}
                    </span>
                    <span className="ncard-meta">{timeAgo(w.ts)}</span>
                  </div>
                  <div className="ncard-grid-headline" style={{ color: col }}>
                    {fmtUSD(w.usdValue)} {isBuy ? 'bought' : 'sold'} at ${w.price.toLocaleString()}
                    <span style={{ color: 'var(--txt3)', fontSize: 11, fontWeight: 400, marginLeft: 6 }}>
                      ({w.qty.toFixed(3)} {w.symbol})
                    </span>
                  </div>
                  <div className="ncard-grid-actions">
                    <ImpactChip
                      note={isBuy ? 'Institutional accumulation — watch follow-through' : 'Distribution signal — sell pressure incoming'}
                      color={col}
                    />
                    <button className="ncard-ask-btn" style={{ margin: 0 }} onClick={() =>
                      window.dispatchEvent(new CustomEvent('grok-chat', {
                        detail: { coin: w.symbol.toLowerCase() as 'btc' | 'eth', prompt: `A whale just ${isBuy ? 'bought' : 'sold'} ${fmtUSD(w.usdValue)} of ${w.symbol} at $${w.price.toLocaleString()}. What does this mean for the next 1-4 hours?` },
                      }))
                    }>Ask LiquidityAI →</button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Catalysts / fallback crypto — first card is hero */}
          {tabContent.foryou.map((a, i) => <NewsCard key={a.id} a={a} hero={i === 0 && whaleAlerts.length === 0} />)}

          {/* Extra geo events */}
          {extraGeo.map((g, i) => (
            <div key={i} className="ncard-grid">
              <div className="ncard-grid-placeholder">
                <span style={{ fontSize: 44, opacity: 0.12, userSelect: 'none' }}>🌐</span>
              </div>
              <div className="ncard-grid-body">
                <div className="ncard-grid-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="ncard-type-badge" style={{ color: '#a78bfa' }}>{g.tag}</span>
                    <SourcePill source={g.source} />
                  </div>
                  <span className="ncard-meta">{g.timeStr}</span>
                </div>
                <div className="ncard-grid-headline">{decodeEntities(g.headline)}</div>
                <div className="ncard-grid-actions">
                  <ImpactChip note={g.note} color="#a78bfa" />
                  <button className="ncard-ask-btn" style={{ margin: 0 }} onClick={() => askGrok(g.headline)}>Ask LiquidityAI →</button>
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

      {/* ── Economic Calendar ── */}
      {tab === 'events' && (
        <div style={{ paddingBottom: 24 }}>
          {econEvents.length === 0 && (
            <div className="nfeed-empty">
              <div style={{ fontSize: 13, color: 'var(--txt3)' }}>No upcoming high-impact US events found</div>
            </div>
          )}
          {(() => {
            // Group events by PHT date string
            const groups: { dateLabel: string; isToday: boolean; events: typeof econEvents }[] = [];
            const todayPHT = new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            econEvents.forEach(e => {
              const label = e.dt.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
              const last = groups[groups.length - 1];
              if (last && last.dateLabel === label) { last.events.push(e); }
              else groups.push({ dateLabel: label, isToday: label === todayPHT, events: [e] });
            });
            return groups.map((g, gi) => (
              <div key={gi} style={{ marginBottom: 20 }}>
                {/* Date header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 8px',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: g.isToday ? 'var(--amber)' : 'var(--txt1)' }}>
                    {g.isToday ? `Today — ${g.dateLabel}` : g.dateLabel}
                  </span>
                  {g.isToday && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: 'rgba(251,191,36,0.12)', color: 'var(--amber)', fontWeight: 600 }}>LIVE</span>}
                </div>
                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 72px 72px 72px 52px', gap: 4, padding: '4px 8px', fontSize: 10, color: 'var(--txt3)', fontWeight: 600, letterSpacing: '0.04em' }}>
                  <span>TIME (PHT)</span><span>EVENT</span><span style={{ textAlign: 'right' }}>PREV</span><span style={{ textAlign: 'right' }}>EST</span><span style={{ textAlign: 'right' }}>ACTUAL</span><span style={{ textAlign: 'center' }}>IMPACT</span>
                </div>
                {/* Rows */}
                {g.events.map((e, ei) => {
                  const urgent = e.h >= -0.5 && e.h < 2;
                  const soon = e.h < 24;
                  const past = e.h < 0;
                  const timePHT = e.dt.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false });
                  const note = ECON_NOTES[e.type];
                  const borderColor = urgent ? '#f87171' : soon ? '#fbbf24' : 'var(--purple)';
                  return (
                    <div key={ei} style={{
                      display: 'grid', gridTemplateColumns: '70px 1fr 72px 72px 72px 52px',
                      gap: 4, padding: '10px 8px',
                      borderLeft: `3px solid ${past && !urgent ? 'var(--border)' : borderColor}`,
                      borderBottom: '1px solid var(--border)',
                      opacity: past && !urgent ? 0.55 : 1,
                      alignItems: 'start',
                    }}>
                      <span style={{ fontSize: 12, color: urgent ? '#f87171' : soon ? '#fbbf24' : 'var(--txt2)', fontWeight: 600, paddingTop: 1 }}>
                        {urgent ? '🔴 NOW' : timePHT}
                      </span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt1)', marginBottom: note ? 4 : 0 }}>{decodeEntities(e.name)}</div>
                        {note && <div style={{ fontSize: 11, color: 'var(--txt3)', lineHeight: 1.4 }}>{note.split('.')[0]}.</div>}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--txt2)', textAlign: 'right', paddingTop: 1 }}>{e.previous ?? '—'}</span>
                      <span style={{ fontSize: 12, color: 'var(--txt2)', textAlign: 'right', paddingTop: 1 }}>{e.estimate ?? '—'}</span>
                      <span style={{ fontSize: 12, fontWeight: e.actual ? 700 : 400, color: e.actual ? 'var(--green)' : 'var(--txt3)', textAlign: 'right', paddingTop: 1 }}>{e.actual ?? '—'}</span>
                      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 1 }}>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: '#f87171', fontWeight: 700, letterSpacing: '0.03em' }}>HIGH</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ));
          })()}
          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, textAlign: 'center' }}>
            High-impact US events · Finnhub when available · Fed calendar + computed schedule as fallback · Times in PHT
          </div>
        </div>
      )}
    </div>
  );
}
