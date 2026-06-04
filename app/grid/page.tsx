'use client';
import { useState } from 'react';
import {
  useMarket, COINS, COIN_DEC, fmtPrice, CoinId,
} from '@/lib/marketStore';

/* ────────────────────────────────────────────────
   Grid-friendliness score (0–100)
   Higher = coin is ranging → good for grids
   Lower  = coin is trending → grid will get blown out
──────────────────────────────────────────────── */
function gridScore(coinId: CoinId, store: ReturnType<typeof useMarket>['store']): {
  score: number;
  grade: 'good' | 'caution' | 'avoid';
  topSignal: string;
  rangePct: number | null;
} {
  const d = store.coins[coinId];
  let score = 50;
  let topSignal = 'No data';
  let rangePct: number | null = null;

  if (!d) return { score: 0, grade: 'avoid', topSignal: 'No data', rangePct: null };

  // ── OI Trend (biggest factor — a trending OI kills a grid) ──
  if (d.oiTrend === 'strong_up') {
    score -= 40; topSignal = '↑ New longs — trending';
  } else if (d.oiTrend === 'strong_down') {
    score -= 40; topSignal = '↓ New shorts — trending';
  } else if (d.oiTrend === 'weak_up') {
    score += 5; topSignal = 'Short covering — range possible';
  } else if (d.oiTrend === 'weak_down') {
    score += 5; topSignal = 'Long exits — range possible';
  } else {
    score += 10; topSignal = 'No OI trend — ranging likely';
  }

  // ── Funding Rate ──
  if (d.fundingRate != null) {
    const fr = Math.abs(d.fundingRate * 100);
    if (fr >= 0.05) {
      score -= 25; if (score > 30) topSignal = 'FR extreme — raid risk';
    } else if (fr >= 0.02) {
      score -= 10;
    } else {
      score += 15;
    }
  }

  // ── 24h Range / Price (proxy for daily ATR) ──
  if (d.high && d.low && d.price && d.price > 0) {
    rangePct = ((d.high - d.low) / d.price) * 100;
    if (rangePct < 2.5) {
      score += 20; if (score > 60) topSignal = 'Tight range — consolidating';
    } else if (rangePct < 5) {
      score += 8;
    } else if (rangePct < 8) {
      score -= 5;
    } else {
      score -= 15; if (score < 35) topSignal = 'Wide range — volatile';
    }
  }

  // ── CVD Divergence (directional move building) ──
  if (d.cvdDivergence) {
    score -= 15;
    if (score < 40) topSignal = `CVD ${d.cvdDivergence} div — move brewing`;
  }

  // ── 24h price change ──
  const chg = Math.abs(d.change ?? 0);
  if (chg > 5) {
    score -= 10;
  } else if (chg < 1.5) {
    score += 8;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const grade = score >= 62 ? 'good'
              : score >= 38 ? 'caution'
              : 'avoid';

  return { score, grade, topSignal, rangePct };
}

/* ── Ranging Radar ── */
function RangingRadar() {
  const { store, selectCoin } = useMarket();

  const GRADE_META = {
    good:    { label: 'Grid-friendly', col: '#34d399', bdr: 'rgba(52,211,153,0.28)' },
    caution: { label: 'Caution',       col: '#fbbf24', bdr: 'rgba(251,191,36,0.22)' },
    avoid:   { label: 'Trending',      col: '#f87171', bdr: 'rgba(248,113,113,0.28)' },
  };

  return (
    <div className="grid-radar-grid">
      {COINS.map(id => {
        const d   = store.coins[id];
        const dec = COIN_DEC[id];
        const { score, grade, topSignal, rangePct } = gridScore(id, store);
        const meta = GRADE_META[grade];

        return (
          <div
            key={id}
            className="grid-radar-card"
            style={{ borderColor: meta.bdr }}
            onClick={() => selectCoin(id)}
          >
            <div className="grid-radar-top">
              <span className="grid-radar-coin">{id.toUpperCase()}</span>
              <span className="grid-radar-score" style={{ color: meta.col }}>{score}</span>
            </div>
            <div className="grid-radar-grade" style={{ color: meta.col }}>{meta.label}</div>
            {d?.price && (
              <div className="grid-radar-price">
                ${fmtPrice(d.price, dec)}
                {d.change != null && (
                  <span style={{ color: d.change >= 0 ? '#34d399' : '#f87171', marginLeft: 4 }}>
                    {d.change >= 0 ? '+' : ''}{d.change.toFixed(2)}%
                  </span>
                )}
              </div>
            )}
            {rangePct != null && (
              <div className="grid-radar-range">24h range: {rangePct.toFixed(1)}%</div>
            )}
            <div className="grid-radar-sig">{topSignal}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Grid Builder ── */
function GridBuilder() {
  const { store } = useMarket();
  const coin      = store.selectedCoin;
  const d         = store.coins[coin];
  const price     = d?.price ?? 0;
  const dec       = COIN_DEC[coin];

  const [upper,     setUpper]     = useState('');
  const [lower,     setLower]     = useState('');
  const [gridCount, setGridCount] = useState('10');
  const [capital,   setCapital]   = useState('1000');

  const upperNum    = parseFloat(upper)     || 0;
  const lowerNum    = parseFloat(lower)     || 0;
  const gridCountNum= Math.max(2, parseInt(gridCount) || 10);
  const capitalNum  = parseFloat(capital)   || 0;

  const isValid = upperNum > lowerNum && lowerNum > 0 && capitalNum > 0;

  // ── Core calcs ──
  const range          = upperNum - lowerNum;
  const gridSpacing    = isValid ? range / gridCountNum : 0;
  const gridSpacingPct = isValid && lowerNum > 0 ? (gridSpacing / lowerNum) * 100 : 0;
  const profitPerGrid  = gridSpacingPct;              // gross % per fill cycle
  const makerFee       = 0.02;                        // % per side (Bybit maker)
  const feePerCycle    = makerFee * 2;                // buy + sell
  const netProfitPct   = profitPerGrid - feePerCycle;
  const orderSize      = isValid ? capitalNum / gridCountNum : 0;

  // ── ATR check (24h high-low as proxy) ──
  const atr24hPct = (d?.high && d?.low && price > 0)
    ? ((d.high - d.low) / price) * 100
    : null;
  const rangePct = isValid && price > 0
    ? ((upperNum - lowerNum) / price) * 100
    : null;
  const tooNarrow = atr24hPct != null && rangePct != null && rangePct < atr24hPct * 0.8;
  const tooWide   = atr24hPct != null && rangePct != null && rangePct > atr24hPct * 4;

  // ── Est. fills/day ──
  // How many grid lines does price cross in a typical day?
  // Est = (24h range in $) / gridSpacing × 0.4 efficiency factor
  const estFillsDay = (atr24hPct != null && isValid && price > 0 && gridSpacing > 0)
    ? Math.max(0, Math.round((atr24hPct / 100 * price) / gridSpacing * 0.4))
    : null;

  // ── Est. daily profit ──
  const estDailyUsd = (estFillsDay != null && netProfitPct > 0)
    ? estFillsDay * (netProfitPct / 100) * orderSize
    : null;

  const estMonthlyUsd  = estDailyUsd != null ? estDailyUsd * 30 : null;
  const estMonthlyPct  = estMonthlyUsd != null && capitalNum > 0
    ? (estMonthlyUsd / capitalNum) * 100
    : null;

  // ── Quick range presets ──
  function applyPreset(upMult: number, dnMult: number) {
    if (!price) return;
    setUpper((price * upMult).toFixed(dec));
    setLower((price * dnMult).toFixed(dec));
  }

  return (
    <div className="grid-builder">
      <div className="grid-builder-header">
        <span className="grid-builder-title">Grid Builder — {coin.toUpperCase()}</span>
        {price > 0 && (
          <span className="grid-builder-live">
            ${fmtPrice(price, dec)}
            {d?.change != null && (
              <span style={{ color: d.change >= 0 ? '#34d399' : '#f87171', marginLeft: 5 }}>
                {d.change >= 0 ? '+' : ''}{d.change.toFixed(2)}%
              </span>
            )}
          </span>
        )}
      </div>

      {/* Inputs */}
      <div className="grid-builder-inputs">
        <div className="grid-input-group">
          <label>Upper bound</label>
          <input
            className="grid-input"
            type="number"
            value={upper}
            onChange={e => setUpper(e.target.value)}
            placeholder={price > 0 ? (price * 1.05).toFixed(dec) : 'e.g. 70000'}
          />
        </div>
        <div className="grid-input-group">
          <label>Lower bound</label>
          <input
            className="grid-input"
            type="number"
            value={lower}
            onChange={e => setLower(e.target.value)}
            placeholder={price > 0 ? (price * 0.95).toFixed(dec) : 'e.g. 60000'}
          />
        </div>
        <div className="grid-input-group">
          <label>Grid levels</label>
          <input
            className="grid-input"
            type="number"
            value={gridCount}
            onChange={e => setGridCount(e.target.value)}
            min="2"
            max="200"
          />
        </div>
        <div className="grid-input-group">
          <label>Capital (USDT)</label>
          <input
            className="grid-input"
            type="number"
            value={capital}
            onChange={e => setCapital(e.target.value)}
            placeholder="1000"
          />
        </div>
      </div>

      {/* Quick presets */}
      {price > 0 && (
        <div className="grid-presets">
          <span className="grid-presets-label">Quick range:</span>
          {([
            { label: '±3%',  up: 1.03, dn: 0.97 },
            { label: '±5%',  up: 1.05, dn: 0.95 },
            { label: '±10%', up: 1.10, dn: 0.90 },
            { label: '±15%', up: 1.15, dn: 0.85 },
          ] as const).map(p => (
            <button
              key={p.label}
              className="grid-preset-btn"
              onClick={() => applyPreset(p.up, p.dn)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Warnings */}
      {isValid && tooNarrow && (
        <div className="grid-warning">
          ⚠️ Range ({rangePct?.toFixed(1)}%) is narrower than 24h movement ({atr24hPct?.toFixed(1)}%)
          — price will blow through your grid. Widen it or wait for price to tighten up.
        </div>
      )}
      {isValid && tooWide && (
        <div className="grid-warning grid-warning-info">
          ℹ️ Range ({rangePct?.toFixed(1)}%) is very wide vs 24h movement ({atr24hPct?.toFixed(1)}%)
          — grid is safe but fills will be rare. Fewer levels or tighter range = faster cycling.
        </div>
      )}
      {isValid && netProfitPct <= 0 && (
        <div className="grid-warning">
          ⚠️ Net profit per grid is negative after fees. Increase grid spacing
          (fewer levels or wider range) — minimum spacing needed: {(feePerCycle * lowerNum / 100).toFixed(dec)}.
        </div>
      )}

      {/* Results */}
      {isValid && (
        <div className="grid-results">
          <div className="grid-result-row">
            <span>Grid spacing</span>
            <span>${gridSpacing.toFixed(dec)} <span className="grid-result-muted">({gridSpacingPct.toFixed(3)}%)</span></span>
          </div>
          <div className="grid-result-row">
            <span>Profit per grid <span className="grid-result-muted">(gross)</span></span>
            <span style={{ color: '#fbbf24' }}>{profitPerGrid.toFixed(4)}%</span>
          </div>
          <div className="grid-result-row">
            <span>Fees per cycle <span className="grid-result-muted">(2× maker 0.02%)</span></span>
            <span style={{ color: '#f87171' }}>−{feePerCycle.toFixed(4)}%</span>
          </div>
          <div className="grid-result-row grid-result-divider">
            <span>Net profit per grid</span>
            <span style={{ color: netProfitPct > 0 ? '#34d399' : '#f87171', fontWeight: 700 }}>
              {netProfitPct > 0 ? '+' : ''}{netProfitPct.toFixed(4)}%
            </span>
          </div>
          <div className="grid-result-row">
            <span>Order size per level</span>
            <span>${orderSize.toFixed(2)}</span>
          </div>
          {estFillsDay != null && (
            <div className="grid-result-row">
              <span>Est. fills / day <span className="grid-result-muted">(40% of 24h range)</span></span>
              <span>{estFillsDay}</span>
            </div>
          )}
          {estDailyUsd != null && estDailyUsd > 0 && (
            <>
              <div className="grid-result-row">
                <span>Est. daily profit</span>
                <span style={{ color: '#34d399' }}>${estDailyUsd.toFixed(2)}</span>
              </div>
              {estMonthlyUsd != null && estMonthlyPct != null && (
                <div className="grid-result-row grid-result-highlight">
                  <span>Est. 30-day profit</span>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>
                    ${estMonthlyUsd.toFixed(2)} <span className="grid-result-muted">({estMonthlyPct.toFixed(1)}% ROI)</span>
                  </span>
                </div>
              )}
            </>
          )}
          <div className="grid-result-disclaimer">
            Estimates use 24h range as a proxy for daily volatility.
            Actual fills depend on market conditions — no guarantees.
          </div>
        </div>
      )}

      {!isValid && (
        <div className="grid-empty-state">
          Enter upper and lower bounds above to see grid calculations.
        </div>
      )}
    </div>
  );
}

/* ── Page ── */
export default function GridPage() {
  return (
    <div className="app-content">
      <div className="grid-page">

        <div className="grid-page-header">
          <div>
            <div className="grid-page-title">Grid Bot Hub</div>
            <div className="grid-page-sub">
              Deploy smarter — check ranging conditions before committing capital
            </div>
          </div>
        </div>

        {/* ── Ranging Radar ── */}
        <div className="grid-section">
          <div className="grid-section-label">Ranging Radar</div>
          <div className="grid-section-desc">
            Grid bots profit from oscillation and die in trends. Green = consolidating. Red = trending, stay out.
            Score is based on OI trend, funding rate, 24h range, and CVD.
          </div>
          <RangingRadar />
        </div>

        {/* ── Grid Builder ── */}
        <div className="grid-section">
          <div className="grid-section-label">Grid Builder</div>
          <div className="grid-section-desc">
            Select a coin from the radar above, then set your range and capital.
          </div>
          <GridBuilder />
        </div>

      </div>
    </div>
  );
}
