'use client';
import { useState, useEffect, useRef } from 'react';
import { useMarket, COINS, BYBIT_SYMS, COIN_DEC, fmtPrice, fmtChg, fmtOI, classifyFunding, computeSqueezeScore } from '@/lib/marketStore';
import { useOI1h, oi1hSignal } from '@/lib/useOI1h';
import { useSettings } from '@/lib/settings';
import Ticker from '@/components/Ticker';
import FearGreed from '@/components/FearGreed';
import AltSeasonIndex from '@/components/AltSeasonIndex';
import RaidMeter from '@/components/RaidMeter';
import SOTD from '@/components/SOTD';
import NewsBanner from '@/components/NewsBanner';
import SessionContext from '@/components/SessionContext';
import SmartMoneyScore from '@/components/SmartMoneyScore';
import OISpikeScanner from '@/components/OISpikeScanner';
import SentimentExtremesAlert from '@/components/SentimentExtremesAlert';

function MacroStrip() {
  const { store } = useMarket();
  const items = [
    {
      label: 'DXY',
      price: store.dxy,
      chg: store.dxyChg,
      fmt: (v: number) => v.toFixed(2),
      // DXY UP = bad for BTC (dollar strengthens = risk off)
      signal: (chg: number) => chg > 0.2 ? { txt: 'USD strength → BTC headwind', col: 'var(--red)' }
                              : chg < -0.2 ? { txt: 'USD weakness → BTC tailwind', col: 'var(--green)' }
                              : { txt: 'Neutral', col: 'var(--txt3)' },
    },
    {
      label: 'SPX',
      price: store.spx,
      chg: store.spxChg,
      fmt: (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
      // SPX UP = risk-on = good for BTC
      signal: (chg: number) => chg > 0.3 ? { txt: 'Risk-on → crypto tailwind', col: 'var(--green)' }
                              : chg < -0.5 ? { txt: 'Risk-off → crypto headwind', col: 'var(--red)' }
                              : { txt: 'Neutral', col: 'var(--txt3)' },
    },
    {
      label: 'Gold',
      price: store.gold,
      chg: store.goldChg,
      fmt: (v: number) => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
      // Gold UP = safe haven demand = mild risk-off
      signal: (chg: number) => chg > 0.5 ? { txt: 'Safe haven bid → mild risk-off', col: 'var(--amber)' }
                              : chg < -0.5 ? { txt: 'Gold falling → risk appetite up', col: 'var(--green)' }
                              : { txt: 'Neutral', col: 'var(--txt3)' },
    },
  ];

  return (
    <div className="macro-strip">
      <div className="macro-strip-title">Macro Correlations</div>
      <div className="macro-strip-row">
        {items.map(({ label, price, chg, fmt, signal }) => {
          const sig = chg != null ? signal(chg) : null;
          return (
            <div key={label} className="macro-item">
              <div className="macro-item-label">{label}</div>
              <div className="macro-item-price">
                {price != null ? fmt(price) : '—'}
              </div>
              <div className="macro-item-chg" style={{
                color: chg == null ? 'var(--txt3)' : chg >= 0 ? 'var(--green)' : 'var(--red)',
              }}>
                {chg != null ? (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%' : '—'}
              </div>
              {sig && (
                <div className="macro-item-signal" style={{ color: sig.col }}>{sig.txt}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const OI_TREND_META: Record<string, { txt: string; sub: string; hint: string; col: string }> = {
  strong_up:   { txt: '▲ ↑OI ↑P', sub: 'New longs — real trend',  hint: 'New money entering longs. Trend has conviction — follow it.',      col: '#34d399' },
  strong_down: { txt: '▼ ↑OI ↓P', sub: 'New shorts — real dump',  hint: 'Fresh shorts being added. Real downtrend — not a dip to buy.',     col: '#f87171' },
  weak_up:     { txt: '△ ↓OI ↑P', sub: 'Short covering — weak',   hint: 'Shorts exiting, not new longs. Fake pump — no fresh conviction.',  col: '#fbbf24' },
  weak_down:   { txt: '▽ ↓OI ↓P', sub: 'Long exits — no panic',   hint: 'Longs taking profit/exiting. Not new shorts — capitulation risk.', col: '#94a3b8' },
};

/* ── Coin Sidebar v2 — signal cards ── */
function CoinSidebar() {
  const { store, selectCoin } = useMarket();

  return (
    <div className="csb2-container">
      {COINS.map(id => {
        const d   = store.coins[id];
        const dec = COIN_DEC[id];
        const chg = d?.change ?? 0;
        const up  = chg >= 0;
        const sel = store.selectedCoin === id;
        const tbp = d?.takerBuyRatio != null ? Math.round(d.takerBuyRatio * 100) : 50;

        // ── Single priority signal ──
        let sig: { text: string; col: string } | null = null;
        if (d?.fundingRate != null) {
          const fr = d.fundingRate * 100;
          if (fr >= 0.04)       sig = { text: 'Longs overcrowded', col: '#f87171' };
          else if (fr <= -0.02) sig = { text: 'Shorts squeezed',   col: '#34d399' };
        }
        if (!sig && d?.cvdDivergence === 'bullish') sig = { text: 'CVD bull div',  col: '#34d399' };
        if (!sig && d?.cvdDivergence === 'bearish') sig = { text: 'CVD bear div',  col: '#f87171' };
        if (!sig && d?.oiTrend === 'strong_up')     sig = { text: 'OI + new longs',  col: '#34d399' };
        if (!sig && d?.oiTrend === 'strong_down')   sig = { text: 'OI + new shorts', col: '#f87171' };
        if (!sig && d?.chartPattern) {
          const isBull = /bull|higher high|engulf.*bull|hammer(?! man)|double bot/i.test(d.chartPattern);
          const isBear = /bear|lower high|engulf.*bear|shooting|double top/i.test(d.chartPattern);
          const label  = d.chartPattern.split(';')[0].split('(')[0].trim();
          if (isBull)       sig = { text: label, col: '#34d399' };
          else if (isBear)  sig = { text: label, col: '#f87171' };
          else if (label)   sig = { text: label, col: 'var(--txt3)' }; // neutral: doji, consolidation, etc.
        }
        // Weak OI trends as fallback
        if (!sig && d?.oiTrend === 'weak_up')   sig = { text: 'Short covering',   col: '#fbbf24' };
        if (!sig && d?.oiTrend === 'weak_down')  sig = { text: 'Long exits',       col: '#94a3b8' };
        // Last resort: show FR value if it's non-zero
        if (!sig && d?.fundingRate != null && d.fundingRate !== 0) {
          const fr = d.fundingRate * 100;
          sig = { text: (fr >= 0 ? '+' : '') + fr.toFixed(4) + '% FR', col: 'var(--txt3)' };
        }

        // Bar color based on buy pressure
        const barCol = tbp >= 60 ? '#34d399' : tbp <= 40 ? '#f87171' : '#404040';

        return (
          <div
            key={id}
            className={`csb2-card${sel ? ' csb2-sel' : ''}`}
            onClick={() => selectCoin(id)}
          >
            {/* Top row: name + price */}
            <div className="csb2-top">
              <span className="csb2-name">{id.toUpperCase()}</span>
              <span className="csb2-price">
                {d?.price ? '$' + fmtPrice(d.price, dec) : '—'}
              </span>
            </div>

            {/* Bottom row: change + signal */}
            <div className="csb2-bottom">
              <span className={`csb2-chg ${up ? 'chg-up' : 'chg-dn'}`}>
                {up ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%
              </span>
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
          ⚡ {alert.coin} — {label}
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
  const coin = store.coins[store.selectedCoin];
  const [tipOpen, setTipOpen] = useState(false);
  const oi1h  = useOI1h(store.selectedCoin);
  const sq    = computeSqueezeScore(coin);
  const tipRef = useRef<HTMLDivElement>(null);

  /* ── Close OI tooltip on outside tap / click (mobile-friendly) ── */
  useEffect(() => {
    if (!tipOpen) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (tipRef.current && !tipRef.current.contains(e.target as Node)) {
        setTipOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close as EventListener, { passive: true });
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close as EventListener);
    };
  }, [tipOpen]);

  /* ── Coinbase Premium ── */
  const cbAmt = store.cbPremium;
  const cbPct = store.cbPremiumPct;
  const cbCol  = cbPct == null ? 'var(--txt3)' : cbPct > 0.02 ? 'var(--green)' : cbPct < -0.02 ? 'var(--red)' : 'var(--txt2)';
  const cbBdr  = cbPct == null ? 'var(--bdr)'  : cbPct > 0.05 ? 'var(--green-bdr)' : cbPct < -0.05 ? 'var(--red-bdr)' : 'var(--bdr)';
  const cbSig  = cbPct == null ? 'Loading…'
               : cbPct > 0.05  ? '🇺🇸 US institutional buying'
               : cbPct > 0.01  ? 'CB slight premium'
               : cbPct < -0.05 ? 'US selling — CB discount'
               : cbPct < -0.01 ? 'CB slight discount'
               : 'Neutral spread';

  /* ── VWAP ── */
  const vwap  = coin?.vwap;
  const price = coin?.price;
  const vwapAbove = vwap != null && price != null ? price > vwap : null;
  const vwapPct   = vwap && price ? ((price - vwap) / vwap) * 100 : null;
  const vwapCol   = vwapAbove === null ? 'var(--txt3)' : vwapAbove ? 'var(--green)' : 'var(--red)';
  const vwapBdr   = vwapAbove === null ? 'var(--bdr)' : vwapAbove ? 'var(--green-bdr)' : 'var(--red-bdr)';

  /* ── OI Trend (selected coin) ── */
  const oiMeta  = coin?.oiTrend ? OI_TREND_META[coin.oiTrend] : null;
  const hasPerp = store.selectedCoin in BYBIT_SYMS;
  const oiBdr   = oiMeta ? oiMeta.col + '44' : 'var(--bdr)';

  return (
    <>
      {/* Row 1: CB Premium + VWAP */}
      <div className="edge-grid">
        <div className="edge-card" style={{ borderColor: cbBdr }}>
          <div className="edge-card-label">Coinbase Premium</div>
          <div className="edge-card-value" style={{ color: cbCol }}>
            {cbAmt != null
              ? (cbAmt >= 0 ? '+$' : '−$') + Math.abs(cbAmt).toFixed(1)
              : '—'}
          </div>
          {cbPct != null && (
            <div className="edge-card-sub" style={{ color: cbCol }}>
              {(cbPct >= 0 ? '+' : '') + cbPct.toFixed(3) + '%'}
            </div>
          )}
          <div className="edge-card-signal" style={{ color: cbCol }}>{cbSig}</div>
        </div>

        <div className="edge-card" style={{ borderColor: vwapBdr }}>
          <div className="edge-card-label">VWAP · {store.selectedCoin.toUpperCase()}</div>
          {/* Show LIVE price as the hero number */}
          <div className="edge-card-value" style={{ color: vwapCol, fontSize: 15 }}>
            {price != null
              ? '$' + fmtPrice(price, COIN_DEC[store.selectedCoin])
              : '—'}
          </div>
          {/* VWAP reference line */}
          {vwap != null && (
            <div className="edge-card-sub">
              <span style={{ color: 'var(--txt3)' }}>VWAP </span>
              <span style={{ color: 'var(--txt2)', fontWeight: 600 }}>
                ${vwap.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
              {vwapPct != null && (
                <span style={{ color: vwapCol }}>
                  {' '}({vwapPct >= 0 ? '+' : ''}{vwapPct.toFixed(2)}%)
                </span>
              )}
            </div>
          )}
          <div className="edge-card-signal" style={{ color: vwapCol }}>
            {vwapAbove === null ? 'Calculating…' : vwapAbove ? '▲ Above VWAP — bullish' : '▼ Below VWAP — bearish'}
          </div>
        </div>

        {/* OI Trend — selected coin */}
        <div ref={tipRef} className="edge-card" style={{ borderColor: oiBdr }}>
          <div className="edge-card-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            OI · {store.selectedCoin.toUpperCase()}
            <span
              className="oi-info-icon"
              onClick={e => { e.stopPropagation(); setTipOpen(o => !o); }}
            >ⓘ</span>
          </div>
          {oiMeta ? (
            <>
              <div className="edge-card-value" style={{ color: oiMeta.col }}>{oiMeta.txt}</div>
              <div className="edge-card-signal" style={{ color: oiMeta.col }}>{oiMeta.sub}</div>
            </>
          ) : (
            <div className="edge-card-signal" style={{ color: 'var(--txt3)', marginTop: 4 }}>
              {!hasPerp ? 'No perp data' : 'Warming up…'}
            </div>
          )}
          {tipOpen && (
            <div className="oi-inline-tip">
              <div className="oi-tip-row"><span className="oi-tip-badge tip-green">▲ ↑OI ↑P</span><span>New longs — real trend</span></div>
              <div className="oi-tip-row"><span className="oi-tip-badge tip-red">▼ ↑OI ↓P</span><span>New shorts — real dump</span></div>
              <div className="oi-tip-row"><span className="oi-tip-badge tip-weak-up">△ ↓OI ↑P</span><span>Short covering — fake pump</span></div>
              <div className="oi-tip-row"><span className="oi-tip-badge tip-weak-down">▽ ↓OI ↓P</span><span>Long exits — no panic</span></div>
            </div>
          )}
        </div>

        {/* Funding Rate + Next FR Estimate */}
        {(() => {
          const fr      = coin?.fundingRate;
          const nextFr  = coin?.nextFrEstimate;
          const nextFt  = coin?.nextFundingTime;
          const frPct   = fr   != null ? fr   * 100 : null;
          const nfrPct  = nextFr != null ? nextFr * 100 : null;

          const frCol = frPct == null ? 'var(--txt3)'
            : frPct >= 0.05  ? '#f87171'
            : frPct >= 0.01  ? '#fca5a5'
            : frPct <= -0.03 ? '#34d399'
            : frPct <= -0.005? '#86efac'
            : 'var(--txt2)';
          const frBdr = frPct == null ? 'var(--bdr)'
            : frPct >= 0.05  ? 'rgba(248,113,113,0.3)'
            : frPct <= -0.03 ? 'rgba(52,211,153,0.3)'
            : 'var(--bdr)';
          const frSig = frPct == null ? 'Loading…'
            : frPct >= 0.05  ? 'Longs overcrowded ↓'
            : frPct >= 0.01  ? 'Mild long bias'
            : frPct <= -0.03 ? 'Shorts overcrowded ↑'
            : frPct <= -0.005? 'Mild short bias'
            : 'Neutral';

          // Countdown to next settlement
          let countdown = '';
          if (nextFt && nextFt > Date.now()) {
            const diff = nextFt - Date.now();
            const hh   = Math.floor(diff / 3_600_000);
            const mm   = Math.floor((diff % 3_600_000) / 60_000);
            countdown  = `${hh}h ${mm.toString().padStart(2, '0')}m`;
          }

          const nfrCol = nfrPct == null ? 'var(--txt3)'
            : nfrPct >= 0.01  ? '#f87171'
            : nfrPct <= -0.005? '#34d399'
            : 'var(--txt3)';

          const trend = (nfrPct != null && frPct != null)
            ? (nfrPct > frPct + 0.0002 ? '↑' : nfrPct < frPct - 0.0002 ? '↓' : '→')
            : null;
          const trendCol = trend === '↑' ? '#f87171' : trend === '↓' ? '#34d399' : 'var(--txt3)';

          return (
            <div className="edge-card" style={{ borderColor: frBdr }}>
              <div className="edge-card-label">Funding · {store.selectedCoin.toUpperCase()}</div>
              <div className="edge-card-value" style={{ color: frCol }}>
                {frPct != null ? (frPct >= 0 ? '+' : '') + frPct.toFixed(4) + '%' : '—'}
              </div>
              {nfrPct != null && (
                <div className="edge-card-sub">
                  <span style={{ color: 'var(--txt3)' }}>est next </span>
                  <span style={{ color: nfrCol, fontWeight: 600 }}>
                    {(nfrPct >= 0 ? '+' : '') + nfrPct.toFixed(4) + '%'}
                  </span>
                  {trend && (
                    <span style={{ color: trendCol, marginLeft: 3 }}>{trend}</span>
                  )}
                </div>
              )}
              {countdown && (
                <div className="edge-card-sub" style={{ color: 'var(--txt3)' }}>
                  settles in {countdown}
                </div>
              )}
              <div className="edge-card-signal" style={{ color: frCol }}>{frSig}</div>
            </div>
          );
        })()}
      </div>

      {/* Row 3: OI 1h Change + Setup Scanner */}
      {(() => {
        /* ── OI 1h Change ── */
        const { txt: oi1hTxt, col: oi1hCol } = oi1hSignal(oi1h.pct, coin?.oiTrend);
        const oi1hPctStr = oi1h.pct != null
          ? (oi1h.pct >= 0 ? '+' : '') + oi1h.pct.toFixed(2) + '%'
          : '—';
        const oi1hBdr = oi1h.pct == null ? 'var(--bdr)'
          : oi1h.pct >= 10  ? 'var(--green-bdr)'
          : oi1h.pct <= -10 ? 'var(--red-bdr)'
          : 'var(--bdr)';

        const oi1hUsdStr = oi1h.oiUsd != null
          ? oi1h.oiUsd >= 1e9 ? '$' + (oi1h.oiUsd / 1e9).toFixed(2) + 'B'
          : oi1h.oiUsd >= 1e6 ? '$' + (oi1h.oiUsd / 1e6).toFixed(1) + 'M'
          : '$' + oi1h.oiUsd.toFixed(0)
          : null;

        /* ── Setup Scanner ── */
        const sqCol = sq.dir === 'LONG_LIQ' ? '#f87171'
          : sq.dir === 'SHORT_SQ'           ? '#34d399'
          : 'var(--txt3)';
        const sqBdr = sq.dir === 'LONG_LIQ' ? 'var(--red-bdr)'
          : sq.dir === 'SHORT_SQ'           ? 'var(--green-bdr)'
          : 'var(--bdr)';

        return (
          <div className="edge-grid">
            {/* OI 1h Change */}
            <div className="edge-card" style={{ borderColor: oi1hBdr }}>
              <div className="edge-card-label">OI 1h · {store.selectedCoin.toUpperCase()}</div>
              <div className="edge-card-value" style={{ color: oi1hCol }}>
                {oi1h.loading ? '—' : oi1hPctStr}
              </div>
              {oi1hUsdStr && (
                <div className="edge-card-sub" style={{ color: 'var(--txt3)' }}>{oi1hUsdStr}</div>
              )}
              <div className="edge-card-signal" style={{ color: oi1hCol }}>
                {oi1h.loading ? 'Loading…' : oi1hTxt}
              </div>
            </div>

            {/* Setup Scanner */}
            <div className="edge-card" style={{ borderColor: sqBdr }}>
              <div className="edge-card-label">Setup Scanner · {store.selectedCoin.toUpperCase()}</div>
              <div className="edge-card-value" style={{ color: sqCol }}>
                {sq.score}<span style={{ fontSize: 11, color: 'var(--txt3)', fontWeight: 400 }}>/100</span>
              </div>
              <div className="edge-card-signal" style={{ color: sqCol }}>{sq.label}</div>
            </div>
          </div>
        );
      })()}

      {/* Row 4: Taker Buy/Sell ratio table */}
      <div className="taker-table">
        <div className="taker-title">
          Taker Buy/Sell Pressure
          <span className="taker-subtitle">Who&apos;s being aggressive — last 5h of 15m candles</span>
        </div>
        <div className="taker-hdr">
          <div>Coin</div><div>Buy/Sell split</div><div>Signal</div>
        </div>
        {COINS.map(id => {
          const c = store.coins[id];
          const ratio = c?.takerBuyRatio;   // 0.0–1.0
          const buyPct  = ratio != null ? Math.round(ratio * 100) : null;
          const sellPct = buyPct != null ? 100 - buyPct : null;

          const isAggBuy  = buyPct != null && buyPct >= 65;
          const isMildBuy = buyPct != null && buyPct >= 55 && buyPct < 65;
          const isAggSell = buyPct != null && buyPct <= 35;
          const isMildSell = buyPct != null && buyPct > 35 && buyPct <= 45;
          const isBalanced = buyPct != null && buyPct > 45 && buyPct < 55;

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

          return (
            <div key={id} className="taker-row">
              <div className="taker-coin">{id.toUpperCase()}</div>
              <div className="taker-bar-wrap">
                {buyPct != null ? (
                  <>
                    <div
                      className="taker-buy-bar"
                      style={{ width: `${buyPct}%` }}
                    />
                    <div className="taker-mid-line" />
                  </>
                ) : (
                  <span style={{ fontSize: 10, color: '#333', paddingLeft: 6 }}>Fetching…</span>
                )}
              </div>
              <div className="taker-signal" style={{ color: sigCol }}>{sigTxt}</div>
            </div>
          );
        })}
      </div>

    </>
  );
}

/* ── GEX Table component ── */
function fmtGex(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '−';
  if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(0) + 'M';
  return sign + '$' + abs.toFixed(0);
}

function GexTable() {
  const { store } = useMarket();
  const { btcNetGex, btcGexFlip, btcGexLevels, btcMaxPain } = store;

  const gexLoaded = btcNetGex !== null && btcGexLevels.length > 0;
  const isLongGamma = (btcNetGex ?? 0) >= 0;

  const gexCol     = isLongGamma ? '#34d399' : '#f87171';
  const gexBg      = isLongGamma ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)';
  const gexBorder  = isLongGamma ? 'rgba(52,211,153,0.3)'  : 'rgba(248,113,113,0.3)';

  const maxAbsGex = btcGexLevels.length
    ? Math.max(...btcGexLevels.map(l => Math.abs(l.gex)))
    : 1;

  const spotPrice = store.coins.btc?.price ?? 0;

  return (
    <div className="gex-table">
      {/* Title + net GEX chip */}
      <div className="gex-title-row">
        <div className="gex-title">🔬 BTC Gamma Exposure (GEX)</div>
        {gexLoaded ? (
          <div
            className="gex-net-chip"
            style={{ color: gexCol, background: gexBg, border: `0.5px solid ${gexBorder}` }}
          >
            {fmtGex(btcNetGex!)} net
          </div>
        ) : (
          <div className="gex-net-chip" style={{ color: '#333', background: 'transparent' }}>Fetching…</div>
        )}
        {btcMaxPain != null && (
          <div className="gex-meta">Max pain: ${btcMaxPain.toLocaleString()}</div>
        )}
      </div>

      {/* Signal interpretation */}
      <div className="gex-signal-row">
        {gexLoaded ? (() => {
          // Directional lean: flip level is primary judge, largest GEX magnet is fallback
          const largestGexLevel = btcGexLevels.length > 0
            ? btcGexLevels.reduce((a, b) => Math.abs(a.gex) > Math.abs(b.gex) ? a : b)
            : null;

          let lean: 'bull' | 'bear' | 'neutral' = 'neutral';
          let leanReason = '';
          if (btcGexFlip != null && spotPrice > 0) {
            if (spotPrice > btcGexFlip) {
              lean = 'bull';
              leanReason = `price above gamma flip ($${btcGexFlip.toLocaleString()})`;
            } else {
              lean = 'bear';
              leanReason = `price below gamma flip ($${btcGexFlip.toLocaleString()})`;
            }
          } else if (largestGexLevel && spotPrice > 0) {
            if (largestGexLevel.strike > spotPrice) {
              lean = 'bull';
              leanReason = `magnet at $${(largestGexLevel.strike / 1000).toFixed(0)}K is above`;
            } else {
              lean = 'bear';
              leanReason = `magnet at $${(largestGexLevel.strike / 1000).toFixed(0)}K is below`;
            }
          }

          const leanColor = lean === 'bull' ? '#34d399' : lean === 'bear' ? '#f87171' : '#9ca3af';
          const leanLabel = lean === 'bull' ? '↑ BULLISH LEAN' : lean === 'bear' ? '↓ BEARISH LEAN' : '→ NEUTRAL';
          const regimeLabel = isLongGamma ? 'RANGING' : 'TRENDING';
          const regimeColor = isLongGamma ? '#34d399' : '#f87171';
          const regimeDesc  = isLongGamma
            ? 'price pins & mean-reverts between levels'
            : 'breakouts follow through, no fading';

          return (
            <>
              <span style={{ color: leanColor, fontWeight: 700 }}>{leanLabel}</span>
              {leanReason && <span style={{ color: '#555' }}> — {leanReason}</span>}
              <span style={{ color: '#3a3a3a' }}> · </span>
              <span style={{ color: regimeColor }}>{regimeLabel}</span>
              <span style={{ color: '#555' }}> regime — {regimeDesc}</span>
            </>
          );
        })() : (
          <span style={{ color: '#2a2a2a' }}>Calculating from Deribit options chain…</span>
        )}
      </div>

      {/* Strike chart */}
      {gexLoaded && btcGexLevels.length > 0 && (
        <>
          <div className="gex-hdr">
            <div>Strike</div><div>Gamma exposure</div><div>Net GEX</div>
          </div>
          {btcGexLevels.map(({ strike, gex }) => {
            const pct   = maxAbsGex > 0 ? Math.abs(gex) / maxAbsGex * 100 : 0;
            const col   = gex >= 0 ? 'rgba(52,211,153,0.65)' : 'rgba(248,113,113,0.65)';
            const vcol  = gex >= 0 ? '#34d399' : '#f87171';
            const isAtm = spotPrice > 0 && Math.abs(strike - spotPrice) / spotPrice < 0.005;
            return (
              <div key={strike} className="gex-row" style={isAtm ? { background: 'rgba(255,255,255,0.03)' } : {}}>
                <div className="gex-strike" style={isAtm ? { color: '#e8e8e8' } : {}}>
                  ${strike >= 1000 ? (strike / 1000).toFixed(0) + 'K' : strike}
                  {isAtm && <span style={{ fontSize: 10, color: '#606060', marginLeft: 4 }}>ATM</span>}
                </div>
                <div className="gex-bar-wrap">
                  <div className="gex-bar-fill" style={{ width: `${pct}%`, background: col }} />
                </div>
                <div className="gex-value" style={{ color: vcol }}>{fmtGex(gex)}</div>
              </div>
            );
          })}
        </>
      )}

      {/* Flip level + pin */}
      {gexLoaded && (
        <div className="gex-flip-row">
          {btcGexFlip != null && (
            <div>
              Zero-gamma flip: <span>${btcGexFlip.toLocaleString()}</span>
              <span style={{ color: '#2a2a2a', fontWeight: 400 }}> — break {(btcGexFlip < (spotPrice || btcGexFlip)) ? 'below' : 'above'} = vol acceleration</span>
            </div>
          )}
          {btcGexLevels.length > 0 && (() => {
            const top = btcGexLevels.reduce((a, b) => Math.abs(a.gex) > Math.abs(b.gex) ? a : b);
            return (
              <div>
                Largest GEX: <span>${top.strike.toLocaleString()}</span>
                <span style={{ color: '#2a2a2a', fontWeight: 400 }}> — options pin / magnet strike</span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

const RULES = [
  { n: 1, c: 'np', t: 'No bright cluster = no trade. Period.', b: 'If you cannot point to a bright, tight yellow/white zone on Coinglass 24h Model 2, you are guessing.' },
  { n: 2, c: 'np', t: 'Funding rate tells you direction.', b: '+ve funding = too many longs = whales dump DOWN. -ve funding = too many shorts = whales squeeze UP.' },
  { n: 3, c: 'np', t: 'Time window is everything.', b: 'God Tier (Sun 11PM–Mon 3AM PHT) and Prime (daily 2–5AM PHT) are when raids happen. Dead Zone (12–3PM) = stay out.' },
  { n: 4, c: 'ng', t: 'Enter 0.8–1.5% before the zone.', b: 'Not at the zone. Not after. You front-run the magnet — you do not chase it into the kill zone.' },
  { n: 5, c: 'ng', t: 'Exit the SECOND price touches the cluster.', b: 'Do not hold through the touch expecting more. The raid fuel is spent the moment it hits. Get out fast.' },
  { n: 6, c: 'np', t: 'Maximum 2 trades per day.', b: 'More than 2 = you are gambling, not hunting. Flat 90% of the time is how the best players operate.' },
  { n: 7, c: 'ng', t: 'Never trust the first move after news.', b: 'First 30-45 minutes after big news = fake move. Real directional move comes on the second leg.' },
  { n: 8, c: 'ng', t: 'After a raid = 4 hours rest minimum.', b: 'The fuel is gone. They have eaten. Do not revenge-trade. Do not look for the next setup immediately.' },
];

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
  const [cmdsOpen, setCmdsOpen]   = useState(false);
  const [gexOpen,  setGexOpen]    = useState(false);

  const { settings } = useSettings();
  const hide = (id: string) => settings.hidden_sections.includes(id);

  return (
    <div className="dashboard-grid">

      {/* ── Left sticky sidebar (desktop only) ── */}
      <aside className="dash-sidebar">
        <CoinSidebar />
        <div className="ind-row" style={{ margin: 0 }}><FearGreed /></div>
        <div className="ind-row" style={{ margin: 0 }}><BTCDominance /></div>
        <div className="ind-row" style={{ margin: 0 }}><AltSeasonIndex /></div>
      </aside>

      {/* ── Main content ── */}
      <div className="dash-main">
        {/* Mobile-only ticker + market indicators (desktop shows in sidebar) */}
        <div className="mobile-only">
          <div className="dash-section">Live prices</div>
          <Ticker />
          <div className="dash-section">Market indicators</div>
          <div className="ind-row"><FearGreed /></div>
          <div className="ind-row"><BTCDominance /></div>
          <div className="ind-row"><AltSeasonIndex /></div>
        </div>

        {/* 1. Gate: is now a good time to trade? */}
        {!hide('raid_meter') && <RaidMeter />}

        {/* 2. Best play right now — answer up top, not buried */}
        {!hide('best_setup') && <>
          <div className="dash-section dash-section-hot">Best Setup Now</div>
          <SOTD />
        </>}

        {/* 3. Cascade alert — contextual, only renders when active */}
        {!hide('cascade') && <CascadeAlertBanner />}

        {/* 3b. Sentiment extremes — fires when F&G + FR + L/S all aligned extreme */}
        <SentimentExtremesAlert />

        {/* 4. Coin signals — confirm the setup */}
        {!hide('coin_signals') && <>
          <CoinSignalsHeader />
          <EdgeSignals />
          <SmartMoneyScore />
          <OISpikeScanner />
        </>}

        {/* 5. Session context — timing reference (after you know the play) */}
        {!hide('session') && <SessionContext />}

        {/* 6. Catalysts & market events */}
        {!hide('catalysts') && <NewsBanner />}

        {/* GEX + Macro: shown inline on mobile/tablet, hidden when right panel is visible */}
        <div className="hide-on-desktop">
          {!hide('gex') && <>
            <div
              className="dash-section"
              style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setGexOpen(o => !o)}
            >
              Gamma exposure
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--txt3)', letterSpacing: 0 }}>
                {gexOpen ? '▲ hide' : '▼ show'}
              </span>
            </div>
            {gexOpen && <GexTable />}
          </>}
          {!hide('macro') && <>
            <div className="dash-section">Macro correlations</div>
            <MacroStrip />
          </>}
        </div>

        {!hide('commandments') && <>
          <div
            className="dash-section"
            style={{ cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setCmdsOpen(o => !o)}
          >
            The 8 commandments
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--txt3)', letterSpacing: 0 }}>
              {cmdsOpen ? '▲ hide' : '▼ show'}
            </span>
          </div>
          {cmdsOpen && (
            <div className="card">
              <div className="lbl">Core rules — never break these</div>
              {RULES.map(r => (
                <div key={r.n} className="row" style={{ marginBottom: 14 }}>
                  <div className={`num ${r.c}`}>{r.n}</div>
                  <div>
                    <div className="st">{r.t}</div>
                    <div className="sb">{r.b}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>}
      </div>

      {/* ── Right panel (desktop ≥1100px only) ── */}
      <aside className="dash-right">
        <div
          className="dash-section"
          style={{ marginTop: 0, marginBottom: 8, cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setGexOpen(o => !o)}
        >
          Gamma exposure
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--txt3)', letterSpacing: 0 }}>
            {gexOpen ? '▲ hide' : '▼ show'}
          </span>
        </div>
        {gexOpen && <GexTable />}
        <div className="dash-section" style={{ marginBottom: 8 }}>Macro</div>
        <MacroStrip />
      </aside>

    </div>
  );
}
