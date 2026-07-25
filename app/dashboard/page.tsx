'use client';
import { useState, useEffect, useRef } from 'react';
import { useOnboarding } from '@/components/OnboardingProvider';
import { useMarket, COINS, COIN_DEC, fmtPrice, computeCoinHealth, classifyFunding, computeSqueezeScore } from '@/lib/marketStore';
import type { CoinId } from '@/lib/marketStore';
import { useOI1h, oi1hSignal } from '@/lib/useOI1h';
import { useSettings } from '@/lib/settings';
import SOTD from '@/components/SOTD';
import MarketRead from '@/components/MarketRead';
import GlobalMacroContext from '@/components/GlobalMacroContext';
import EconCalendarWidget from '@/components/EconCalendarWidget';
import MarketConditionsWidget from '@/components/MarketConditionsWidget';
import SpotlightTour from '@/components/SpotlightTour';
import SetupChecklist from '@/components/SetupChecklist';
import Tip from '@/components/Tip';
import { coinBadgeColor } from '@/lib/coinBadge';
import { withAlpha } from '@/lib/color';
import Sparkline24h from '@/components/Sparkline24h';
import CoinIcon from '@/components/CoinIcon';
import { GlobalSpotlight, useMobile } from '@/components/MagicBento';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

const OI_TREND_META: Record<string, { txtKey: LabelKey; subKey: LabelKey; col: string }> = {
  strong_up:   { txtKey: 'OI_TREND_STRONG_UP_TXT',   subKey: 'OI_TREND_STRONG_UP_SUB',   col: '#34d399' },
  strong_down: { txtKey: 'OI_TREND_STRONG_DOWN_TXT', subKey: 'OI_TREND_STRONG_DOWN_SUB', col: '#f87171' },
  weak_up:     { txtKey: 'OI_TREND_WEAK_UP_TXT',     subKey: 'OI_TREND_WEAK_UP_SUB',     col: '#fbbf24' },
  weak_down:   { txtKey: 'OI_TREND_WEAK_DOWN_TXT',   subKey: 'OI_TREND_WEAK_DOWN_SUB',   col: '#94a3b8' },
};


/* ── Market Pulse Strip - compact stat chips replacing 3 sidebar indicator cards ── */
function MarketPulseStrip() {
  const { store } = useMarket();
  const { t } = useLabels();
  const [volLabel, setVolLabel] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('lhq_vol_regime');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.ts < 4 * 60 * 60 * 1000 && parsed.data?.btc?.label) {
          setVolLabel(parsed.data.btc.label);
        }
      }
    } catch {}
  }, []);

  // Fear & Greed intentionally lives in the Market Read hero now (deduped) - the
  // strip carries the dominance/altseason/volatility context that isn't there.
  const dom = store.btcDom;
  const alt = store.altSeasonScore;

  const altColor = alt == null ? 'var(--txt3)'
    : alt >= 75 ? '#34d399'
    : alt >= 50 ? '#86efac'
    : alt >= 25 ? '#fca5a5'
    : '#f87171';

  const volColor = volLabel === 'Low Vol' ? '#34d399'
    : volLabel === 'High Vol' ? '#f87171'
    : 'var(--txt2)';

  const domNote = dom == null ? '' : dom >= 60 ? t('DASH_PULSE_NOTE_BTC_LEADS') : dom >= 55 ? t('DASH_PULSE_NOTE_ELEVATED') : dom >= 48 ? t('DASH_PULSE_NOTE_NORMAL') : t('DASH_PULSE_NOTE_ALT_SEASON');
  const altNote = alt == null ? '' : alt >= 75 ? t('DASH_PULSE_NOTE_ALT_SEASON') : alt >= 50 ? t('DASH_PULSE_NOTE_LEAN_ALTS') : alt >= 25 ? t('DASH_PULSE_NOTE_BTC_LEADS') : t('DASH_PULSE_NOTE_BTC_SEASON');

  type Chip = { label: string; value: string; note: string; color: string };
  const chips: Chip[] = [
    { label: t('DASH_PULSE_BTC_DOM_LABEL'), value: dom != null ? dom.toFixed(1) + '%' : '-', note: domNote, color: 'var(--txt)' },
    { label: t('DASH_PULSE_ALT_LABEL'), value: alt != null ? String(alt) : '-', note: altNote, color: altColor },
    ...(volLabel ? [{ label: t('DASH_PULSE_VOL_LABEL'), value: volLabel.replace(' Vol', ''), note: t('DASH_PULSE_VOL_NOTE'), color: volColor }] : []),
  ];

  return (
    <div style={{
      background: 'var(--bg2)',
      border: '0.5px solid var(--bdr)',
      borderRadius: 'var(--radius-card)',
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


/* ── Coin Sidebar v2 - signal cards ── */
const SIDEBAR_DEFAULT = 7;

function CoinSidebar() {
  const { store, selectCoin } = useMarket();
  const { t } = useLabels();
  const { settings } = useSettings();
  const watchlist = settings.watchlist ?? [];
  const pinned = watchlist.filter((id): id is CoinId => (COINS as string[]).includes(id));
  const rest    = COINS.filter(id => !watchlist.includes(id));
  const visibleCoins = [...pinned, ...rest].slice(0, SIDEBAR_DEFAULT);

  return (
    <div className="csb2-container">
      {visibleCoins.map(id => {
        const d   = store.coins[id];
        const dec = COIN_DEC[id];
        const chg = d?.change ?? 0;
        const up  = chg >= 0;
        const sel = store.selectedCoin === id;
        const tbp    = d?.takerBuyRatio != null ? Math.round(d.takerBuyRatio * 100) : 50;
        const health = computeCoinHealth(d);
        const badgeCol = coinBadgeColor(id);

        // ── Single priority signal ──
        let sig: { text: string; col: string } | null = null;
        if (d?.fundingRate != null) {
          const fr = d.fundingRate * 100;
          if (fr >= 0.04)       sig = { text: t('DASH_SIDEBAR_SIG_LONGS_OVERCROWDED'), col: '#f87171' };
          else if (fr <= -0.02) sig = { text: t('DASH_SIDEBAR_SIG_SHORTS_SQUEEZED'),   col: '#34d399' };
        }
        if (!sig && d?.cvdDivergence === 'bullish') sig = { text: t('DASH_SIDEBAR_SIG_SMART_BUYERS'), col: '#34d399' };
        if (!sig && d?.cvdDivergence === 'bearish') sig = { text: t('DASH_SIDEBAR_SIG_SMART_SELLERS'), col: '#f87171' };
        if (!sig && d?.oiTrend === 'strong_up')     sig = { text: t('DASH_SIDEBAR_SIG_NEW_BUYERS'),  col: '#34d399' };
        if (!sig && d?.oiTrend === 'strong_down')   sig = { text: t('DASH_SIDEBAR_SIG_NEW_SELLERS'), col: '#f87171' };
        if (!sig && d?.chartPattern) {
          const isBull = /bull|higher high|engulf.*bull|hammer(?! man)|double bot/i.test(d.chartPattern);
          const isBear = /bear|lower high|engulf.*bear|shooting|double top/i.test(d.chartPattern);
          const label  = d.chartPattern.split(';')[0].split('(')[0].trim();
          if (isBull)       sig = { text: label, col: '#34d399' };
          else if (isBear)  sig = { text: label, col: '#f87171' };
          else if (label)   sig = { text: label, col: 'var(--txt3)' };
        }
        if (!sig && d?.oiTrend === 'weak_up')   sig = { text: t('DASH_SIDEBAR_SIG_SHORTS_CLOSING'),   col: '#fbbf24' };
        if (!sig && d?.oiTrend === 'weak_down')  sig = { text: t('DASH_SIDEBAR_SIG_BUYERS_PROFIT'),       col: '#94a3b8' };
        if (!sig && d?.fundingRate != null && d.fundingRate !== 0) {
          const fr = d.fundingRate * 100;
          if      (fr >= 0.05)   sig = { text: t('DASH_SIDEBAR_SIG_FUNDING_VERY_HIGH'),      col: '#f87171' };
          else if (fr >= 0.01)   sig = { text: t('DASH_SIDEBAR_SIG_FUNDING_SLIGHTLY_HIGH'),  col: '#fca5a5' };
          else if (fr <= -0.03)  sig = { text: t('DASH_SIDEBAR_SIG_FUNDING_VERY_LOW'),       col: '#34d399' };
          else if (fr <= -0.005) sig = { text: t('DASH_SIDEBAR_SIG_FUNDING_SLIGHTLY_LOW'),   col: '#86efac' };
          else                   sig = { text: t('DASH_SIDEBAR_SIG_FUNDING_NEUTRAL'),         col: 'var(--txt3)' };
        }

        const barCol = tbp >= 60 ? '#34d399' : tbp <= 40 ? '#f87171' : '#404040';

        return (
          // Plain flat card - was ParticleCard/mb-glow-card, which drew a
          // cursor-following blue border glow (GLOW_COLOR = accent blue)
          // across this whole dense scrolling list. Fine for a single hero
          // feature card, awful on 7 stacked rows - violates the flat-card
          // rule (color on data values only, never the card frame/border).
          <div
            key={id}
            className={`csb2-card${sel ? ' csb2-sel' : ''}`}
            onClick={() => selectCoin(id)}
          >
            <div className="csb2-top">
              <CoinIcon coin={id} size={18} color={badgeCol} bg={withAlpha(badgeCol, '24')} />
              <span className="csb2-name">{id.toUpperCase()}</span>
              {d?.price && (
                <span style={{
                  fontSize: 'var(--fs-caption)', fontWeight: 800, lineHeight: 1,
                  padding: '2px 4px', borderRadius: 4,
                  color: health.color,
                  background: withAlpha(health.color, '22'),
                  border: `0.5px solid ${withAlpha(health.color, '55')}`,
                  letterSpacing: '.04em', flexShrink: 0,
                }}>
                  {health.grade}
                </span>
              )}
              <span className="csb2-price">
                {d?.price ? '$' + fmtPrice(d.price, dec) : '-'}
              </span>
            </div>

            <div className="csb2-bottom">
              <span className={`csb2-chg ${up ? 'chg-up' : 'chg-dn'}`}>
                {up ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%
              </span>
              <Sparkline24h coin={id} width={36} height={14} />
              {sig && (
                <span className="csb2-sig" style={{ color: sig.col }}>
                  {sig.text}
                </span>
              )}
            </div>

            <div className="csb2-bar-track">
              <div
                className="csb2-bar-fill"
                style={{ width: tbp + '%', background: barCol }}
              />
            </div>
          </div>
        );
      })}

      <a
        href="/markets"
        style={{
          display: 'block', width: '100%', background: 'none', border: 'none',
          borderTop: '1px solid #1a1a1a', padding: '7px 0',
          fontSize: 'var(--fs-caption)', color: 'var(--txt3)', cursor: 'pointer',
          letterSpacing: '0.04em', textAlign: 'center', textDecoration: 'none',
        }}
      >
        {t('DASH_SIDEBAR_MORE_COINS', { count: COINS.length - SIDEBAR_DEFAULT })}
      </a>
    </div>
  );
}

/* ── Liquidation Cascade Alert Banner ── */
function CascadeAlertBanner() {
  const { store, setStore } = useMarket();
  const { t } = useLabels();
  const alert = store.cascadeAlert;

  useEffect(() => {
    if (!alert) return;
    const t = setTimeout(() => setStore(s => ({ ...s, cascadeAlert: null })), 3 * 60_000);
    return () => clearTimeout(t);
  }, [alert?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alert) return null;

  const usdStr = alert.totalUsd >= 1e6
    ? `$${(alert.totalUsd / 1e6).toFixed(1)}M`
    : `$${(alert.totalUsd / 1e3).toFixed(0)}K`;
  const label = alert.side === 'LONG' ? t('DASH_CASCADE_LABEL_LONG')
              : alert.side === 'SHORT' ? t('DASH_CASCADE_LABEL_SHORT')
              : t('DASH_CASCADE_LABEL_NEUTRAL');
  const hint = alert.side === 'LONG'
    ? t('DASH_CASCADE_HINT_LONG')
    : alert.side === 'SHORT'
    ? t('DASH_CASCADE_HINT_SHORT')
    : t('DASH_CASCADE_HINT_NEUTRAL');
  const col = alert.side === 'LONG' ? '#f87171'
            : alert.side === 'SHORT' ? '#34d399'
            : '#fbbf24';
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
        onClick={() => setStore(s => ({ ...s, cascadeAlert: null }))}
      >✕</button>
    </div>
  );
}

function EdgeSignals() {
  const { store } = useMarket();
  const { t } = useLabels();
  const coin = store.selectedCoin;
  const d    = store.coins[coin];
  const oi1h = useOI1h(coin);

  // ── CB Premium ──
  const cbPct = store.cbPremiumPct;
  const cbCol = cbPct == null ? 'var(--txt3)'
    : cbPct >= 0.05  ? '#34d399'
    : cbPct <= -0.05 ? '#f87171'
    : 'var(--txt2)';
  const cbSig = cbPct == null ? t('DASH_EDGE_CB_LOADING')
    : cbPct >= 0.1   ? t('DASH_EDGE_CB_FOMO')
    : cbPct >= 0.05  ? t('DASH_EDGE_CB_MILD_BUY')
    : cbPct <= -0.1  ? t('DASH_EDGE_CB_RETAIL_SELLING')
    : cbPct <= -0.05 ? t('DASH_EDGE_CB_MILD_SELL')
    : t('DASH_EDGE_CB_NEUTRAL');

  // ── VWAP ──
  const price    = d?.price;
  const vwap     = d?.vwap;
  const vwapAbove = vwap != null && price != null ? price > vwap : null;
  const vwapPct   = vwap && price ? ((price - vwap) / vwap) * 100 : null;
  const vwapCol   = vwapAbove === null ? 'var(--txt3)' : vwapAbove ? 'var(--green)' : 'var(--red)';

  // ── OI Trend ──
  const oiMeta = d?.oiTrend ? OI_TREND_META[d.oiTrend] : null;

  // ── Funding Rate ──
  const fr     = d?.fundingRate;
  const frPct  = fr != null ? fr * 100 : null;
  const frInfo = fr != null ? classifyFunding(fr) : null;
  const frCol  = frPct == null ? 'var(--txt3)'
    : frPct >= 0.05  ? '#f87171'
    : frPct >= 0.01  ? '#fca5a5'
    : frPct <= -0.03 ? '#34d399'
    : frPct <= -0.005? '#86efac'
    : 'var(--txt2)';

  // ── OI 1h ──
  const { txt: oi1hTxt, col: oi1hCol } = oi1hSignal(oi1h.pct, d?.oiTrend);
  const oi1hPctStr = oi1h.pct != null ? (oi1h.pct >= 0 ? '+' : '') + oi1h.pct.toFixed(2) + '%' : '-';

  // ── Squeeze score ──
  const sq = computeSqueezeScore(d);
  const sqCol = sq.dir === 'SHORT_SQ' ? '#34d399' : sq.dir === 'LONG_LIQ' ? '#f87171' : '#606060';

  const vwapCard = (
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
  );

  const oiCard = (
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
  );

  const fundingCard = (
    <div className="edge-card">
      <div className="edge-card-label">
        <Tip text={t('DASH_EDGE_FUNDING_TIP')}>{t('DASH_EDGE_FUNDING_LABEL', { coin: coin.toUpperCase() })}</Tip>
      </div>
      <div className="edge-card-value" style={{ color: frCol }}>
        {frPct != null ? (frPct >= 0 ? '+' : '') + frPct.toFixed(4) + '%' : '-'}
      </div>
      <div className="edge-card-signal" style={{ color: frCol }}>
        {frInfo ? frInfo.label : <SkeletonBar width={70} height={11} radius={4} />}
      </div>
    </div>
  );

  const setupCard = (
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
  );

  const cbCard = (
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
  );

  const oi1hCard = (
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
  );

  // Same two-row layout as before; the "2 more" collapse toggle is gone so
  // CB Premium / OI 1h are always visible instead of gated behind a click.
  return (
    <>
      <div className="edge-grid">
        {vwapCard}{oiCard}{fundingCard}{setupCard}
      </div>
      <div className="edge-grid" style={{ marginTop: 8 }}>
        {cbCard}{oi1hCard}
      </div>
    </>
  );
}


function CoinSignalsHeader() {
  const { store } = useMarket();
  const { t } = useLabels();
  return (
    <div className="dash-section dash-section-hot">
      {t('DASH_COIN_SIGNALS_HEADER', { coin: store.selectedCoin.toUpperCase() })}
    </div>
  );
}

/* ── Selected-coin glance card - price + change + one signal (no triplicated
   funding/vol/vwap; those live in Coin Signals below) ── */
function SelectedCoinCard() {
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
    <div className="scc-card">
      <CoinIcon coin={id} size={30} color={badgeCol} bg={withAlpha(badgeCol, '24')} />
      <div className="scc-id">
        <span className="scc-ticker">{id.toUpperCase()}</span>
        <span className="scc-price">{d?.price ? '$' + fmtPrice(d.price, dec) : '-'}</span>
      </div>
      <div className="scc-meta">
        <span className={`scc-chg ${up ? 'scc-up' : 'scc-dn'}`}>{up ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%</span>
        <span className="scc-sig" style={{ color: sigCol }}>{sigText || <SkeletonBar width={80} height={11} radius={4} />}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useLabels();
  const [showTour, setShowTour] = useState(false);
  const rightRef = useRef<HTMLElement>(null);
  const mainRef  = useRef<HTMLDivElement>(null);
  const isMobile = useMobile();

  const { tourPending, clearTourPending } = useOnboarding();

  // OnboardingGate flips tourPending right after a user finishes onboarding
  // (from whatever page they were on) and routes here, since the spotlight
  // tour targets dashboard-only DOM (data-spotlight-section, .mb-glow-card).
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
      {/* Floating cascade toast - fixed-positioned, render once */}
      <CascadeAlertBanner />

      <GlobalSpotlight gridRef={rightRef} cardSelector=".mb-glow-card" radius={260} disableAnimations={isMobile} />
      <GlobalSpotlight gridRef={mainRef} cardSelector=".mb-glow-card" radius={320} disableAnimations={isMobile} />

      {/* ── LEFT · the answers (answer-first order) ── */}
      <div className="dash-main" ref={mainRef}>
        {/* 1. Market Read - the verdict */}
        <MarketRead />

        {/* 2. Best Setup Today */}
        <div id="tour-best-setup" className="mb-glow-card" style={{ borderRadius: 10 }}>
          <div className="dash-section dash-section-hot" style={{ marginTop: 0 }}>{t('DASH_BEST_SETUP_TODAY_HEADER')}</div>
          <SOTD />
        </div>

        {/* 3. Your coin - glance */}
        <SelectedCoinCard />

        {/* 4. Coin signals - selected coin detail */}
        <div id="tour-coin-signals" className="mb-glow-card" style={{ borderRadius: 10 }}>
          <CoinSignalsHeader />
          <EdgeSignals />
        </div>

        {/* 5. Economic calendar preview + Market conditions gauge - full width
            here instead of the narrow rail, side by side on desktop. */}
        <div className="dash-conditions-row">
          <EconCalendarWidget />
          <MarketConditionsWidget />
        </div>
      </div>

      {/* ── RIGHT · context (sticky rail on desktop, stacks below on mobile) ── */}
      <aside className="dash-right" ref={rightRef}>
        <CoinSidebar />
        <MarketPulseStrip />
        {/* Macro backdrop - answers "what's the broad market doing", which nothing
            else on the dashboard covers. Last in the rail so it never pushes the
            per-coin essentials down on mobile. */}
        <div className="macro-rail-card">
          <GlobalMacroContext />
        </div>
      </aside>
    </div>
  );
}
