'use client';
import { useState, useEffect, useRef } from 'react';
import { useOnboarding } from '@/components/OnboardingProvider';
import { useMarket, COINS, COIN_DEC, fmtPrice, computeCoinHealth, classifyFunding, computeSqueezeScore } from '@/lib/marketStore';
import type { CoinId } from '@/lib/marketStore';
import { useOI1h, oi1hSignal } from '@/lib/useOI1h';
import { useSettings } from '@/lib/settings';
import Ticker from '@/components/Ticker';
import SOTD from '@/components/SOTD';
import SessionCountdown from '@/components/SessionCountdown';
import SessionContext from '@/components/SessionContext';
import SmartMoneyScore from '@/components/SmartMoneyScore';
import SentimentExtremesAlert from '@/components/SentimentExtremesAlert';
import SpotlightTour from '@/components/SpotlightTour';
import SetupChecklist from '@/components/SetupChecklist';
import Tip from '@/components/Tip';
import { coinBadgeColor } from '@/lib/coinBadge';
import Sparkline24h from '@/components/Sparkline24h';
import { ParticleCard, GlobalSpotlight, useMobile } from '@/components/MagicBento';

const OI_TREND_META: Record<string, { txt: string; sub: string; col: string }> = {
  strong_up:   { txt: '▲ New buyers opening', sub: 'Open interest rising with price — real trend', col: '#34d399' },
  strong_down: { txt: '▼ New sellers opening', sub: 'Open interest rising as price falls — real dump', col: '#f87171' },
  weak_up:     { txt: '△ Short covering',      sub: 'Open interest falling as price rises — weak pump', col: '#fbbf24' },
  weak_down:   { txt: '▽ Long exits',           sub: 'Open interest falling with price — no panic',      col: '#94a3b8' },
};


/* ── Market Pulse Strip — compact stat chips replacing 3 sidebar indicator cards ── */
function MarketPulseStrip() {
  const { store } = useMarket();
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

  const fng = store.fng;
  const fngLabel = store.fngLabel ?? '';
  const dom = store.btcDom;
  const alt = store.altSeasonScore;

  const fngColor = fng == null ? 'var(--txt3)'
    : fng <= 25 ? '#f87171'
    : fng <= 45 ? '#fca5a5'
    : fng <= 55 ? '#fbbf24'
    : fng <= 75 ? '#86efac'
    : '#34d399';

  const altColor = alt == null ? 'var(--txt3)'
    : alt >= 75 ? '#34d399'
    : alt >= 50 ? '#86efac'
    : alt >= 25 ? '#fca5a5'
    : '#f87171';

  const volColor = volLabel === 'Low Vol' ? '#34d399'
    : volLabel === 'High Vol' ? '#f87171'
    : 'var(--txt2)';

  const shortFngLabel = fngLabel.replace('Extreme ', 'Extr. ');
  const domNote = dom == null ? '' : dom >= 60 ? 'BTC leads' : dom >= 55 ? 'Elevated' : dom >= 48 ? 'Normal' : 'Alt season';
  const altNote = alt == null ? '' : alt >= 75 ? 'Alt season' : alt >= 50 ? 'Lean alts' : alt >= 25 ? 'BTC leads' : 'BTC season';

  type Chip = { label: string; value: string; note: string; color: string };
  const chips: Chip[] = [
    { label: 'F&G', value: fng != null ? String(fng) : '—', note: shortFngLabel, color: fngColor },
    { label: 'BTC.D', value: dom != null ? dom.toFixed(1) + '%' : '—', note: domNote, color: 'var(--txt)' },
    { label: 'ALT', value: alt != null ? String(alt) : '—', note: altNote, color: altColor },
    ...(volLabel ? [{ label: 'VOL', value: volLabel.replace(' Vol', ''), note: 'BTC regime', color: volColor }] : []),
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
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.06em', textTransform: 'uppercase', fontFamily: 'var(--font-mono), monospace' }}>
            {chip.label}
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: chip.color, fontFamily: 'var(--font-mono), monospace', lineHeight: 1 }}>
            {chip.value}
          </div>
          <div style={{ fontSize: 9, color: 'var(--txt3)', lineHeight: 1.2 }}>
            {chip.note}
          </div>
        </div>
      ))}
    </div>
  );
}


/* ── Coin Sidebar v2 — signal cards ── */
const SIDEBAR_DEFAULT = 7;

function CoinSidebar() {
  const { store, selectCoin } = useMarket();
  const isMobile = useMobile();
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
          if (fr >= 0.04)       sig = { text: 'Longs overcrowded', col: '#f87171' };
          else if (fr <= -0.02) sig = { text: 'Shorts squeezed',   col: '#34d399' };
        }
        if (!sig && d?.cvdDivergence === 'bullish') sig = { text: 'Smart buyers active', col: '#34d399' };
        if (!sig && d?.cvdDivergence === 'bearish') sig = { text: 'Smart sellers active', col: '#f87171' };
        if (!sig && d?.oiTrend === 'strong_up')     sig = { text: 'New buyers opening',  col: '#34d399' };
        if (!sig && d?.oiTrend === 'strong_down')   sig = { text: 'New sellers opening', col: '#f87171' };
        if (!sig && d?.chartPattern) {
          const isBull = /bull|higher high|engulf.*bull|hammer(?! man)|double bot/i.test(d.chartPattern);
          const isBear = /bear|lower high|engulf.*bear|shooting|double top/i.test(d.chartPattern);
          const label  = d.chartPattern.split(';')[0].split('(')[0].trim();
          if (isBull)       sig = { text: label, col: '#34d399' };
          else if (isBear)  sig = { text: label, col: '#f87171' };
          else if (label)   sig = { text: label, col: 'var(--txt3)' };
        }
        if (!sig && d?.oiTrend === 'weak_up')   sig = { text: 'Shorts closing (weak up)',   col: '#fbbf24' };
        if (!sig && d?.oiTrend === 'weak_down')  sig = { text: 'Buyers taking profit',       col: '#94a3b8' };
        if (!sig && d?.fundingRate != null && d.fundingRate !== 0) {
          const fr = d.fundingRate * 100;
          if      (fr >= 0.05)   sig = { text: 'Funding very high',      col: '#f87171' };
          else if (fr >= 0.01)   sig = { text: 'Funding slightly high',  col: '#fca5a5' };
          else if (fr <= -0.03)  sig = { text: 'Funding very low',       col: '#34d399' };
          else if (fr <= -0.005) sig = { text: 'Funding slightly low',   col: '#86efac' };
          else                   sig = { text: 'Funding neutral',         col: 'var(--txt3)' };
        }

        const barCol = tbp >= 60 ? '#34d399' : tbp <= 40 ? '#f87171' : '#404040';

        return (
          <ParticleCard
            key={id}
            className={`csb2-card mb-glow-card${sel ? ' csb2-sel' : ''}`}
            onClick={() => selectCoin(id)}
            disableAnimations={isMobile}
            particleCount={5}
            enableMagnetism={false}
            clickEffect={true}
          >
            <div className="csb2-top">
              <span style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 800, fontFamily: 'var(--font-mono), monospace',
                background: badgeCol + '24', color: badgeCol, border: `0.5px solid ${badgeCol}55`,
              }}>
                {id.slice(0, 2).toUpperCase()}
              </span>
              <span className="csb2-name">{id.toUpperCase()}</span>
              {d?.price && (
                <span style={{
                  fontSize: 9, fontWeight: 800, lineHeight: 1,
                  padding: '2px 4px', borderRadius: 4,
                  color: health.color,
                  background: health.color + '22',
                  border: `0.5px solid ${health.color}55`,
                  letterSpacing: '.04em', flexShrink: 0,
                }}>
                  {health.grade}
                </span>
              )}
              <span className="csb2-price">
                {d?.price ? '$' + fmtPrice(d.price, dec) : '—'}
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
          </ParticleCard>
        );
      })}

      <a
        href="/markets"
        style={{
          display: 'block', width: '100%', background: 'none', border: 'none',
          borderTop: '1px solid #1a1a1a', padding: '7px 0',
          fontSize: 11, color: 'var(--txt3)', cursor: 'pointer',
          letterSpacing: '0.04em', textAlign: 'center', textDecoration: 'none',
        }}
      >
        ▼ +{COINS.length - SIDEBAR_DEFAULT} more coins
      </a>

      <div className="csb2-status">
        <span
          className="csb2-status-dot"
          style={{
            background: store.wsStatus.includes('backup') ? '#fb923c'
              : store.wsStatus.includes('error') || store.wsStatus.includes('Error') ? '#f87171'
              : '#34d399',
          }}
        />
        <span>{store.wsStatus.includes('backup') ? 'REST' : store.wsStatus.includes('Live') ? 'Live' : 'Connecting'}</span>
      </div>
    </div>
  );
}

/* ── Liquidation Cascade Alert Banner ── */
function CascadeAlertBanner() {
  const { store, setStore } = useMarket();
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
  const label = alert.side === 'LONG' ? 'LONG LIQ CASCADE'
              : alert.side === 'SHORT' ? 'SHORT LIQ CASCADE'
              : 'LIQ CASCADE';
  const hint = alert.side === 'LONG'
    ? 'Longs wiped — short squeeze window open'
    : alert.side === 'SHORT'
    ? 'Shorts flushed — continuation window open'
    : 'Multi-directional flush — vol spike imminent';
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
          {alert.coin} — {label}
        </div>
        <div className="cascade-sub">{usdStr} in 60s · {hint}</div>
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
  const coin = store.selectedCoin;
  const d    = store.coins[coin];
  const oi1h = useOI1h(coin);

  // ── CB Premium ──
  const cbPct = store.cbPremiumPct;
  const cbCol = cbPct == null ? 'var(--txt3)'
    : cbPct >= 0.05  ? '#34d399'
    : cbPct <= -0.05 ? '#f87171'
    : 'var(--txt2)';
  const cbSig = cbPct == null ? 'Loading…'
    : cbPct >= 0.1   ? 'US retail FOMO ▲'
    : cbPct >= 0.05  ? 'Mild US buy pressure'
    : cbPct <= -0.1  ? 'US retail selling ▼'
    : cbPct <= -0.05 ? 'Mild US sell pressure'
    : 'Neutral — no CB premium';

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
  const oi1hPctStr = oi1h.pct != null ? (oi1h.pct >= 0 ? '+' : '') + oi1h.pct.toFixed(2) + '%' : '—';

  // ── Squeeze score ──
  const sq = computeSqueezeScore(d);
  const sqCol = sq.dir === 'SHORT_SQ' ? '#34d399' : sq.dir === 'LONG_LIQ' ? '#f87171' : '#606060';

  return (
    <>
      {/* Row 1: CB Premium, VWAP, OI Trend, Funding Rate */}
      <div className="edge-grid">
        <div className="edge-card">
          <div className="edge-card-label">
            <Tip text="Coinbase price minus Binance price, as a %. Positive = US retail buyers are paying a premium (bullish signal). Negative = US retail selling at a discount (bearish signal).">CB Premium</Tip>
          </div>
          <div className="edge-card-value" style={{ color: cbCol, fontSize: 15 }}>
            {cbPct != null ? (cbPct >= 0 ? '+' : '') + cbPct.toFixed(3) + '%' : '—'}
          </div>
          <div className="edge-card-signal" style={{ color: cbCol }}>{cbSig}</div>
        </div>

        <div className="edge-card">
          <div className="edge-card-label">
            <Tip text="Volume Weighted Average Price — the average price across the day, weighted by how much was traded at each level. Price above VWAP signals buy-side control; below signals sellers are in charge.">VWAP — {coin.toUpperCase()}</Tip>
          </div>
          <div className="edge-card-value" style={{ color: vwapCol, fontSize: 15 }}>
            {price != null ? '$' + fmtPrice(price, COIN_DEC[coin]) : '—'}
          </div>
          {vwap != null && (
            <div className="edge-card-sub">
              <span style={{ color: 'var(--txt3)' }}>VWAP </span>
              <span style={{ color: 'var(--txt2)', fontWeight: 600 }}>${vwap.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              {vwapPct != null && <span style={{ color: vwapCol }}> ({vwapPct >= 0 ? '+' : ''}{vwapPct.toFixed(2)}%)</span>}
            </div>
          )}
          <div className="edge-card-signal" style={{ color: vwapCol }}>
            {vwapAbove === null ? 'Calculating…' : vwapAbove ? '▲ Above VWAP — bullish' : '▼ Below VWAP — bearish'}
          </div>
        </div>

        <div className="edge-card">
          <div className="edge-card-label">
            <Tip width={260} text="Open Interest is the total number of live futures contracts. Rising OI + rising price = new longs entering (real conviction). Falling OI + rising price = shorts covering (weaker signal).">Open Interest — {coin.toUpperCase()}</Tip>
          </div>
          {oiMeta ? (
            <>
              <div className="edge-card-value" style={{ color: oiMeta.col, fontSize: 15 }}>{oiMeta.txt}</div>
              <div className="edge-card-signal" style={{ color: oiMeta.col }}>{oiMeta.sub}</div>
            </>
          ) : (
            <div className="edge-card-signal" style={{ color: 'var(--txt3)', marginTop: 4 }}>
              {d?.oi != null ? 'Flat — no strong signal' : 'Warming up…'}
            </div>
          )}
        </div>

        <div className="edge-card">
          <div className="edge-card-label">
            <Tip text="The fee longs pay shorts every 8 hours to keep perpetual futures positions open. Strongly positive means too many people are leveraged long — whales often dump price to liquidate them and pocket the fee.">Funding Rate — {coin.toUpperCase()}</Tip>
          </div>
          <div className="edge-card-value" style={{ color: frCol }}>
            {frPct != null ? (frPct >= 0 ? '+' : '') + frPct.toFixed(4) + '%' : '—'}
          </div>
          <div className="edge-card-signal" style={{ color: frCol }}>
            {frInfo ? frInfo.label : 'Loading…'}
          </div>
        </div>
      </div>

      {/* Row 2: OI 1h Change + Setup Scanner */}
      <div className="edge-grid" style={{ marginBottom: 8 }}>
        <div className="edge-card">
          <div className="edge-card-label">
            <Tip text="How much the total value of open futures positions changed in the last hour. A sharp rise means new money is entering aggressively; a sharp drop means mass liquidations or traders closing positions.">Open Interest 1h — {coin.toUpperCase()}</Tip>
          </div>
          <div className="edge-card-value" style={{ color: oi1hCol }}>
            {oi1h.loading ? '—' : oi1hPctStr}
          </div>
          <div className="edge-card-signal" style={{ color: oi1hCol }}>
            {oi1h.loading ? 'Loading…' : oi1hTxt}
          </div>
        </div>

        <div className="edge-card">
          <div className="edge-card-label">
            <Tip width={260} text="Squeeze setup score: funding rate (0–40 pts) + long/short ratio positioning (0–40 pts) + volume spike bonus (0–20 pts). LONG_LIQ = longs overcrowded, ripe for a dump. SHORT_SQ = shorts overcrowded, ripe for a pump.">Setup Scanner — {coin.toUpperCase()}</Tip>
          </div>
          <div className="edge-card-value" style={{ color: sqCol, fontSize: 15 }}>
            {sq.score}
            <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 6 }}>{sq.label}</span>
          </div>
          <div className="edge-card-signal" style={{ color: sqCol }}>
            {sq.dir === 'SHORT_SQ' ? '▲ Short squeeze setup'
             : sq.dir === 'LONG_LIQ' ? '▼ Long liquidation risk'
             : 'Balanced positioning'}
          </div>
        </div>
      </div>
    </>
  );
}


function CoinSignalsHeader() {
  const { store } = useMarket();
  return (
    <div className="dash-section dash-section-hot">
      Coin Signals — {store.selectedCoin.toUpperCase()}
    </div>
  );
}

export default function Dashboard() {
  const [showTour, setShowTour] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const isMobile = useMobile();

  const { settings } = useSettings();
  const hide = (id: string) => settings.hidden_sections.includes(id);

  const { tourPending, clearTourPending } = useOnboarding();

  // OnboardingGate flips tourPending right after a user finishes onboarding
  // (from whatever page they were on) and routes here, since the spotlight
  // tour targets dashboard-only DOM (data-spotlight-section, .mb-glow-card)
  // that doesn't exist elsewhere. Read from context, not a ?tour=1 query
  // param — the flag and this mount both land from the same finish() call,
  // so it's guaranteed visible on Dashboard's first render.
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

      <GlobalSpotlight gridRef={sidebarRef} cardSelector=".mb-glow-card" radius={260} disableAnimations={isMobile} />
      <GlobalSpotlight gridRef={mainRef} cardSelector=".mb-glow-card" radius={320} disableAnimations={isMobile} />

      {/* ── Left sticky sidebar (desktop only) ── */}
      <aside className="dash-sidebar" ref={sidebarRef}>
        <CoinSidebar />
        <MarketPulseStrip />
      </aside>

      {/* ── Main content ── */}
      <div className="dash-main" ref={mainRef}>

        {/* Mobile-only: live prices + coin signals + market pulse strip */}
        <div className="mobile-only">
          <div className="dash-section">Live prices</div>
          <Ticker />
          {!hide('coin_signals') && <>
            <CoinSignalsHeader />
            <EdgeSignals />
            <SmartMoneyScore />
          </>}
          <div className="dash-section" style={{ marginTop: 8 }}>Market pulse</div>
          <MarketPulseStrip />
        </div>

        {/* 0. Session strip */}
        <SessionCountdown />
        <SessionContext />

        {/* 1. Best Setup Today — promoted, first thing above the fold */}
        {!hide('best_setup') && (
          <div id="tour-best-setup" className="mb-glow-card" style={{ borderRadius: 10 }}>
            <div className="dash-section dash-section-hot">Best Setup Today</div>
            <SOTD />
          </div>
        )}

        {/* ── Separator ── */}
        <div className="dash-ctx-sep" />

        {/* 2. Coin signals — selected coin deep dive (desktop only; mobile renders above) */}
        {!hide('coin_signals') && (
          <div id="tour-coin-signals" className="desktop-only mb-glow-card" style={{ borderRadius: 10 }}>
            <CoinSignalsHeader />
            <EdgeSignals />
            <SmartMoneyScore />
          </div>
        )}

        {/* 3. Contextual alert banners */}
        {!hide('cascade') && <CascadeAlertBanner />}
        <SentimentExtremesAlert />

      </div>

    </div>
  );
}
