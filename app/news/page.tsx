'use client';
import { useDesignMode } from '@/components/DesignModeProvider';
import { useState } from 'react';
import { useNews } from '@/components/NewsProvider';
import { GEO_KEYWORDS, ECON_NOTES, getCoinsInHeadline } from '@/lib/classify';
import { withAlpha } from '@/lib/color';
import LoadingState from '@/components/LoadingState';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

type Tab = 'foryou' | 'breaking' | 'all' | 'geo' | 'crypto' | 'events';

const TABS: { id: Tab; labelKey: LabelKey }[] = [
  { id: 'foryou',   labelKey: 'NEWS_TAB_FORYOU'   },
  { id: 'breaking', labelKey: 'NEWS_TAB_BREAKING'  },
  { id: 'all',      labelKey: 'NEWS_TAB_ALL'       },
  { id: 'geo',      labelKey: 'NEWS_TAB_GEO' },
  { id: 'crypto',   labelKey: 'NEWS_TAB_CRYPTO'    },
  { id: 'events',   labelKey: 'NEWS_TAB_EVENTS'  },
];

/* ── Decode HTML entities in headlines (&#39; → ' etc.) ── */
function decodeEntities(str: string): string {
  return str
    .replace(/&#8216;|&#8217;|&lsquo;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '-')
    .replace(/&#38;|&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, c => {
      const n = parseInt(c.slice(2, -1), 10);
      return isNaN(n) ? c : String.fromCharCode(n);
    });
}

type TFn = (key: LabelKey, vars?: Record<string, string | number>) => string;

function timeAgo(ts: number, t: TFn): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60)    return t('NEWS_TIME_JUST_NOW');
  if (s < 3600)  return t('NEWS_TIME_MINUTES_AGO', { n: Math.floor(s / 60) });
  if (s < 86400) return t('NEWS_TIME_HOURS_AGO', { n: Math.floor(s / 3600) });
  return t('NEWS_TIME_DAYS_AGO', { n: Math.floor(s / 86400) });
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

function askGrok(headline: string, t: TFn) {
  window.dispatchEvent(new CustomEvent('grok-chat', {
    detail: {
      coin: 'btc',
      prompt: t('NEWS_ASK_GROK_PROMPT', { headline }),
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
  const { t } = useLabels();
  const s = getBtcSentiment(headline);
  // Neutral is the default for most non-crypto headlines - rendering a grey
  // "Neutral" pill on the majority of cards is pure noise, so only surface a
  // sentiment badge when there's an actual directional read.
  if (s === 'neutral') return null;
  const coins = getCoinsInHeadline(headline);
  const prefix = coins.length === 1 ? `${coins[0]}: ` : '';
  const cfg = s === 'bullish'
    ? { bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.3)',   color: 'var(--green-2)', label: t('NEWS_SENTIMENT_BULLISH', { prefix }) }
    : { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)',  color: 'var(--red)', label: t('NEWS_SENTIMENT_BEARISH', { prefix }) };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 7px', borderRadius: 20,
      background: cfg.bg, border: `0.5px solid ${cfg.border}`,
      fontSize: 'var(--fs-caption)', color: cfg.color, fontWeight: 700,
      letterSpacing: '.02em', lineHeight: 1.6, whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

/* ── Coin Buzz Bar - summary of coin mentions across all alerts ── */
function CoinBuzzBar({ mentions }: { mentions: { symbol: string; total: number; bullish: number; bearish: number }[] }) {
  const { t } = useLabels();
  if (mentions.length < 2) return null;
  return (
    <div className="hscroll-fade-outer">
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '8px 0 10px', overflowX: 'auto', scrollbarWidth: 'none',
    }}>
      <span style={{
        fontSize: 'var(--fs-micro)', color: 'var(--txt3)', fontWeight: 600,
        letterSpacing: '.05em', textTransform: 'uppercase', flexShrink: 0,
      }}>
        {t('NEWS_COIN_BUZZ_LABEL')}
      </span>
      {mentions.map(m => {
        const pctBull = m.total > 0 ? m.bullish / m.total : 0;
        const pctBear = m.total > 0 ? m.bearish / m.total : 0;
        const sentiment = pctBull >= 0.55 ? 'bull' : pctBear >= 0.55 ? 'bear' : 'mix';
        const col = sentiment === 'bull' ? 'var(--green-2)' : sentiment === 'bear' ? 'var(--red)' : 'var(--txt-dim)';
        const arrow = sentiment === 'bull' ? ' ↗' : sentiment === 'bear' ? ' ↘' : '';
        return (
          <span key={m.symbol} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '3px 8px', borderRadius: 20,
            background: withAlpha(col, '14'), border: `0.5px solid ${withAlpha(col, '44')}`,
            fontSize: 'var(--fs-caption)', color: col, fontWeight: 700,
            letterSpacing: '.03em', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {m.symbol}
            <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, fontSize: '0.625rem' }}>·</span>
            <span style={{ fontWeight: 500, fontSize: 'var(--fs-caption)' }}>{m.total}{arrow}</span>
          </span>
        );
      })}
    </div>
    <div className="hscroll-fade" />
    </div>
  );
}

/* ── Source color map ── */
const SOURCE_COLORS: Record<string, string> = {
  'Reuters':          '#f59e0b',
  'Reuters World':    '#f59e0b',
  'Reuters Business': '#f59e0b',
  'AP News':          'var(--accent-2)',
  'AP Business':      'var(--accent-2)',
  'BBC World':        '#e11d48',
  'BBC Business':     '#e11d48',
  'CoinDesk':         '#1a7aff',
  'CoinTelegraph':    'var(--green-2)',
  'Decrypt':          'var(--orange)',
  'The Block':        '#38bdf8',
  'CryptoSlate':      '#818cf8',
  'Bitcoin Magazine': 'var(--amber)',
  'Finnhub':          'var(--txt-dim)',
};

/* ── Card type config ── */
const TYPE_CFG: Record<'red' | 'amber' | 'purple', { dot: string; labelKey: LabelKey; accentBg: string }> = {
  red:    { dot: 'var(--red)', labelKey: 'NEWS_TYPE_BADGE_BREAKING', accentBg: 'rgba(248,113,113,0.08)'  },
  amber:  { dot: 'var(--amber)', labelKey: 'NEWS_TYPE_BADGE_MACRO',    accentBg: 'rgba(251,191,36,0.07)'  },
  purple: { dot: '#1a7aff', labelKey: 'NEWS_TYPE_BADGE_CRYPTO',   accentBg: 'rgba(26,122,255,0.07)' },
};

/* ── Market impact chip - first 6 words of note ── */
function ImpactChip({ note, color }: { note: string; color: string }) {
  // derive a very short label: first 5 words
  const short = note.split(' ').slice(0, 7).join(' ').replace(/-.*/, '').trim();
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 7px', borderRadius: 20,
      background: withAlpha(color, '18'), border: `0.5px solid ${withAlpha(color, '44')}`,
      fontSize: 'var(--fs-caption)', color, fontWeight: 600, letterSpacing: '.02em',
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
      fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.04em',
      color: col, textTransform: 'uppercase', opacity: 0.9,
    }}>{source}</span>
  );
}

type AlertItem = ReturnType<typeof useNews>['alerts'][0];

/* ────────────────────────────────────────────────
   HERO CARD - first story, spans all 3 columns
──────────────────────────────────────────────── */
function HeroCard({ a }: { a: AlertItem }) {
  const { t } = useLabels();
  const cfg   = TYPE_CFG[a.type];
  const geo   = getGeoMeta(a.headline);
  const label = geo ? geo.tag : t(cfg.labelKey);
  const title = decodeEntities(a.headline);

  return (
    <article className="ncard-grid ncard-grid-hero">
      {/* Same treatment as the grid card below (#398). The hero spans
          `grid-column: 1 / -1`, so a missing image cannot leave a side gap -
          but the destructive onError was NOT cosmetic here: a 404 deleted a
          300px block after first paint, shifting the whole feed under the
          largest card on the page. */}
      <div className="ncard-grid-img-wrap">
        {a.image && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={a.image} alt="" className="ncard-grid-img"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        )}
      </div>
      <div className="ncard-grid-body">
        <div className="ncard-grid-top">
          <div className="ncard-tags">
            <span className="ncard-type-badge" style={{ color: cfg.dot }}>{label}</span>
            <SourcePill source={a.source} />
            <SentimentBadge headline={a.headline} />
          </div>
          <span className="ncard-meta">{timeAgo(a.ts, t)}</span>
        </div>
        <h2 className="ncard-grid-headline">
          {a.link
            ? <a className="ncard-headline-link" href={a.link} target="_blank" rel="noopener noreferrer">{title}</a>
            : title}
        </h2>
        <div className="ncard-grid-actions">
          <button className="ncard-ask-btn" onClick={() => askGrok(a.headline, t)}>
            <span className="ncard-ask-spark" aria-hidden>✦</span> {t('NEWS_ASK_AI_BUTTON')}
          </button>
          {a.link && (
            <a className="ncard-open-btn" href={a.link} target="_blank" rel="noopener noreferrer">
              {t('NEWS_READ_ARTICLE_LINK')}
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

/* ────────────────────────────────────────────────
   GRID NEWS CARD - one cell in the 3-col grid
──────────────────────────────────────────────── */
function NewsCard({ a, hero = false }: { a: AlertItem & { geo?: { tag: string; note: string } | null }; hero?: boolean }) {
  const { t } = useLabels();
  if (hero) return <HeroCard a={a} />;

  const cfg    = TYPE_CFG[a.type];
  const geo    = getGeoMeta(a.headline);
  const label  = geo ? geo.tag : t(cfg.labelKey);
  const hasImg = !!a.image;
  const title  = decodeEntities(a.headline);

  return (
    <article className="ncard-grid">
      {/* EVERY card gets this block, image or not (#398).
          The grid rows size to their tallest card and `align-items: start`
          stops the short ones stretching, so a text-only card left a 172px
          hole beside its neighbours. A flat tile is deliberately not a stock
          icon - the same generic image repeated down a feed reads as broken,
          where an empty tile reads as designed. */}
      <div className="ncard-grid-img-wrap">
        {hasImg && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={a.image} alt="" className="ncard-grid-img"
            onError={e => {
              /* Hide the broken image and fall back to the tile UNDERNEATH it,
                 rather than removing the wrapper. Deleting it turned a card
                 into a text card after first paint, which produced the same
                 gap the owner reported plus a layout shift as the row
                 reflowed - and it happened to cards whose `image` URL was
                 present, so it looked unrelated to the missing-image case. */
              (e.target as HTMLImageElement).style.display = 'none';
            }} />
        )}
      </div>
      <div className="ncard-grid-body">
        <div className="ncard-grid-top">
          <div className="ncard-tags">
            <span className="ncard-type-badge" style={{ color: cfg.dot }}>{label}</span>
            <SourcePill source={a.source} />
            <SentimentBadge headline={a.headline} />
          </div>
          <span className="ncard-meta">{timeAgo(a.ts, t)}</span>
        </div>
        <h3 className="ncard-grid-headline">
          {a.link
            ? <a className="ncard-headline-link" href={a.link} target="_blank" rel="noopener noreferrer">{title}</a>
            : title}
        </h3>
        <div className="ncard-grid-actions">
          <button className="ncard-ask-btn" onClick={() => askGrok(a.headline, t)}>
            <span className="ncard-ask-spark" aria-hidden>✦</span> {t('NEWS_ASK_AI_BUTTON')}
          </button>
          {a.link && (
            <a className="ncard-open-btn" href={a.link} target="_blank" rel="noopener noreferrer">
              {t('NEWS_READ_ARTICLE_LINK')}
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

/* ────────────────────────────────────────────────
   PAGE
──────────────────────────────────────────────── */
export default function NewsPage() {
  const mode = useDesignMode();
  const { t } = useLabels();
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
    // War & Geo: actually geo-classified headlines (war/conflict/sanctions/etc)
    // via getGeoMeta - previously this was `type === 'red'`, identical to the
    // Breaking tab, so the two tabs showed the exact same list.
    geo:     alerts.filter(a => getGeoMeta(a.headline) !== null).sort((a, b) => b.ts - a.ts),
    crypto:  cryptoNews,
  };

  const hasBadge = (tabId: Tab) => {
    if (tabId === 'foryou')   return (catalysts.length + whaleAlerts.length) > 0;
    if (tabId === 'breaking') return breaking.length > 0;
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
    <div className={mode === 'terminal' ? 'news-term-wrap' : undefined}>
      {/* ── Header ── */}
      <div style={{ padding: '1rem 0 0.5rem' }}>
        <h1 style={{ fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2, letterSpacing: '-0.3px' }}>
          {t('NEWS_PAGE_TITLE')}
        </h1>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginBottom: 12 }}>
          {t('NEWS_SOURCE_LIST')}
          <span style={{ marginLeft: 8, fontWeight: 700, color: alerts.length > 0 ? 'var(--green)' : 'var(--txt3)' }}>
            · {t('NEWS_ALERT_COUNT', { count: alerts.length, s: alerts.length !== 1 ? 's' : '' })}
          </span>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="hscroll-fade-outer">
        <div className="ntab-bar">
          {TABS.map(tabItem => (
            <button
              key={tabItem.id}
              className={`ntab-btn${tab === tabItem.id ? ' on' : ''}`}
              onClick={() => setTab(tabItem.id)}
            >
              {t(tabItem.labelKey)}
              {hasBadge(tabItem.id) && (
                <span className="ntab-count">
                  {tabItem.id === 'breaking' ? breaking.length : catalysts.length + whaleAlerts.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="hscroll-fade" />
      </div>

      {/* ── Coin buzz summary ── */}
      {tab !== 'events' && <CoinBuzzBar mentions={coinMentions} />}

      {/* ── Breaking ── */}
      {tab === 'breaking' && (
        <div className="nfeed">
          {breaking.length === 0 ? (
            <div className="nfeed-empty">

              <div style={{ fontSize: 'var(--fs-body)', color: 'var(--txt2)', fontWeight: 600, marginBottom: 4 }}>{t('NEWS_BREAKING_EMPTY_TITLE')}</div>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('NEWS_BREAKING_EMPTY_BODY')}</div>
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
              fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.5,
            }}>
              {t('NEWS_FORYOU_FALLBACK_BANNER')}
            </div>
          )}

          {!alertsLoaded && alerts.length === 0 && (
            <LoadingState message={t('NEWS_LOADING_FEEDS')} />
          )}

          {foryouEmpty && alertsLoaded && (
            <div className="nfeed-empty">

              <div style={{ fontSize: 'var(--fs-body)', color: 'var(--txt2)', fontWeight: 600, marginBottom: 4 }}>{t('NEWS_FORYOU_EMPTY_TITLE')}</div>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('NEWS_FORYOU_EMPTY_BODY')}</div>
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 12, opacity: 0.7 }}>
                {t('NEWS_SOURCE_LIST')}
              </div>
            </div>
          )}

          {/* Whale alerts */}
          {whaleAlerts.slice(0, 8).map((w) => {
            const isBuy = w.side === 'BUY';
            const col   = isBuy ? 'var(--green)' : 'var(--red)';
            return (
              <article key={w.id} className="ncard-grid">
                {/* Whale alerts share the .nfeed grid with article cards, so
                    without this block they were ~172px shorter and left the
                    same hole the owner reported (#398). They have no image by
                    nature - the tile is the point, not a fallback. */}
                <div className="ncard-grid-img-wrap" />
                <div className="ncard-grid-body">
                  <div className="ncard-grid-top">
                    <span className="ncard-type-badge" style={{ color: col }}>
                      {t('NEWS_WHALE_BADGE', { arrow: isBuy ? '↑' : '↓', symbol: w.symbol, side: isBuy ? t('NEWS_WHALE_SIDE_BUY') : t('NEWS_WHALE_SIDE_SELL') })}
                    </span>
                    <span className="ncard-meta">{timeAgo(w.ts, t)}</span>
                  </div>
                  <h3 className="ncard-grid-headline" style={{ color: col }}>
                    {t('NEWS_WHALE_HEADLINE', { usd: fmtUSD(w.usdValue), action: isBuy ? t('NEWS_WHALE_BOUGHT') : t('NEWS_WHALE_SOLD'), price: w.price.toLocaleString() })}
                    <span style={{ color: 'var(--txt3)', fontSize: 'var(--fs-caption)', fontWeight: 400, marginLeft: 6 }}>
                      ({w.qty.toFixed(3)} {w.symbol})
                    </span>
                  </h3>
                  <div className="ncard-grid-actions">
                    <ImpactChip
                      note={isBuy ? t('NEWS_WHALE_NOTE_BUY') : t('NEWS_WHALE_NOTE_SELL')}
                      color={col}
                    />
                    <button className="ncard-ask-btn" onClick={() =>
                      window.dispatchEvent(new CustomEvent('grok-chat', {
                        detail: { coin: w.symbol.toLowerCase() as 'btc' | 'eth', prompt: t('NEWS_WHALE_ASK_PROMPT', { action: isBuy ? t('NEWS_WHALE_BOUGHT') : t('NEWS_WHALE_SOLD'), usd: fmtUSD(w.usdValue), symbol: w.symbol, price: w.price.toLocaleString() }) },
                      }))
                    }><span className="ncard-ask-spark" aria-hidden>✦</span> {t('NEWS_ASK_AI_BUTTON')}</button>
                  </div>
                </div>
              </article>
            );
          })}

          {/* Catalysts / fallback crypto - first card is hero */}
          {tabContent.foryou.map((a, i) => <NewsCard key={a.id} a={a} hero={i === 0 && whaleAlerts.length === 0} />)}

          {/* Extra geo events */}
          {extraGeo.map((g, i) => (
            <article key={i} className="ncard-grid">
              {/* Same as the whale cards above - siblings in the same grid. */}
              <div className="ncard-grid-img-wrap" />
              <div className="ncard-grid-body">
                <div className="ncard-grid-top">
                  <div className="ncard-tags">
                    <span className="ncard-type-badge" style={{ color: 'var(--accent)' }}>{g.tag}</span>
                    <SourcePill source={g.source} />
                  </div>
                  <span className="ncard-meta">{g.timeStr}</span>
                </div>
                <h3 className="ncard-grid-headline">{decodeEntities(g.headline)}</h3>
                <div className="ncard-grid-actions">
                  <ImpactChip note={g.note} color="var(--accent)" />
                  <button className="ncard-ask-btn" onClick={() => askGrok(g.headline, t)}><span className="ncard-ask-spark" aria-hidden>✦</span> {t('NEWS_ASK_AI_BUTTON')}</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ── All / Geo / Crypto ── */}
      {(tab === 'all' || tab === 'geo' || tab === 'crypto') && (
        <div className="nfeed">
          {isEmpty && (
            <div className="nfeed-empty">
              {tab === 'geo' ? (
                <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)' }}>{t('NEWS_GEO_EMPTY')}</div>
              ) : tab === 'crypto' ? (
                <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)' }}>{t('NEWS_CRYPTO_EMPTY')}</div>
              ) : (
                <>
                  <SkeletonBar width={210} height={15} style={{ margin: '0 auto' }} />
                  <span className="sr-only">{t('NEWS_ALL_LOADING_SR')}</span>
                </>
              )}
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
              <div style={{ fontSize: 'var(--fs-label)', color: 'var(--txt3)' }}>{t('NEWS_EVENTS_EMPTY')}</div>
            </div>
          )}
          {(() => {
            // Group events by the VIEWER'S own calendar date. This used to force
            // 'en-PH' + Asia/Manila, so a trader in New York saw every release at
            // Manila's clock AND filed under Manila's date - an 8:30 AM ET print
            // showed as 9:30 PM and landed under the *next* day's heading, with
            // "TODAY" pointing at the wrong group. Passing undefined as the locale
            // also lets the date format follow the viewer, not the Philippines.
            const groups: { dateLabel: string; isToday: boolean; events: typeof econEvents }[] = [];
            const dateFmt: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            const todayLocal = new Date().toLocaleDateString(undefined, dateFmt);
            econEvents.forEach(e => {
              const label = e.dt.toLocaleDateString(undefined, dateFmt);
              const last = groups[groups.length - 1];
              if (last && last.dateLabel === label) { last.events.push(e); }
              else groups.push({ dateLabel: label, isToday: label === todayLocal, events: [e] });
            });
            return groups.map((g, gi) => (
              <div key={gi} style={{ marginBottom: 20 }}>
                {/* Date header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 8px',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 'var(--fs-label)', fontWeight: 700, color: g.isToday ? 'var(--amber)' : 'var(--txt)' }}>
                    {g.isToday ? t('NEWS_EVENTS_TODAY_PREFIX', { date: g.dateLabel }) : g.dateLabel}
                  </span>
                  {g.isToday && <span style={{ fontSize: 'var(--fs-caption)', padding: '1px 6px', borderRadius: 8, background: 'rgba(251,191,36,0.12)', color: 'var(--amber)', fontWeight: 600 }}>{t('NEWS_EVENTS_LIVE_BADGE')}</span>}
                </div>
                <div style={{ overflowX: 'auto' }}>
                {/* Column headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 72px 72px 72px 52px', gap: 4, padding: '4px 8px', fontSize: 'var(--fs-caption)', color: 'var(--txt3)', fontWeight: 600, letterSpacing: '0.04em', minWidth: 370 }}>
                  <span>{t('NEWS_EVENTS_COL_TIME')}</span><span>{t('NEWS_EVENTS_COL_EVENT')}</span><span style={{ textAlign: 'right' }}>{t('NEWS_EVENTS_COL_PREV')}</span><span style={{ textAlign: 'right' }}>{t('NEWS_EVENTS_COL_EST')}</span><span style={{ textAlign: 'right' }}>{t('NEWS_EVENTS_COL_ACTUAL')}</span><span style={{ textAlign: 'center' }}>{t('NEWS_EVENTS_COL_IMPACT')}</span>
                </div>
                {/* Rows */}
                {g.events.map((e, ei) => {
                  const urgent = e.h >= -0.5 && e.h < 2;
                  const soon = e.h < 24;
                  const past = e.h < 0;
                  const timeLocal = e.dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
                  const note = ECON_NOTES[e.type];
                  const borderColor = urgent ? 'var(--red)' : soon ? 'var(--amber)' : 'var(--purple)';
                  return (
                    <div key={ei} style={{
                      display: 'grid', gridTemplateColumns: '70px 1fr 72px 72px 72px 52px',
                      gap: 4, padding: '10px 8px', minWidth: 370,
                      borderLeft: `3px solid ${past && !urgent ? 'var(--border)' : borderColor}`,
                      borderBottom: '1px solid var(--border)',
                      opacity: past && !urgent ? 0.55 : 1,
                      alignItems: 'start',
                    }}>
                      <span style={{ fontSize: 'var(--fs-caption)', color: urgent ? 'var(--red)' : soon ? 'var(--amber)' : 'var(--txt2)', fontWeight: 600, paddingTop: 1 }}>
                        {urgent ? t('NEWS_EVENTS_NOW_BADGE') : timeLocal}
                      </span>
                      <div>
                        <div style={{ fontSize: 'var(--fs-label)', fontWeight: 600, color: 'var(--txt)', marginBottom: note ? 4 : 0 }}>{decodeEntities(e.name)}</div>
                        {note && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.4 }}>{note.split('.')[0]}.</div>}
                      </div>
                      <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', textAlign: 'right', paddingTop: 1 }}>{e.previous ?? '-'}</span>
                      <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', textAlign: 'right', paddingTop: 1 }}>{e.estimate ?? '-'}</span>
                      <span style={{ fontSize: 'var(--fs-caption)', fontWeight: e.actual ? 700 : 400, color: e.actual ? 'var(--green)' : 'var(--txt3)', textAlign: 'right', paddingTop: 1 }}>{e.actual ?? '-'}</span>
                      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 1 }}>
                        <span style={{ fontSize: 'var(--fs-caption)', padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: 'var(--red)', fontWeight: 700, letterSpacing: '0.03em' }}>{t('NEWS_EVENTS_IMPACT_HIGH')}</span>
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            ));
          })()}
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 4, textAlign: 'center' }}>
            {t('NEWS_EVENTS_FOOTER_NOTE')}
          </div>
        </div>
      )}
    </div>
  );
}
