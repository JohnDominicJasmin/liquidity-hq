'use client';
/* Monochrome Terminal rendering of the dashboard (Desk 2a, #413).
 *
 * Activated by useDesignMode() === 'terminal' in app/dashboard/page.tsx.
 * Mirrors Dashboard's data logic and component structure exactly; the only
 * differences are visual: no GlobalSpotlight, no mb-glow-card, border-radius
 * 0 on any inline style that sets one. CSS token overrides in globals.css
 * handle the class-level radii (--radius-card → 0, --radius-data → 0, plus
 * targeted rules for hardcoded px values like .edge-card and .scc-card). */

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useOnboarding } from '@/components/OnboardingProvider';
import {
  useMarket, COINS, COIN_DEC, fmtPrice,
  computeCoinHealth, classifyFunding, computeSqueezeScore, FUNDING_TIP_KEY,
} from '@/lib/marketStore';
import type { CoinId, CoinData } from '@/lib/marketStore';
import { useOI1h, oi1hSignal } from '@/lib/useOI1h';
import { useSettings } from '@/lib/settings';
import { computeMarketRead, computeContrarian } from '@/lib/marketRead';
import GlobalMacroContext from '@/components/GlobalMacroContext';
import EconCalendarWidget from '@/components/EconCalendarWidget';
import SpotlightTour from '@/components/SpotlightTour';
import SetupChecklist from '@/components/SetupChecklist';
import Tip from '@/components/Tip';
import { coinBadgeColor } from '@/lib/coinBadge';
import { withAlpha } from '@/lib/color';
import Sparkline24h from '@/components/Sparkline24h';
import CoinIcon from '@/components/CoinIcon';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import PerpSpotCard from '@/components/PerpSpotCard';

const SPARK_W = 36;

/* "14 Aug 11:42 UTC" - the canvas eyebrow's stamp. UTC, not local: every
 * other time-derived value on this route (session windows, day-of-week
 * scoring in computeMarketRead) is anchored to UTC, and a local stamp beside
 * a UTC-derived read would disagree either side of the viewer's midnight. */
function formatUtcStamp(d: Date, locale?: string): string {
  const day   = d.getUTCDate();
  // The app's own selected locale, not the browser's: the label beside this
  // stamp resolves through t(), so passing undefined here spliced a
  // navigator.language month into an otherwise app-locale line.
  const month = d.toLocaleString(locale, { month: 'short', timeZone: 'UTC' });
  const hh    = String(d.getUTCHours()).padStart(2, '0');
  const mm    = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${hh}:${mm} UTC`;
}

/* Market read banner - Dashboard 2a.dc.html's first main-column panel (#587).
 *
 * This slot used to render <MarketRead />, the production conditions gauge
 * (58/100 bar + Order Wall / Fear & Greed / Day / Funding / Smart Money
 * boxes + a funding override control). None of that is in the canvas or in
 * specs/dashboard-2a.md: the frame draws one eyebrow line, one 24px verdict
 * string, one sentence. The gauge stayed because this branch restyled the
 * existing component rather than checking what the canvas wanted in the
 * position - the owner caught it by comparing the live page to the frame.
 *
 * Same computeMarketRead() the gauge used, so the words are the production
 * read, not a second opinion - only the presentation changes here.
 *
 * COLOUR, and the one place this deliberately departs from criterion 5:
 * the spec asks the verdict to take the READ'S DIRECTION (bullish --green /
 * bearish --red / neutral --txt2), and the canvas fixture shows a
 * directional string ("RISK-ON, CAUTIOUS"). computeMarketRead does not
 * produce a direction - its band is trade-CONDITIONS QUALITY (good / mid /
 * weak, "Good time to trade" ... "Weak setup - better to wait"), and no
 * market-wide directional read exists anywhere in the codebase (confluence
 * and Grok are both per-coin). Painting "weak conditions" --red would tell
 * the reader the market is falling when it means the setup is poor - the
 * exact substitution §"Colour is data" forbids. So the band maps on its own
 * axis: favourable --green, everything else quiet. Flagged for design on
 * #587 - either this mapping is confirmed, or a market-wide directional
 * read is a data question to answer before the colour can mean direction. */
function TMarketReadBanner() {
  const { t, locale } = useLabels();
  const { store } = useMarket();
  const [tick, setTick] = useState(0);

  // Re-derive every 60s so the stamp and the time-of-day factor inside
  // computeMarketRead stay current without a reload - same cadence the
  // gauge used.
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const coin = store.coins[store.selectedCoin];

  /* Memoised on the same inputs computeMarketRead actually reads. useMarket()
     is a context, so without this the whole read - wallProximity's reduce over
     the wall arrays, computeSmartMoney, computeContrarian - re-ran on every
     websocket price tick, tens of times a second, for a string that changes
     once a minute. `tick` is a dependency on purpose: it is what makes the
     time-of-day and day-of-week factors re-derive on the 60s interval. */
  const read = useMemo(
    () => computeMarketRead(store),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.fng, store.selectedCoin, store.cbPremiumPct, store.btcExchangeNetFlow, coin, tick],
  );

  const verdictCol = read.band === 'good' ? 'var(--green)' : 'var(--txt2)';

  /* No market data yet - render the band's shape without its conclusion.
     computeMarketRead has no "unknown" state: with an empty store it still
     scores time-of-day and day-of-week, lands around 40, and returns "Weak
     setup - better to wait" - a confident market call derived from no market
     data, in the largest text on the route. The gauge this replaced at least
     showed a 0/100 track and five blank factor cells beside that string;
     the banner shows only the conclusion, so it needs the guard the gauge
     did not. Same SkeletonBar every other card in this file falls back to. */
  const hasData = coin?.price != null;

  return (
    <section className="dash-market-read-banner" aria-label={t('MARKET_READ_TITLE')}>
      <div className="dmrb-eyebrow">
        <Tip width={280} text={t('MARKET_READ_TIP')}>{t('MARKET_READ_TITLE')}</Tip>
        {hasData && <span suppressHydrationWarning> · {formatUtcStamp(new Date(), locale)}</span>}
      </div>
      {hasData ? (
        <>
          <h2 className="dmrb-verdict" style={{ color: verdictCol }}>{read.verdict}</h2>
          <div className="dmrb-sub">{read.sub}</div>
        </>
      ) : (
        <>
          <div className="dmrb-verdict"><SkeletonBar width={260} height={24} radius={0} /></div>
          <div className="dmrb-sub"><SkeletonBar width={420} height={12} radius={0} /></div>
        </>
      )}
    </section>
  );
}

const OI_TREND_META: Record<string, { txtKey: LabelKey; subKey: LabelKey; col: string }> = {
  strong_up:   { txtKey: 'OI_TREND_STRONG_UP_TXT',   subKey: 'OI_TREND_STRONG_UP_SUB',   col: 'var(--green)' },
  strong_down: { txtKey: 'OI_TREND_STRONG_DOWN_TXT', subKey: 'OI_TREND_STRONG_DOWN_SUB', col: 'var(--red)' },
  weak_up:     { txtKey: 'OI_TREND_WEAK_UP_TXT',     subKey: 'OI_TREND_WEAK_UP_SUB',     col: 'var(--amber)' },
  weak_down:   { txtKey: 'OI_TREND_WEAK_DOWN_TXT',   subKey: 'OI_TREND_WEAK_DOWN_SUB',   col: 'var(--txt3)' },
};

const SIDEBAR_DEFAULT = 7;

interface VolRegimeState { regime: 'low' | 'neutral' | 'high'; percentile: number }

/* Shared by the pulse strip's VOL chip and the market-conditions Volatility
 * bar (#413 canvas mirror). Was reading parsed.data?.btc?.label -
 * VolatilityRegime.tsx (the only writer of this key) has never written that
 * shape. It writes {ts, btcData, ethData} where btcData is {hv30,
 * percentile, regime}, no "data"/"btc"/"label" path anywhere - so the VOL
 * chip has never populated in production, on either design. Fixed to read
 * the shape that actually gets written; the same pre-existing bug also
 * lives in app/dashboard/page.tsx's non-terminal copy of this effect, out
 * of scope for this branch, flagged separately. */
function useBtcVolRegime(): VolRegimeState | null {
  const [state, setState] = useState<VolRegimeState | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('lhq_vol_regime');
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; btcData?: VolRegimeState };
        if (Date.now() - parsed.ts < 4 * 60 * 60 * 1000 && parsed.btcData?.regime != null) {
          setState(parsed.btcData);
        }
      }
    } catch {}
  }, []);
  return state;
}

function TMarketPulseStrip() {
  const { store } = useMarket();
  const { t } = useLabels();
  const vol = useBtcVolRegime();
  const volRegime = vol?.regime ?? null;

  const dom = store.btcDom;
  const alt = store.altSeasonScore;

  // --green/--red, not -soft (#546 C9 - see the fuller note at sqCol below).
  const altColor = alt == null ? 'var(--txt3)'
    : alt >= 75 ? 'var(--green)'
    : alt >= 50 ? 'var(--green)'
    : alt >= 25 ? 'var(--red)'
    : 'var(--red)';

  const volLabelKey: LabelKey | null = volRegime === 'low' ? 'VOLATILITY_REGIME_LABEL_LOW'
    : volRegime === 'high' ? 'VOLATILITY_REGIME_LABEL_HIGH'
    : volRegime === 'neutral' ? 'VOLATILITY_REGIME_LABEL_NEUTRAL'
    : null;
  const volColor = volRegime === 'low' ? 'var(--green)'
    : volRegime === 'high' ? 'var(--red)'
    : 'var(--txt2)';

  const domNote = dom == null ? '' : dom >= 60 ? t('DASH_PULSE_NOTE_BTC_LEADS') : dom >= 55 ? t('DASH_PULSE_NOTE_ELEVATED') : dom >= 48 ? t('DASH_PULSE_NOTE_NORMAL') : t('DASH_PULSE_NOTE_ALT_SEASON');
  const altNote = alt == null ? '' : alt >= 75 ? t('DASH_PULSE_NOTE_ALT_SEASON') : alt >= 50 ? t('DASH_PULSE_NOTE_LEAN_ALTS') : alt >= 25 ? t('DASH_PULSE_NOTE_BTC_LEADS') : t('DASH_PULSE_NOTE_BTC_SEASON');

  type Chip = { label: string; value: string; note: string; color: string };
  const chips: Chip[] = [
    { label: t('DASH_PULSE_BTC_DOM_LABEL'), value: dom != null ? dom.toFixed(1) + '%' : '-', note: domNote, color: 'var(--txt)' },
    { label: t('DASH_PULSE_ALT_LABEL'), value: alt != null ? String(alt) : '-', note: altNote, color: altColor },
    ...(volLabelKey ? [{ label: t('DASH_PULSE_VOL_LABEL'), value: t(volLabelKey), note: t('DASH_PULSE_VOL_NOTE'), color: volColor }] : []),
  ];

  return (
    <div style={{
      background: 'var(--bg1)',
      border: '1px solid var(--bdr)',
      borderRadius: 0,
      padding: '10px 12px',
      display: 'grid',
      gridTemplateColumns: `repeat(${chips.length}, 1fr)`,
      gap: 2,
    }}>
      {chips.map(chip => (
        <div key={chip.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase', fontFamily: 'var(--font-mono), monospace' }}>
            {chip.label}
          </div>
          <div style={{ fontSize: 'var(--fs-data)', fontWeight: 800, color: chip.color, fontFamily: 'var(--font-mono), monospace', lineHeight: 1 }}>
            {chip.value}
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.2 }}>
            {chip.note}
          </div>
        </div>
      ))}
    </div>
  );
}

type SidebarSignal = { text: string; col: string } | null;

/* Priority cascade for the sidebar's one-signal-per-coin tag. Pulled out of
 * TCoinSidebar's row renderer so the rail header's "N FIRING" count (#413
 * canvas mirror) can run the same cascade over ALL coins, not just the
 * visible slice, without duplicating the seven branches. */
function sidebarSignalFor(d: CoinData | undefined, t: (key: LabelKey) => string): SidebarSignal {
  let sig: SidebarSignal = null;
  if (d?.fundingRate != null) {
          const fr = d.fundingRate * 100;
          if (fr >= 0.04)       sig = { text: t('DASH_SIDEBAR_SIG_LONGS_OVERCROWDED'), col: 'var(--red)' };
          else if (fr <= -0.02) sig = { text: t('DASH_SIDEBAR_SIG_SHORTS_SQUEEZED'),   col: 'var(--green)' };
        }
        if (!sig && d?.cvdDivergence === 'bullish') sig = { text: t('DASH_SIDEBAR_SIG_SMART_BUYERS'), col: 'var(--green)' };
        if (!sig && d?.cvdDivergence === 'bearish') sig = { text: t('DASH_SIDEBAR_SIG_SMART_SELLERS'), col: 'var(--red)' };
        if (!sig && d?.oiTrend === 'strong_up')     sig = { text: t('DASH_SIDEBAR_SIG_NEW_BUYERS'),  col: 'var(--green)' };
        if (!sig && d?.oiTrend === 'strong_down')   sig = { text: t('DASH_SIDEBAR_SIG_NEW_SELLERS'), col: 'var(--red)' };
        if (!sig && d?.chartPattern) {
          const isBull = /bull|higher high|engulf.*bull|hammer(?! man)|double bot/i.test(d.chartPattern);
          const isBear = /bear|lower high|engulf.*bear|shooting|double top/i.test(d.chartPattern);
          const label  = d.chartPattern.split(';')[0].split('(')[0].trim();
          if (isBull)       sig = { text: label, col: 'var(--green)' };
          else if (isBear)  sig = { text: label, col: 'var(--red)' };
          else if (label)   sig = { text: label, col: 'var(--txt3)' };
        }
        if (!sig && d?.oiTrend === 'weak_up')   sig = { text: t('DASH_SIDEBAR_SIG_SHORTS_CLOSING'),   col: 'var(--amber)' };
        if (!sig && d?.oiTrend === 'weak_down')  sig = { text: t('DASH_SIDEBAR_SIG_BUYERS_PROFIT'),   col: 'var(--txt3)' };
        if (!sig && d?.fundingRate != null && d.fundingRate !== 0) {
          const fr = d.fundingRate * 100;
          if      (fr >= 0.05)   sig = { text: t('DASH_SIDEBAR_SIG_FUNDING_VERY_HIGH'),     col: 'var(--red)' };
          else if (fr >= 0.01)   sig = { text: t('DASH_SIDEBAR_SIG_FUNDING_SLIGHTLY_HIGH'), col: 'var(--red)' };
          else if (fr <= -0.03)  sig = { text: t('DASH_SIDEBAR_SIG_FUNDING_VERY_LOW'),      col: 'var(--green)' };
          else if (fr <= -0.005) sig = { text: t('DASH_SIDEBAR_SIG_FUNDING_SLIGHTLY_LOW'),  col: 'var(--green)' };
          else                   sig = { text: t('DASH_SIDEBAR_SIG_FUNDING_NEUTRAL'),        col: 'var(--txt3)' };
  }
  return sig;
}

function TCoinSidebar() {
  const { store, selectCoin } = useMarket();
  const { t } = useLabels();
  const { settings } = useSettings();
  const watchlist = settings.watchlist ?? [];
  const pinned = watchlist.filter((id): id is CoinId => (COINS as string[]).includes(id));
  const rest    = COINS.filter(id => !watchlist.includes(id));
  const visibleCoins = [...pinned, ...rest].slice(0, SIDEBAR_DEFAULT);
  const firingCount = COINS.filter(cid => sidebarSignalFor(store.coins[cid], t) !== null).length;

  return (
    <>
      <div style={{
        height: 28, flexShrink: 0, display: 'flex', alignItems: 'center',
        padding: '0 14px', gap: 10, borderBottom: '1px solid var(--bdr)',
        fontFamily: 'var(--font-mono), monospace', fontSize: 10,
      }}>
        <span style={{ fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--txt2)' }}>
          {t('DASH_SIDEBAR_HEADER_TITLE')}
        </span>
        <span style={{ color: 'var(--txt3)', textTransform: 'uppercase' }}>
          {t('DASH_SIDEBAR_HEADER_FIRING', { count: firingCount })}
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/markets" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
          {t('DASH_SIDEBAR_HEADER_VIEW_ALL', { count: COINS.length })}
        </Link>
      </div>
      <div className="csb2-container">
      {visibleCoins.map(id => {
        const d      = store.coins[id];
        const dec    = COIN_DEC[id];
        const chg    = d?.change ?? 0;
        const up     = chg >= 0;
        const sel    = store.selectedCoin === id;
        const tbp    = d?.takerBuyRatio != null ? Math.round(d.takerBuyRatio * 100) : 50;
        const health = computeCoinHealth(d);
        const badgeCol = coinBadgeColor(id);
        const sig    = sidebarSignalFor(d, t);

        const barCol = tbp >= 60 ? 'var(--green)' : tbp <= 40 ? 'var(--red)' : 'var(--txt3)';

        return (
          <div
            key={id}
            className={`csb2-card${sel ? ' csb2-sel' : ''}`}
            onClick={() => selectCoin(id)}
          >
            <div className="csb2-top">
              <CoinIcon coin={id} size={16} color={badgeCol} bg={withAlpha(badgeCol, '24')} />
              <span className="csb2-name">{id.toUpperCase()}</span>
              {d?.price && (
                <span className={`csb2-health-badge grade-${health.grade.toLowerCase()}`} style={{
                  fontSize: 'var(--fs-caption)', fontWeight: 800, lineHeight: 1,
                  padding: '2px 4px', borderRadius: 0,
                  // Grade F's own colour is --txt3 - text painted in the same
                  // token as its own tint reads 4.11:1 in dark by construction
                  // (the self-tint pattern design ruled on for PerpSpotCard).
                  // Left unset here so the .grade-f CSS rule below can set it
                  // to --txt without needing !important to beat this inline
                  // style, the way the light-only fix at globals.css had to.
                  ...(health.grade !== 'F' && { color: health.color }),
                  background: withAlpha(health.color, '22'),
                  border: `1px solid var(--bdr)`,
                  letterSpacing: '.04em', flexShrink: 0,
                }}>
                  {health.grade}
                </span>
              )}
              <span className="csb2-price">
                {d?.price ? '$' + fmtPrice(d.price, dec) : '-'}
              </span>
            </div>

            <div className="csb2-bottom" style={{ '--csb2-spark-w': `${SPARK_W}px` } as React.CSSProperties}>
              <span className={`csb2-chg ${up ? 'chg-up' : 'chg-dn'}`}>
                {up ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%
              </span>
              <Sparkline24h coin={id} width={SPARK_W} height={14} />
              {sig && (
                <span className="csb2-sig" style={{ color: sig.col }}>
                  {sig.text}
                </span>
              )}
            </div>

            <div className="csb2-bar-track">
              <div className="csb2-bar-fill" style={{ width: tbp + '%', background: barCol }} />
            </div>
          </div>
        );
      })}

      <Link
        href="/markets"
        style={{
          display: 'block', width: '100%', background: 'none', border: 'none',
          borderTop: '1px solid var(--bdr)', padding: '7px 0',
          fontSize: 'var(--fs-caption)', color: 'var(--txt3)', cursor: 'pointer',
          letterSpacing: '0.04em', textAlign: 'center', textDecoration: 'none',
          textTransform: 'uppercase',
        }}
      >
        {t('DASH_SIDEBAR_MORE_COINS', { count: COINS.length - SIDEBAR_DEFAULT })}
      </Link>
      </div>
    </>
  );
}

function TCascadeAlertBanner() {
  const { store, setStore } = useMarket();
  const { t } = useLabels();
  const alert = store.cascadeAlert;

  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(() => setStore(s => ({ ...s, cascadeAlert: null })), 3 * 60_000);
    return () => clearTimeout(timer);
  }, [alert?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alert) return null;

  const usdStr = alert.totalUsd >= 1e6
    ? `$${(alert.totalUsd / 1e6).toFixed(1)}M`
    : `$${(alert.totalUsd / 1e3).toFixed(0)}K`;
  const label = alert.side === 'LONG' ? t('DASH_CASCADE_LABEL_LONG')
              : alert.side === 'SHORT' ? t('DASH_CASCADE_LABEL_SHORT')
              : t('DASH_CASCADE_LABEL_NEUTRAL');
  const hint = alert.side === 'LONG'  ? t('DASH_CASCADE_HINT_LONG')
             : alert.side === 'SHORT' ? t('DASH_CASCADE_HINT_SHORT')
             : t('DASH_CASCADE_HINT_NEUTRAL');
  const col = alert.side === 'LONG' ? 'var(--red)'
            : alert.side === 'SHORT' ? 'var(--green)'
            : 'var(--amber)';
  const bdr = alert.side === 'LONG' ? 'rgba(248,113,113,0.35)'
            : alert.side === 'SHORT' ? 'rgba(52,211,153,0.35)'
            : 'rgba(251,191,36,0.35)';

  return (
    <div className="cascade-alert" style={{ borderColor: bdr }}>
      <div className="cascade-dot" style={{ background: col }} />
      <div className="cascade-body">
        <div className="cascade-title" style={{ color: col }}>
          {t('DASH_CASCADE_TITLE', { coin: alert.coin, label })}
        </div>
        <div className="cascade-sub">{t('DASH_CASCADE_SUB', { usd: usdStr, hint })}</div>
      </div>
      <button
        className="cascade-dismiss"
        style={{ textTransform: 'uppercase', letterSpacing: '.1em', fontSize: 10 }}
        onClick={() => setStore(s => ({ ...s, cascadeAlert: null }))}
      >{t('DASH_CASCADE_DISMISS')} ✕</button>
    </div>
  );
}

/* Contrarian crowd warning (#606). computeContrarian fires at 2-of-3 crowd
 * extremes and the old <MarketRead /> surfaced it as .mr-flag; when the
 * terminal dashboard moved to TMarketReadBanner (#587) the value was still
 * computed and then discarded, so a real risk-facing string disappeared from
 * the route with nothing else showing it.
 *
 * Reuses TCascadeAlertBanner's .cascade-alert pattern rather than inventing
 * geometry the canvas doesn't draw: same conditional/dismissible/colour-coded
 * shape, same slot above the main column, and the two never both fire on the
 * same input (one reads liquidation cascades, the other crowd positioning).
 *
 * Colour follows the cascade banner's own semantics - the direction that is
 * BAD for the reader is red. Longs overcrowded is flush risk (--red); shorts
 * overcrowded is squeeze risk against shorts, which favours a long (--green).
 *
 * label/desc are English literals from lib/marketRead.ts, not label keys -
 * they predate this component and are shared with the current design's
 * MarketRead. Rendering them as-is rather than forking the strings; the i18n
 * gap is marketRead.ts's and is the same one TMarketReadBanner's verdict has. */
function TContrarianBanner() {
  const { store } = useMarket();
  const { t } = useLabels();
  const c = computeContrarian(store);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Identity, not a boolean: dismissing "Longs overcrowded 2/3" should not
  // also suppress a later escalation to 3/3, or a flip to the other side.
  const id = c ? `${c.dir}-${c.count}` : null;
  if (!c || dismissed === id) return null;

  const col = c.dir === 'bear' ? 'var(--red)' : 'var(--green)';
  const bdr = c.dir === 'bear' ? 'rgba(248,113,113,0.35)' : 'rgba(52,211,153,0.35)';

  return (
    <div className="cascade-alert" style={{ borderColor: bdr }}>
      <div className="cascade-dot" style={{ background: col }} />
      <div className="cascade-body">
        <div className="cascade-title" style={{ color: col }}>
          {c.label} · {c.count}/3
        </div>
        <div className="cascade-sub">{c.desc}</div>
      </div>
      <button
        className="cascade-dismiss"
        style={{ textTransform: 'uppercase', letterSpacing: '.1em', fontSize: 10 }}
        onClick={() => setDismissed(id)}
      >{t('DASH_CASCADE_DISMISS')} ✕</button>
    </div>
  );
}

function TEdgeSignals() {
  const { store } = useMarket();
  const { t } = useLabels();
  const coin = store.selectedCoin;
  const d    = store.coins[coin];
  const oi1h = useOI1h(coin);

  const cbPct = store.cbPremiumPct;
  const cbCol = cbPct == null ? 'var(--txt3)'
    : cbPct >= 0.05  ? 'var(--green)'
    : cbPct <= -0.05 ? 'var(--red)'
    : 'var(--txt2)';
  const cbSig = cbPct == null ? t('DASH_EDGE_CB_LOADING')
    : cbPct >= 0.1   ? t('DASH_EDGE_CB_FOMO')
    : cbPct >= 0.05  ? t('DASH_EDGE_CB_MILD_BUY')
    : cbPct <= -0.1  ? t('DASH_EDGE_CB_RETAIL_SELLING')
    : cbPct <= -0.05 ? t('DASH_EDGE_CB_MILD_SELL')
    : t('DASH_EDGE_CB_NEUTRAL');

  const price     = d?.price;
  const vwap      = d?.vwap;
  const vwapAbove = vwap != null && price != null ? price > vwap : null;
  const vwapPct   = vwap && price ? ((price - vwap) / vwap) * 100 : null;
  const vwapCol   = vwapAbove === null ? 'var(--txt3)' : vwapAbove ? 'var(--green)' : 'var(--red)';

  const oiMeta = d?.oiTrend ? OI_TREND_META[d.oiTrend] : null;

  const fr     = d?.fundingRate;
  const frPct  = fr != null ? fr * 100 : null;
  const frInfo = fr != null ? classifyFunding(fr) : null;
  // --green/--red, not the -soft variants (#546 C9): --green-soft/--red-soft
  // are undeclared in terminal's 16-token palette (same gap #542 found for
  // --amber), and unlike --amber design hasn't confirmed a terminal value for
  // them. Collapsing to the base tone here - narrower than adding two more
  // governed tokens on a guess, and light theme already sets this precedent
  // ("no separate soft tier... collapse to the same audited colour").
  const frCol  = frPct == null ? 'var(--txt3)'
    : frPct >= 0.05   ? 'var(--red)'
    : frPct >= 0.01   ? 'var(--red)'
    : frPct <= -0.03  ? 'var(--green)'
    : frPct <= -0.005 ? 'var(--green)'
    : 'var(--txt2)';

  const { txt: oi1hTxt, col: oi1hCol } = oi1hSignal(oi1h.pct, d?.oiTrend);
  const oi1hPctStr = oi1h.pct != null ? (oi1h.pct >= 0 ? '+' : '') + oi1h.pct.toFixed(2) + '%' : '-';

  const sq    = computeSqueezeScore(d);
  // --txt2, not --txt-dim (#546 C9): --txt-dim isn't in terminal's 16-token
  // palette, and every sibling ladder in this file (cbCol, frCol) already
  // uses --txt2 for its own "quiet" state - this brings squeeze in line.
  const sqCol = sq.dir === 'SHORT_SQ' ? 'var(--green)' : sq.dir === 'LONG_LIQ' ? 'var(--red)' : 'var(--txt2)';

  return (
      <div className="edge-grid">
        <div className="edge-card">
          <div className="edge-card-label">
            <Tip text={t('DASH_EDGE_VWAP_TIP')}>{t('DASH_EDGE_VWAP_LABEL', { coin: coin.toUpperCase() })}</Tip>
          </div>
          <div className="edge-card-value" style={{ color: vwapCol, fontSize: 'var(--fs-data)' }}>
            {price != null ? '$' + fmtPrice(price, COIN_DEC[coin]) : '-'}
          </div>
          {vwap != null && (
            <div className="edge-card-sub">
              <span style={{ color: 'var(--txt3)' }}>{t('DASH_EDGE_VWAP_SUB_PREFIX')} </span>
              <span style={{ color: 'var(--txt2)', fontWeight: 600 }}>${vwap.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              {vwapPct != null && <span style={{ color: vwapCol }}> ({vwapPct >= 0 ? '+' : ''}{vwapPct.toFixed(2)}%)</span>}
            </div>
          )}
          <div className="edge-card-signal" style={{ color: vwapCol }}>
            {vwapAbove === null ? <SkeletonBar width={100} height={11} radius={4} /> : vwapAbove ? t('DASH_EDGE_VWAP_SIG_ABOVE') : t('DASH_EDGE_VWAP_SIG_BELOW')}
          </div>
        </div>

        <div className="edge-card">
          <div className="edge-card-label">
            <Tip width={260} text={t('DASH_EDGE_OI_TIP')}>{t('DASH_EDGE_OI_LABEL', { coin: coin.toUpperCase() })}</Tip>
          </div>
          {oiMeta ? (
            <>
              <div className="edge-card-value" style={{ color: oiMeta.col, fontSize: 'var(--fs-data)' }}>{t(oiMeta.txtKey)}</div>
              <div className="edge-card-signal" style={{ color: oiMeta.col }}>{t(oiMeta.subKey)}</div>
            </>
          ) : (
            <div className="edge-card-signal" style={{ color: 'var(--txt3)', marginTop: 4 }}>
              {d?.oi != null ? t('DASH_EDGE_OI_FLAT') : <SkeletonBar width={90} height={11} radius={4} />}
            </div>
          )}
        </div>

        <div className="edge-card">
          <div className="edge-card-label">
            <Tip text={t(frInfo ? FUNDING_TIP_KEY[frInfo.band] : 'DASH_EDGE_FUNDING_TIP')}>{t('DASH_EDGE_FUNDING_LABEL', { coin: coin.toUpperCase() })}</Tip>
          </div>
          <div className="edge-card-value" style={{ color: frCol }}>
            {frPct != null ? (frPct >= 0 ? '+' : '') + frPct.toFixed(4) + '%' : '-'}
          </div>
          <div className="edge-card-signal" style={{ color: frCol }}>
            {frInfo ? frInfo.label : <SkeletonBar width={70} height={11} radius={4} />}
          </div>
        </div>

        <div className="edge-card">
          <div className="edge-card-label">
            <Tip width={260} text={t('DASH_EDGE_SETUP_TIP')}>{t('DASH_EDGE_SETUP_LABEL', { coin: coin.toUpperCase() })}</Tip>
          </div>
          <div className="edge-card-value" style={{ color: sqCol, fontSize: 'var(--fs-data)' }}>
            {sq.score}
            <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, marginLeft: 6 }}>{sq.label}</span>
          </div>
          <div className="edge-card-signal" style={{ color: sqCol }}>
            {sq.dir === 'SHORT_SQ' ? t('DASH_EDGE_SETUP_SHORT_SQ')
             : sq.dir === 'LONG_LIQ' ? t('DASH_EDGE_SETUP_LONG_LIQ')
             : t('DASH_EDGE_SETUP_BALANCED')}
          </div>
        </div>

        <div className="edge-card">
          <div className="edge-card-label">
            <Tip text={t('DASH_EDGE_CB_TIP')}>{t('DASH_EDGE_CB_LABEL')}</Tip>
          </div>
          <div className="edge-card-value" style={{ color: cbCol, fontSize: 'var(--fs-data)' }}>
            {cbPct != null ? (cbPct >= 0 ? '+' : '') + cbPct.toFixed(3) + '%' : '-'}
          </div>
          <div className="edge-card-signal" style={{ color: cbCol }}>
            {cbPct == null ? <SkeletonBar width={90} height={11} radius={4} /> : cbSig}
          </div>
        </div>

        <div className="edge-card">
          <div className="edge-card-label">
            <Tip text={t('DASH_EDGE_OI1H_TIP')}>{t('DASH_EDGE_OI1H_LABEL', { coin: coin.toUpperCase() })}</Tip>
          </div>
          <div className="edge-card-value" style={{ color: oi1hCol }}>
            {oi1h.loading ? '-' : oi1hPctStr}
          </div>
          <div className="edge-card-signal" style={{ color: oi1hCol }}>
            {oi1h.loading ? <SkeletonBar width={70} height={11} radius={4} /> : oi1hTxt}
          </div>
        </div>
      </div>
  );
}

function TCoinSignalsHeader() {
  const { store } = useMarket();
  const { t } = useLabels();
  return (
    <div className="dash-section dash-section-hot">
      {t('DASH_COIN_SIGNALS_HEADER', { coin: store.selectedCoin.toUpperCase() })}
    </div>
  );
}

/* Market conditions (#413 canvas mirror, #587). Canvas draws four labelled
 * bars: Volatility / Trend strength / Breadth / Liquidity. Replaces
 * MarketConditionsWidget (Fear&Greed gauge + BTC RSI + long/short ratio,
 * a different metric set) only in terminal mode - the non-terminal branch
 * keeps that widget untouched.
 *
 * Two of the four bars ship here on real, already-available data:
 *   Volatility - BTC's 30-day HV percentile (useBtcVolRegime, above -
 *                same fixed cache read as the pulse strip's VOL chip).
 *   Breadth    - % of all COINS with a positive 24h change right now.
 *                Standard definition of market breadth; data already in
 *                store.coins[*].change.
 * Trend strength and Liquidity are left out. Neither has a real source in
 * this codebase today (no ADX/trend-strength calc, no orderbook/depth
 * fetch anywhere) - inventing one to fill a bar would be fabricating a
 * financial signal, not restyling an existing one. Confirmed with QA/design
 * before building; see the PR body. */
function TMarketConditions() {
  const { store } = useMarket();
  const { t } = useLabels();
  const vol = useBtcVolRegime();

  const positive = COINS.filter(id => (store.coins[id]?.change ?? 0) > 0).length;
  const breadthPct = COINS.length > 0 ? Math.round((positive / COINS.length) * 100) : 0;
  const breadthCol = breadthPct >= 60 ? 'var(--green)' : breadthPct <= 40 ? 'var(--red)' : 'var(--txt2)';

  const volLabelKey: LabelKey | null = vol == null ? null
    : vol.regime === 'low' ? 'VOLATILITY_REGIME_LABEL_LOW'
    : vol.regime === 'high' ? 'VOLATILITY_REGIME_LABEL_HIGH'
    : 'VOLATILITY_REGIME_LABEL_NEUTRAL';
  const volCol = vol == null ? 'var(--txt3)'
    : vol.regime === 'low' ? 'var(--green)'
    : vol.regime === 'high' ? 'var(--red)'
    : 'var(--txt2)';

  const rows: { key: string; label: string; pct: number; value: string; col: string }[] = [
    { key: 'vol', label: t('DASH_COND_VOLATILITY_LABEL'), pct: vol?.percentile ?? 0, value: vol && volLabelKey ? t(volLabelKey) : '-', col: volCol },
    { key: 'breadth', label: t('DASH_COND_BREADTH_LABEL'), pct: breadthPct, value: breadthPct + '%', col: breadthCol },
  ];

  return (
    <div className="av-rail-panel">
      <div className="av-rail-panel-h">{t('MARKET_CONDITIONS_WIDGET_TITLE')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(r => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--txt3)', width: 90, flexShrink: 0 }}>{r.label}</div>
            <div style={{ flex: 1, height: 5, background: 'var(--bg3)' }}>
              <div style={{ width: `${r.pct}%`, height: 5, background: r.col }} />
            </div>
            <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11, color: r.col, width: 60, textAlign: 'right', flexShrink: 0 }}>
              {r.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TSelectedCoinCard() {
  const { store } = useMarket();
  const { t } = useLabels();
  const id  = store.selectedCoin;
  const d   = store.coins[id];
  const dec = COIN_DEC[id];
  const chg = d?.change ?? 0;
  const up  = chg >= 0;
  const badgeCol = coinBadgeColor(id);
  const oi = d?.oiTrend ? OI_TREND_META[d.oiTrend] : null;
  const pattern = d?.chartPattern?.split(';')[0].split('(')[0].trim();
  const sigText = oi ? t(oi.txtKey) : (pattern || null);
  const sigCol  = oi?.col ?? 'var(--txt3)';

  return (
    <Link
      href={`/arena?coin=${id}`}
      className="scc-card"
      title={t('DASH_SELECTED_COIN_OPEN_ARENA', { coin: id.toUpperCase() })}
    >
      <CoinIcon coin={id} size={26} color={badgeCol} bg={withAlpha(badgeCol, '24')} />
      <div className="scc-id">
        <span className="scc-ticker">{id.toUpperCase()}</span>
        <span className="scc-price">{d?.price ? '$' + fmtPrice(d.price, dec) : '-'}</span>
      </div>
      <div className="scc-meta">
        <span className={`scc-chg ${up ? 'scc-up' : 'scc-dn'}`}>{up ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%</span>
        <span className="scc-sig" style={{ color: sigCol }}>{sigText || <SkeletonBar width={80} height={11} radius={4} />}</span>
      </div>
      <span className="scc-cta" aria-hidden="true">{t('DASH_SELECTED_COIN_ARENA_CTA')}</span>
    </Link>
  );
}

/* Best-setup headline (#413 canvas mirror, #587). Replaces SOTD ("Secret of
 * the Day", a static playbook-tips list unrelated to market data - present
 * under this same header in BOTH designs today, a pre-existing mismatch this
 * branch does not touch outside terminal mode). Reuses computeSqueezeScore,
 * the same real number TEdgeSignals already shows as its "Setup score" card
 * - not a new metric, a more prominent read of the existing one.
 *
 * Canvas also draws Entry/Stop/Target levels here. No local computation
 * produces them - the only place this app generates E/S/T is Arena's
 * per-request AI call, and its result lives in sessionStorage keyed to
 * whatever coin the user last ran there, not to whatever coin is selected
 * on the dashboard right now, with no re-validation against current price
 * (Arena's own UI has to re-check "stopped"/"target hit" against live price
 * before showing a cached E/S/T at all - reusing the stored value here
 * without that check would show a trader a level that may have already
 * been invalidated). Omitted rather than guessed - see PR body. */
function TBestSetupToday() {
  const { store } = useMarket();
  const { t } = useLabels();
  const id = store.selectedCoin;
  const d  = store.coins[id];
  const sq = computeSqueezeScore(d);

  // "LEAN" below 70 mirrors the shape of this same file's grade bands
  // (computeSqueezeScore's A/B/C/D/F cutoffs) rather than inventing a new
  // threshold - flagged for design to confirm or move the line.
  const biasText = sq.dir === 'SHORT_SQ'
    ? (sq.score >= 70 ? t('ARENA_VERDICT_LONG') : t('ARENA_VERDICT_LEAN_LONG'))
    : sq.dir === 'LONG_LIQ'
    ? (sq.score >= 70 ? t('ARENA_VERDICT_SHORT') : t('ARENA_VERDICT_LEAN_SHORT'))
    : t('ARENA_VERDICT_WAIT');
  const biasCol = sq.dir === 'SHORT_SQ' ? 'var(--green)' : sq.dir === 'LONG_LIQ' ? 'var(--red)' : 'var(--txt2)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '10px 20px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12, fontWeight: 700, color: 'var(--txt)', letterSpacing: '.06em' }}>
          {id.toUpperCase()}
        </span>
        <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 16, fontWeight: 700, color: biasCol }}>
          {biasText}
        </span>
      </div>
      <div style={{ flex: 1, height: 3, background: 'var(--bdr)' }}>
        <div style={{ width: `${sq.score}%`, height: 3, background: biasCol }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 12, fontWeight: 700, color: 'var(--txt)', flexShrink: 0 }}>
        {sq.score}
      </span>
    </div>
  );
}

/* Flat terminal panel replacing mb-glow-card. No shadow, no glow, no radius. */
/* A main-column BAND, not a card (#607). The canvas's main column is a flex
   column with no gap, where each band carries only a bottom hairline and sits
   on the column's own ground - Dashboard 2a.dc.html:77-86. This used to be a
   free-standing bordered card on --bg1, which with .dash-main's 14px gap read
   as a stack of floating boxes rather than the canvas's continuous banded
   column: every band drew four borders, and the 14px of page ground between
   them turned each hairline into a stray underline instead of a divider.
   Background left to the column so the market-read banner stays the one
   lifted surface, which is how the canvas distinguishes it. */
function TPanel({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <div
      id={id}
      style={{
        borderBottom: '1px solid var(--bdr)',
        borderRadius: 0,
      }}
    >
      {children}
    </div>
  );
}

export default function DashboardTerminal() {
  const { t } = useLabels();
  const [showTour, setShowTour] = useState(false);
  const rightRef = useRef<HTMLElement>(null);

  const { tourPending, clearTourPending } = useOnboarding();

  useEffect(() => {
    if (tourPending) {
      setShowTour(true);
      clearTourPending();
    }
  }, [tourPending, clearTourPending]);

  return (
    <div className="dashboard-grid" data-spotlight-section>
      {showTour && <SpotlightTour onDone={() => setShowTour(false)} />}
      <SetupChecklist />
      <TCascadeAlertBanner />
      <TContrarianBanner />

      {/* No GlobalSpotlight in terminal mode — cursor glow effects don't fit
          the flat monochrome aesthetic. */}

      <div className="dash-main">
        <TMarketReadBanner />

        <TPanel id="tour-best-setup">
          <div className="dash-section dash-section-hot" style={{ marginTop: 0 }}>{t('DASH_BEST_SETUP_TODAY_HEADER')}</div>
          <TBestSetupToday />
        </TPanel>

        <TSelectedCoinCard />

        <TPanel id="tour-coin-signals">
          <TCoinSignalsHeader />
          <TEdgeSignals />
        </TPanel>

        <div className="dash-conditions-row">
          <EconCalendarWidget />
          <TMarketConditions />
        </div>
      </div>

      <aside className="dash-right" ref={rightRef}>
        <TCoinSidebar />
        <TMarketPulseStrip />
        <div className="macro-rail-card">
          <PerpSpotCard />
        </div>
        <div className="macro-rail-card">
          <GlobalMacroContext />
        </div>
      </aside>
    </div>
  );
}
