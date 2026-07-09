'use client';
import { useState, useEffect, useRef } from 'react';
import { useMarket, COINS, COIN_DEC, fmtPrice, computeCoinHealth } from '@/lib/marketStore';
import { useSettings } from '@/lib/settings';
import Ticker from '@/components/Ticker';
import FearGreed from '@/components/FearGreed';
import AltSeasonIndex from '@/components/AltSeasonIndex';
import SOTD from '@/components/SOTD';
import NewsBanner from '@/components/NewsBanner';
import SessionCountdown from '@/components/SessionCountdown';

import SentimentExtremesAlert from '@/components/SentimentExtremesAlert';
import OnboardingFlow from '@/components/OnboardingFlow';
import SpotlightTour from '@/components/SpotlightTour';
import SetupChecklist from '@/components/SetupChecklist';
import Link from 'next/link';
import WatchlistFeed from '@/components/WatchlistFeed';
import CycleDayCounter from '@/components/CycleDayCounter';
import BtcRiskLevel from '@/components/BtcRiskLevel';
import Tip from '@/components/Tip';
import CycleChart from '@/components/CycleChart';
import GexTable from '@/components/GexTable';
import MacroStrip from '@/components/MacroStrip';
import AccumulationTracker from '@/components/AccumulationTracker';
import DistributionTracker from '@/components/DistributionTracker';
import { coinBadgeColor } from '@/lib/coinBadge';
import Sparkline24h from '@/components/Sparkline24h';
import { ParticleCard, GlobalSpotlight, useMobile } from '@/components/MagicBento';


/* ── Coin Sidebar v2 — signal cards ── */
const SIDEBAR_DEFAULT = 7;

function CoinSidebar() {
  const { store, selectCoin } = useMarket();
  const isMobile = useMobile();
  const visibleCoins = COINS.slice(0, SIDEBAR_DEFAULT);

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
          else if (label)   sig = { text: label, col: 'var(--txt3)' }; // neutral: doji, consolidation, etc.
        }
        // Weak OI trends as fallback
        if (!sig && d?.oiTrend === 'weak_up')   sig = { text: 'Shorts closing (weak up)',   col: '#fbbf24' };
        if (!sig && d?.oiTrend === 'weak_down')  sig = { text: 'Buyers taking profit',       col: '#94a3b8' };
        // Last resort: show FR value if it's non-zero
        if (!sig && d?.fundingRate != null && d.fundingRate !== 0) {
          const fr = d.fundingRate * 100;
          if      (fr >= 0.05)   sig = { text: 'Funding very high',      col: '#f87171' };
          else if (fr >= 0.01)   sig = { text: 'Funding slightly high',  col: '#fca5a5' };
          else if (fr <= -0.03)  sig = { text: 'Funding very low',       col: '#34d399' };
          else if (fr <= -0.005) sig = { text: 'Funding slightly low',   col: '#86efac' };
          else                   sig = { text: 'Funding neutral',         col: 'var(--txt3)' };
        }

        // Bar color based on buy pressure
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
            {/* Top row: badge + name + health grade + price */}
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

            {/* Bottom row: change + sparkline + signal */}
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

            {/* Buy pressure bar — fills edge to edge at bottom */}
            <div className="csb2-bar-track">
              <div
                className="csb2-bar-fill"
                style={{ width: tbp + '%', background: barCol }}
              />
            </div>
          </ParticleCard>
        );
      })}

      {/* Show more → navigate to /markets */}
      <Link
        href="/markets"
        style={{
          display: 'block', width: '100%', background: 'none', border: 'none',
          borderTop: '1px solid #1a1a1a', padding: '7px 0',
          fontSize: 11, color: 'var(--txt3)', cursor: 'pointer',
          letterSpacing: '0.04em', textAlign: 'center', textDecoration: 'none',
        }}
      >
        ▼ +{COINS.length - SIDEBAR_DEFAULT} more coins
      </Link>

      {/* WS status indicator */}
      <div className="csb2-status">
        <span
          className="csb2-status-dot"
          style={{
            background: store.wsStatus.includes('REST') ? '#fb923c'
              : store.wsStatus.includes('error') || store.wsStatus.includes('Error') ? '#f87171'
              : '#34d399',
          }}
        />
        <span>{store.wsStatus.includes('REST') ? 'REST' : store.wsStatus.includes('Live') ? 'Live' : 'Connecting'}</span>
      </div>
    </div>
  );
}

/* ── Liquidation Cascade Alert Banner ── */
function CascadeAlertBanner() {
  const { store, setStore } = useMarket();
  const alert = store.cascadeAlert;

  // Auto-dismiss after 3 minutes
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

// Formerly "EdgeSignals" — the CB Premium / VWAP / OI trend / Funding / OI-1h-change /
// Setup Scanner cards this used to render were a direct duplicate of Arena's
// CoinMarketSnapshot + Squeeze Scanner for the selected coin (down to reusing the same
// component comment admitting the extraction). Arena is the single-coin deep-dive page;
// Dashboard's job is market-wide scanning, so only the genuinely unique, all-coin Taker
// Buy/Sell table stays here.
function TakerPressureTable() {
  const { store } = useMarket();
  const [takerExpanded, setTakerExpanded] = useState(false);
  const [takerSearch, setTakerSearch]     = useState('');
  const takerSearchRef = useRef<HTMLInputElement>(null);

  return (
      <div className="taker-table">
        <div className="taker-title">
          <Tip text="Shows who is placing urgent market orders — buyers hitting the ask (buying now at any price) vs sellers hitting the bid (selling now at any price). Above 60% buy takers signals strong upside pressure; below 40% means sellers are in control.">Taker Buy/Sell Pressure</Tip>
          <span className="taker-subtitle">Who&apos;s being aggressive — last 5h of 15m candles</span>
        </div>

        {/* Search bar — visible only when expanded */}
        {takerExpanded && (
          <div style={{ borderBottom: '0.5px solid var(--bdr)', padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
              <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
              <line x1="8" y1="8" x2="11" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <input
              ref={takerSearchRef}
              type="text"
              placeholder="Search coins…"
              value={takerSearch}
              onChange={e => setTakerSearch(e.target.value)}
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '8px 0', fontSize: 11, color: 'var(--txt)' }}
            />
            {takerSearch && (
              <button onClick={() => setTakerSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--txt3)', fontSize: 13, lineHeight: 1 }} aria-label="Clear search">×</button>
            )}
          </div>
        )}

        <div className="taker-hdr">
          <div>Coin</div><div>Buy/Sell split</div><div>Signal</div>
        </div>
        {(() => {
          const coinsWithData = COINS.filter(id => store.coins[id]?.takerBuyRatio != null);
          const noDataCount   = COINS.length - coinsWithData.length;
          const filtered      = takerExpanded && takerSearch
            ? coinsWithData.filter(id => id.toLowerCase().includes(takerSearch.toLowerCase()))
            : coinsWithData;
          const visibleCoins  = takerExpanded ? filtered : filtered.slice(0, 5);
          const hiddenCount   = coinsWithData.length - 5;
          return (
            <>
              <div style={takerExpanded ? { maxHeight: 300, overflowY: 'auto' } : {}}>
                {visibleCoins.length > 0 ? visibleCoins.map(id => {
                  const c = store.coins[id];
                  const ratio = c?.takerBuyRatio;
                  const buyPct  = ratio != null ? Math.round(ratio * 100) : null;
                  const sellPct = buyPct != null ? 100 - buyPct : null;

                  const isAggBuy   = buyPct != null && buyPct >= 65;
                  const isMildBuy  = buyPct != null && buyPct >= 55 && buyPct < 65;
                  const isAggSell  = buyPct != null && buyPct <= 35;
                  const isMildSell = buyPct != null && buyPct > 35 && buyPct <= 45;

                  const sigTxt = buyPct == null  ? '—'
                    : isAggBuy   ? `${buyPct}% buyers ▲`
                    : isMildBuy  ? `${buyPct}% mild buy`
                    : isAggSell  ? `${sellPct}% sellers ▼`
                    : isMildSell ? `${sellPct}% mild sell`
                    : '—';

                  const sigCol = buyPct == null ? 'var(--txt3)'
                    : isAggBuy   ? '#34d399'
                    : isMildBuy  ? '#86efac'
                    : isAggSell  ? '#f87171'
                    : isMildSell ? '#fca5a5'
                    : 'var(--txt3)';

                  const badgeCol = coinBadgeColor(id);
                  return (
                    <div key={id} className="taker-row">
                      <div className="taker-coin" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: badgeCol, flexShrink: 0 }} />
                        {id.toUpperCase()}
                      </div>
                      <div className="taker-bar-wrap">
                        {buyPct != null ? (
                          <>
                            <div className="taker-buy-bar" style={{ width: `${buyPct}%` }} />
                            <div className="taker-mid-line" />
                          </>
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--txt2)', paddingLeft: 6 }}>Fetching…</span>
                        )}
                      </div>
                      <div className="taker-signal" style={{ color: sigCol }}>{sigTxt}</div>
                    </div>
                  );
                }) : (
                  <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--txt3)' }}>No coins match &ldquo;{takerSearch}&rdquo;</div>
                )}
              </div>
              <button
                onClick={() => {
                  setTakerExpanded(v => {
                    if (v) setTakerSearch('');
                    return !v;
                  });
                  if (!takerExpanded) setTimeout(() => takerSearchRef.current?.focus(), 60);
                }}
                style={{
                  width: '100%', padding: '9px 0', background: 'none', border: 'none',
                  borderTop: '0.5px solid var(--bdr)', cursor: 'pointer',
                  fontSize: 11, color: 'var(--txt3)', fontWeight: 600,
                  letterSpacing: '.03em', transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--txt)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--txt3)')}
              >
                {takerExpanded
                  ? 'Show less ▲'
                  : `Show all ${coinsWithData.length} coins ▼`}
              </button>
              {noDataCount > 0 && !takerExpanded && (
                <div style={{ fontSize: 11, color: 'var(--txt2)', padding: '6px 10px', borderTop: '0.5px solid var(--bdr)' }}>
                  +{noDataCount} coins without taker data (Bybit-only)
                </div>
              )}
            </>
          );
        })()}
      </div>
  );
}



function BTCDominance() {
  const { store } = useMarket();
  const dom = store.btcDom;
  return (
    <div className="ind-card">
      <div className="ind-label">BTC Dominance</div>
      <div className="ind-value">{dom != null ? dom.toFixed(2) + '%' : '---%'}</div>
      <div className="ind-note">
        {dom == null ? 'Loading...'
          : dom >= 60 ? 'High dominance — alts bleeding.'
          : dom >= 55 ? 'Elevated — BTC leading.'
          : dom >= 48 ? 'Normal range. Mixed market.'
          : 'Low — alt season possible.'}
      </div>
    </div>
  );
}

/* ── Dynamic section header for selected coin ── */
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

  return (
    <div className="dashboard-grid" data-spotlight-section>
      <OnboardingFlow onStartTour={() => setShowTour(true)} />
      {showTour && <SpotlightTour onDone={() => setShowTour(false)} />}
      <SetupChecklist />

      <GlobalSpotlight gridRef={sidebarRef} cardSelector=".mb-glow-card" radius={260} disableAnimations={isMobile} />
      <GlobalSpotlight gridRef={mainRef} cardSelector=".mb-glow-card" radius={320} disableAnimations={isMobile} />

      {/* ── Left sticky sidebar (desktop only) ── */}
      <aside className="dash-sidebar" ref={sidebarRef}>
        <CoinSidebar />
        <ParticleCard className="ind-row mb-glow-card" style={{ margin: 0 }} disableAnimations={isMobile} particleCount={6} clickEffect={false}><FearGreed /></ParticleCard>
        <ParticleCard className="ind-row mb-glow-card" style={{ margin: 0 }} disableAnimations={isMobile} particleCount={6} clickEffect={false}><BTCDominance /></ParticleCard>
        <ParticleCard className="ind-row mb-glow-card" style={{ margin: 0 }} disableAnimations={isMobile} particleCount={6} clickEffect={false}><AltSeasonIndex /></ParticleCard>
      </aside>

      {/* ── Main content ── */}
      <div className="dash-main" ref={mainRef}>



        {/* Mobile-only ticker + coin signals + market indicators (desktop shows in sidebar) */}
        <div className="mobile-only">
          <div className="dash-section">Live prices</div>
          <Ticker />
          {/* Coin Signals immediately below Live Prices on mobile/tablet so selecting a coin shows signals without scrolling */}
          {!hide('coin_signals') && <>
            <CoinSignalsHeader />
            <TakerPressureTable />
          </>}
          <div className="dash-section">Market indicators</div>
          <div className="ind-row"><FearGreed /></div>
          <div className="ind-row"><BTCDominance /></div>
          <div className="ind-row"><AltSeasonIndex /></div>
        </div>

        {/* 0. Market session indicator — right rail on desktop, inline on mobile */}
        <div className="mobile-only">
          <SessionCountdown />
        </div>

        {/* 0.5 Watchlist feed */}
        <div className="desktop-only mb-glow-card" style={{ borderRadius: 10 }}>
          <div className="dash-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>My Watchlist</span>
            <a href="/settings" style={{ fontSize: 10, color: 'var(--txt3)', textDecoration: 'none', fontWeight: 500 }}>Edit →</a>
          </div>
          <WatchlistFeed />
        </div>

        {/* 0.6 + 0.7 Accumulation + Distribution stacked */}
        {(!hide('accumulation') || !hide('distribution')) && (
          <div className="mb-glow-card" style={{ borderRadius: 10 }}>
            {!hide('accumulation') && <AccumulationTracker />}
            {!hide('distribution') && <DistributionTracker />}
          </div>
        )}

        {/* 1. Coin signals — first thing traders look at after selecting a coin (desktop only; mobile renders above) */}
        {!hide('coin_signals') && <div id="tour-coin-signals" className="desktop-only mb-glow-card" style={{ borderRadius: 10 }}>
          <CoinSignalsHeader />
          <TakerPressureTable />
        </div>}

        {/* 2. Contextual alert banners */}
        {!hide('cascade') && <CascadeAlertBanner />}
        <SentimentExtremesAlert />

        {/* ── Context divider ── */}
        <div className="dash-ctx-sep" />

        {/* Catalysts & market events */}
        {!hide('catalysts') && <NewsBanner />}

        {/* Trading Playbook — always visible */}
        {!hide('best_setup') && <div id="tour-best-setup" className="mb-glow-card" style={{ borderRadius: 10 }}>
          <div className="dash-section">Trading Playbook</div>
          <SOTD />
        </div>}

        {/* Market Context */}
        <div className="dash-section" style={{ marginTop: 8 }}>Market Context</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div className="mb-glow-card" style={{ borderRadius: 10 }}><CycleDayCounter /></div>
          <div className="mb-glow-card" style={{ borderRadius: 10 }}><BtcRiskLevel /></div>
        </div>
        <div className="mb-glow-card" style={{ borderRadius: 10 }}><CycleChart /></div>
        {!hide('gex') && <div className="mb-glow-card" style={{ borderRadius: 10 }}><GexTable /></div>}
        {!hide('macro') && <MacroStrip />}

      </div>

      {/* ── Right rail (desktop only) ── */}
      <aside className="dash-right">
        <SessionCountdown />
      </aside>

    </div>
  );
}
