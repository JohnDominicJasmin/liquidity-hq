'use client';
import { useState, useEffect, useRef } from 'react';
import { useMarket, COINS, COIN_DEC, fmtPrice, computeCoinHealth, classifyFunding, computeSqueezeScore, BYBIT_SYMS, fmtOI, fmtChg } from '@/lib/marketStore';
import { useOI1h, oi1hSignal } from '@/lib/useOI1h';
import { useSettings } from '@/lib/settings';
import Ticker from '@/components/Ticker';
import FearGreed from '@/components/FearGreed';
import AltSeasonIndex from '@/components/AltSeasonIndex';
import SOTD from '@/components/SOTD';
import NewsBanner from '@/components/NewsBanner';
import SessionCountdown from '@/components/SessionCountdown';
import SessionContext from '@/components/SessionContext';
import SmartMoneyScore from '@/components/SmartMoneyScore';
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

const OI_TREND_META: Record<string, { txt: string; sub: string; col: string }> = {
  strong_up:   { txt: '▲ New buyers opening', sub: 'Open interest rising with price — real trend', col: '#34d399' },
  strong_down: { txt: '▼ New sellers opening', sub: 'Open interest rising as price falls — real dump', col: '#f87171' },
  weak_up:     { txt: '△ Short covering',      sub: 'Open interest falling as price rises — weak pump', col: '#fbbf24' },
  weak_down:   { txt: '▽ Long exits',           sub: 'Open interest falling with price — no panic',      col: '#94a3b8' },
};


/* ── Coin Sidebar v2 — signal cards ── */
const SIDEBAR_DEFAULT = 7;

function CoinSidebar() {
  const { store, selectCoin } = useMarket();
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
          <div
            key={id}
            className={`csb2-card${sel ? ' csb2-sel' : ''}`}
            onClick={() => selectCoin(id)}
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
          </div>
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

function EdgeSignals() {
  const { store } = useMarket();
  const coin = store.selectedCoin;
  const d    = store.coins[coin];
  const oi1h = useOI1h(coin);
  const [takerExpanded, setTakerExpanded] = useState(false);
  const [takerSearch, setTakerSearch]     = useState('');
  const takerSearchRef = useRef<HTMLInputElement>(null);

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

  // ── Squeeze score for selected coin ──
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

      {/* Row 2: OI 1h Change + Setup Scanner (squeeze) for selected coin */}
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

      {/* Row 3: Taker Buy/Sell table (all-coin) */}
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
    </>
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
  const [marketCtxOpen, setMarketCtxOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [showTour, setShowTour]         = useState(false);

  const { settings, update } = useSettings();
  const hide = (id: string) => settings.hidden_sections.includes(id);
  const beginnerMode = settings.beginner_mode;

  return (
    <div className="dashboard-grid">
      <OnboardingFlow onStartTour={() => setShowTour(true)} />
      {showTour && <SpotlightTour onDone={() => setShowTour(false)} />}
      <SetupChecklist />

      {/* ── Left sticky sidebar (desktop only) ── */}
      <aside className="dash-sidebar">
        <CoinSidebar />
        <div className="ind-row" style={{ margin: 0 }}><FearGreed /></div>
        <div className="ind-row" style={{ margin: 0 }}><BTCDominance /></div>
        <div className="ind-row" style={{ margin: 0 }}><AltSeasonIndex /></div>
      </aside>

      {/* ── Main content ── */}
      <div className="dash-main">
        {/* First-time Beginner Mode banner */}
        {beginnerMode && !bannerDismissed && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'rgba(52,211,153,0.08)', border: '0.5px solid rgba(52,211,153,0.25)',
            borderRadius: 10, padding: '8px 12px', marginBottom: 10, gap: 10,
          }}>
            <span style={{ fontSize: 11, color: '#34d399', lineHeight: 1.5 }}>
              <strong>Beginner Mode is on</strong> — advanced panels are hidden to keep things simple.
              Turn it off below to see GEX, Macro Correlations, and Cycle charts.
            </span>
            <button
              onClick={() => setBannerDismissed(true)}
              style={{ background: 'none', border: 'none', color: '#34d399', cursor: 'pointer', fontSize: 14, padding: '0 4px', flexShrink: 0 }}
            >✕</button>
          </div>
        )}


        {/* Mobile-only ticker + coin signals + market indicators (desktop shows in sidebar) */}
        <div className="mobile-only">
          <div className="dash-section">Live prices</div>
          <Ticker />
          {/* Coin Signals immediately below Live Prices on mobile/tablet so selecting a coin shows signals without scrolling */}
          {!hide('coin_signals') && <>
            <CoinSignalsHeader />
            <EdgeSignals />
            <SmartMoneyScore />
          </>}
          <div className="dash-section">Market indicators</div>
          <div className="ind-row"><FearGreed /></div>
          <div className="ind-row"><BTCDominance /></div>
          <div className="ind-row"><AltSeasonIndex /></div>
        </div>

        {/* 0. Market session indicator — always visible at the top */}
        <SessionCountdown />
        <SessionContext />

        {/* 0.5 Watchlist feed */}
        <div className="desktop-only">
          <div className="dash-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>My Watchlist</span>
            <a href="/settings" style={{ fontSize: 10, color: 'var(--txt3)', textDecoration: 'none', fontWeight: 500 }}>Edit →</a>
          </div>
          <WatchlistFeed />
        </div>

        {/* 0.6 Accumulation Tracker — quiet coins being loaded before the move */}
        {!hide('accumulation') && <AccumulationTracker />}

        {/* 0.7 Distribution Tracker — the mirror: big players taking profit into strength */}
        {!hide('distribution') && <DistributionTracker />}

        {/* 1. Coin signals — first thing traders look at after selecting a coin (desktop only; mobile renders above) */}
        {!hide('coin_signals') && <div id="tour-coin-signals" className="desktop-only">
          <CoinSignalsHeader />
          <EdgeSignals />
          <SmartMoneyScore />
        </div>}

        {/* 2. Contextual alert banners */}
        {!hide('cascade') && <CascadeAlertBanner />}
        <SentimentExtremesAlert />

        {/* 3. Market Context — collapsible so it doesn't bury coin signals */}
        <div
          className="dash-section desktop-only"
          style={{ cursor: 'pointer', userSelect: 'none', marginTop: 4 }}
          onClick={() => setMarketCtxOpen(o => !o)}
        >
          Market Context
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--txt3)', letterSpacing: 0 }}>
            {marketCtxOpen ? '▲ hide' : '▼ show'}
          </span>
        </div>
        {marketCtxOpen && (
          <div className="desktop-only">
            {!hide('best_setup') && <div id="tour-best-setup">
              <div className="dash-section dash-section-hot">Best Setup Today</div>
              <SOTD />
            </div>}
          </div>
        )}

        {/* SOTD always visible on mobile (no collapsible there) */}
        <div className="mobile-only">
          {!hide('best_setup') && <div>
            <div className="dash-section dash-section-hot">Best Setup Today</div>
            <SOTD />
          </div>}
        </div>

        {/* ── Context divider ── */}
        <div className="dash-ctx-sep" />

        {/* 6. Catalysts & market events */}
        {!hide('catalysts') && <NewsBanner />}

        {/* 7. Market Context — Cycle, BTC Risk, GEX, Macro */}
        <div className="dash-section" style={{ marginTop: 8 }}>Market Context</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <CycleDayCounter />
          <BtcRiskLevel />
        </div>
        <CycleChart />
        {!hide('gex') && <GexTable />}
        {!hide('macro') && <MacroStrip />}

      </div>

      {/* ── Right rail (desktop only) — reserved for future content ── */}
      <aside className="dash-right" />

    </div>
  );
}
