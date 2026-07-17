'use client';
import { useMemo, useRef, useState } from 'react';
import { useMarket, COINS, CoinId, CoinData, computeSqueezeScore, classifyFunding } from '@/lib/marketStore';
import { Warn } from '@/components/icons';

type FilterDir = 'all' | 'LONG_LIQ' | 'SHORT_SQ' | 'NEUTRAL';

function fmtFR(r: number | null): string {
  if (r == null) return '-';
  return (r * 100).toFixed(4) + '%';
}
function fmtRatio(r: number | null): string {
  if (r == null) return '-';
  return (r * 100).toFixed(0) + '%';
}
function fmtVR(r: number | null): string {
  if (r == null) return '-';
  return r.toFixed(2) + 'x';
}
function fmtRSI(r: number | null): string {
  if (r == null) return '-';
  return r.toFixed(0);
}

interface ScanRow {
  id: CoinId;
  coin: CoinData;
  score: number;
  dir: 'LONG_LIQ' | 'SHORT_SQ' | 'NEUTRAL';
  label: string;
  color: string;
}

function OiTrendBadge({ trend }: { trend: CoinData['oiTrend'] }) {
  if (!trend) return <span className="scan-badge scan-badge-neu">Open Int -</span>;
  const map: Record<string, { label: string; cls: string }> = {
    strong_up:   { label: 'Open Int ↑↑', cls: 'scan-badge-bull' },
    weak_up:     { label: 'Open Int ↑',  cls: 'scan-badge-neu'  },
    weak_down:   { label: 'Open Int ↓',  cls: 'scan-badge-neu'  },
    strong_down: { label: 'Open Int ↓↓', cls: 'scan-badge-bear' },
  };
  const m = map[trend];
  return <span className={`scan-badge ${m.cls}`}>{m.label}</span>;
}

function CvdBadge({ cvd }: { cvd: CoinData['cvdDivergence'] }) {
  if (!cvd) return <span className="scan-badge scan-badge-neu">CVD -</span>;
  if (cvd === 'bullish') return <span className="scan-badge scan-badge-bull">CVD ↑</span>;
  return <span className="scan-badge scan-badge-bear">CVD ↓</span>;
}

function TakerBadge({ ratio }: { ratio: number | null }) {
  if (ratio == null) return <span className="scan-badge scan-badge-neu">Tkr -</span>;
  const pct = (ratio * 100).toFixed(0);
  if (ratio >= 0.60) return <span className="scan-badge scan-badge-bull">Tkr {pct}%</span>;
  if (ratio <= 0.40) return <span className="scan-badge scan-badge-bear">Tkr {pct}%</span>;
  return <span className="scan-badge scan-badge-neu">Tkr {pct}%</span>;
}

function RsiBadge({ rsi }: { rsi: number | null }) {
  if (rsi == null) return null;
  const v = Math.round(rsi);
  if (v >= 70) return <span className="scan-badge scan-badge-bear">RSI {v}</span>;
  if (v <= 30) return <span className="scan-badge scan-badge-bull">RSI {v}</span>;
  return <span className="scan-badge scan-badge-neu">RSI {v}</span>;
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="scan-score-track">
      <div
        className="scan-score-fill"
        style={{ width: `${score}%`, background: color, boxShadow: score > 50 ? `0 0 8px ${color}66` : 'none' }}
      />
    </div>
  );
}

function CoinCard({ row, rank }: { row: ScanRow; rank: number }) {
  const cd = row.coin;
  const fr = classifyFunding(cd.fundingRate ?? 0);
  const frColor = fr.rpm === 'pos' ? '#f87171' : fr.rpm === 'neg' ? '#34d399' : '#606060';
  const dirBg = row.dir === 'LONG_LIQ'
    ? 'rgba(248,113,113,0.06)' : row.dir === 'SHORT_SQ'
    ? 'rgba(52,211,153,0.06)' : 'transparent';
  const dirBdr = row.dir === 'LONG_LIQ'
    ? 'rgba(248,113,113,0.18)' : row.dir === 'SHORT_SQ'
    ? 'rgba(52,211,153,0.18)' : 'var(--bdr)';

  return (
    <div className="scan-card" style={{ background: dirBg, borderColor: dirBdr }}>
      {/* Top row */}
      <div className="scan-card-top">
        <span className="scan-rank">#{rank}</span>
        <span className="scan-coin-name">{row.id.toUpperCase()}</span>
        <span className="scan-dir-label" style={{ color: row.color }}>{row.label}</span>
        <span className="scan-score-num" style={{ color: row.color }}>{row.score}</span>
      </div>

      {/* Score bar */}
      <ScoreBar score={row.score} color={row.color} />

      {/* Signal chips row */}
      <div className="scan-chips">
        <OiTrendBadge  trend={cd.oiTrend} />
        <CvdBadge      cvd={cd.cvdDivergence} />
        <TakerBadge    ratio={cd.takerBuyRatio} />
        <RsiBadge      rsi={cd.rsi14} />
      </div>

      {/* Stats row */}
      <div className="scan-stats">
        <div className="scan-stat">
          <span className="scan-stat-lbl">Funding</span>
          <span className="scan-stat-val" style={{ color: frColor }}>{fmtFR(cd.fundingRate)}</span>
        </div>
        <div className="scan-stat">
          <span className="scan-stat-lbl">Long %</span>
          <span className="scan-stat-val" style={{ color: (cd.longRatio ?? 0) >= 0.6 ? '#f87171' : '#8e8e93' }}>
            {fmtRatio(cd.longRatio)}
          </span>
        </div>
        <div className="scan-stat">
          <span className="scan-stat-lbl">Short %</span>
          <span className="scan-stat-val" style={{ color: (cd.shortRatio ?? 0) >= 0.6 ? '#34d399' : '#8e8e93' }}>
            {fmtRatio(cd.shortRatio)}
          </span>
        </div>
        <div className="scan-stat">
          <span className="scan-stat-lbl">Vol ratio</span>
          <span className="scan-stat-val" style={{ color: (cd.volRatio ?? 0) >= 1.5 ? 'var(--accent)' : 'var(--txt3)' }}>
            {fmtVR(cd.volRatio)}
          </span>
        </div>
        <div className="scan-stat">
          <span className="scan-stat-lbl">RSI 1h</span>
          <span className="scan-stat-val">{fmtRSI(cd.rsi1h)}</span>
        </div>
        <div className="scan-stat">
          <span className="scan-stat-lbl">RSI 4h</span>
          <span className="scan-stat-val">{fmtRSI(cd.rsi4h)}</span>
        </div>
      </div>
    </div>
  );
}

export default function SetupScanner({ coin: coinProp }: { coin?: CoinId }) {
  const { store } = useMarket();
  const [filter, setFilter] = useState<FilterDir>('all');
  const [strongOnly, setStrongOnly] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const rows = useMemo<ScanRow[]>(() => {
    return COINS
      .map(id => {
        const coin = store.coins[id];
        if (!coin) return null;
        const sq = computeSqueezeScore(coin);
        return { id, coin, ...sq } as ScanRow;
      })
      .filter(Boolean) as ScanRow[];
  }, [store.coins]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => b.score - a.score);
  }, [rows]);

  const filtered = useMemo(() => {
    if (filter === 'all') return sorted;
    return sorted.filter(r => r.dir === filter);
  }, [sorted, filter]);

  const strongCount = useMemo(
    () => sorted.filter(r => r.score >= 65 && r.dir !== 'NEUTRAL').length,
    [sorted],
  );

  const displayed = useMemo(() => {
    if (!strongOnly) return filtered;
    return filtered.filter(r => r.score >= 65 && r.dir !== 'NEUTRAL');
  }, [filtered, strongOnly]);

  const searchDisplayed = useMemo(() => {
    if (!search.trim()) return displayed;
    const q = search.trim().toLowerCase();
    return displayed.filter(r => r.id.toLowerCase().includes(q));
  }, [displayed, search]);

  // Count by direction
  const counts = useMemo(() => {
    const c = { LONG_LIQ: 0, SHORT_SQ: 0, NEUTRAL: 0 };
    sorted.forEach(r => { c[r.dir]++; });
    return c;
  }, [sorted]);

  const highestLongLiq = sorted.find(r => r.dir === 'LONG_LIQ');
  const highestShortSq = sorted.find(r => r.dir === 'SHORT_SQ');

  // ── Single-coin mode (used by Arena) ──────────────────────────────────────
  if (coinProp) {
    const row = rows.find(r => r.id === coinProp);
    if (!row) return <div style={{ padding: '1rem 0', fontSize: 12, color: 'var(--txt3)' }}>No data for {coinProp.toUpperCase()}</div>;
    return (
      <div style={{ paddingTop: 8 }}>
        <CoinCard row={row} rank={sorted.indexOf(row) + 1} />
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ padding: '1rem 0 0.75rem' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>
          Setup Scanner
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
          All {COINS.length} coins ranked by squeeze risk · updates with live data
        </div>
      </div>

      {/* Alert bar */}
      {(highestLongLiq || highestShortSq) && (
        <div className="scan-alert-row">
          {highestLongLiq && highestLongLiq.score >= 40 && (
            <div className="scan-alert scan-alert-bear">
              <span className="scan-alert-icon" style={{ lineHeight: 0 }}><Warn size={14} /></span>
              <span>
                <strong style={{ color: '#f87171' }}>{highestLongLiq.id.toUpperCase()}</strong>
                {' '}Long liquidation risk - score {highestLongLiq.score}
              </span>
            </div>
          )}
          {highestShortSq && highestShortSq.score >= 40 && (
            <div className="scan-alert scan-alert-bull">
              
              <span>
                <strong style={{ color: '#34d399' }}>{highestShortSq.id.toUpperCase()}</strong>
                {' '}Short squeeze setup - score {highestShortSq.score}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Filter tabs */}
      <div className="scan-filter-row">
        <div className="scan-filter-dirs">
          {([
            { key: 'all',      label: `All (${rows.length})`              },
            { key: 'LONG_LIQ', label: `Long Liq (${counts.LONG_LIQ})`     },
            { key: 'SHORT_SQ', label: `Short Squeeze (${counts.SHORT_SQ})` },
            { key: 'NEUTRAL',  label: `Neutral (${counts.NEUTRAL})`        },
          ] as { key: FilterDir; label: string }[]).map(f => (
            <button
              key={f.key}
              className={`scan-filter-btn${filter === f.key ? ' on' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          className="scan-filter-btn scan-filter-toggle"
          style={strongOnly ? {
            background: 'rgba(251,191,36,0.10)',
            borderColor: 'rgba(251,191,36,0.35)',
            color: '#fbbf24',
          } : {}}
          aria-pressed={strongOnly}
          onClick={() => setStrongOnly(v => !v)}
        >
          {strongOnly ? `Strong Setups Only - ${strongCount} coins` : 'Strong Setups Only'}
        </button>
      </div>

      {/* Search */}
      <div style={{ margin: '10px 0 6px' }}>
        <input
          ref={searchRef}
          type="search"
          placeholder="Search coins…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search coins"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 12px',
            borderRadius: 8,
            border: '0.5px solid var(--bdr)',
            background: 'var(--bg1)',
            color: 'var(--txt)',
            fontSize: 13,
            outline: 'none',
          }}
        />
      </div>

      {/* Cards */}
      {searchDisplayed.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--txt3)', padding: '3rem 0', fontSize: 13 }}>
          {search.trim()
            ? `No coins match "${search.trim()}"`
            : strongOnly
              ? 'No strong setups right now - try again later or turn off the filter'
              : 'No setups match this filter right now'}
        </div>
      )}

      <div className="scan-list">
        {searchDisplayed.map((row) => (
          <CoinCard key={row.id} row={row} rank={sorted.indexOf(row) + 1} />
        ))}
      </div>

      {/* Legend */}
      <div className="scan-legend">
        <div className="scan-legend-title">How the score works</div>
        <div className="scan-legend-row">
          <span className="scan-legend-dot" style={{ background: '#f87171' }} />
          <span><strong style={{ color: '#f87171' }}>Long Liq Risk ↓</strong> - too many longs. Funding +, long% high, vol spike. Whales incentivised to dump.</span>
        </div>
        <div className="scan-legend-row">
          <span className="scan-legend-dot" style={{ background: '#34d399' }} />
          <span><strong style={{ color: '#34d399' }}>Short Squeeze ↑</strong> - too many shorts. Funding –, short% high, vol spike. Whales incentivised to pump.</span>
        </div>
        <div className="scan-legend-row">
          <span className="scan-legend-dot" style={{ background: '#606060' }} />
          <span><strong>Balanced</strong> - no extreme positioning on either side. Sit out or trade structure.</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--txt3)' }}>
          Score 0–100: funding rate (0–40 pts) + long/short ratio (0–40 pts) + volume spike bonus (0–20 pts)
        </div>
      </div>
    </div>
  );
}
