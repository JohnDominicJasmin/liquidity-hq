'use client';
import { useEffect, useState, useCallback } from 'react';

interface FundingRow {
  coin:          string;
  binance:       number | null;
  bybit:         number | null;
  nextFundingMs: number | null;
}

/* ── helpers ── */
function fmtFR(v: number | null): string {
  if (v === null) return '—';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(4) + '%';
}

function frColor(v: number | null): string {
  if (v === null) return 'var(--txt3)';
  const p = v * 100;
  if (p >=  0.05) return '#ef4444';
  if (p >=  0.01) return '#f97316';
  if (p <= -0.05) return '#22d3ee';
  if (p <= -0.01) return '#34d399';
  return 'var(--txt3)';
}

function frBg(v: number | null): string {
  if (v === null) return 'transparent';
  const p = v * 100;
  if (p >=  0.05) return 'rgba(239,68,68,.14)';
  if (p >=  0.01) return 'rgba(249,115,22,.10)';
  if (p <= -0.05) return 'rgba(34,211,238,.12)';
  if (p <= -0.01) return 'rgba(52,211,153,.09)';
  return 'transparent';
}

function avgOf(vals: (number | null)[]): number | null {
  const clean = vals.filter((v): v is number => v !== null);
  return clean.length ? clean.reduce((s, v) => s + v, 0) / clean.length : null;
}

function isDivergent(v: number | null, mean: number | null): boolean {
  if (v === null || mean === null) return false;
  return Math.abs(v - mean) * 100 >= 0.02;
}

function fmtCountdown(ms: number | null): string {
  if (!ms) return '—';
  const diff = ms - Date.now();
  if (diff <= 0) return 'Soon';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ── signal logic ── */
type Signal = 'LONG EDGE' | 'SHORT EDGE' | 'NEUTRAL';
function getSignal(avg: number | null): Signal {
  if (avg === null) return 'NEUTRAL';
  const p = avg * 100;
  if (p >=  0.03) return 'SHORT EDGE';
  if (p <= -0.03) return 'LONG EDGE';
  return 'NEUTRAL';
}

export default function FundingComparison() {
  const [rows,   setRows]   = useState<FundingRow[]>([]);
  const [ts,     setTs]     = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [showInfo, setShowInfo] = useState(false);

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/funding');
      const json = await res.json();
      if (json.data) {
        const sorted = [...json.data].sort((a: FundingRow, b: FundingRow) => {
          const aa = Math.abs(avgOf([a.binance, a.bybit]) ?? 0);
          const ba = Math.abs(avgOf([b.binance, b.bybit]) ?? 0);
          return ba - aa;
        });
        setRows(sorted);
        setTs(json.ts);
        setStatus('ok');
      } else {
        setStatus('error');
      }
    } catch { setStatus('error'); }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [load]);

  /* ── market reading ── */
  const longHeavy  = rows.filter(r => (avgOf([r.binance, r.bybit]) ?? 0) >  0.01).length;
  const shortHeavy = rows.filter(r => (avgOf([r.binance, r.bybit]) ?? 0) < -0.01).length;
  const mktBias    = longHeavy  > shortHeavy ? 'long'
                   : shortHeavy > longHeavy  ? 'short'
                   : 'neutral';

  const dotCls = status === 'ok' ? 'wf-dot-live' : status === 'error' ? 'wf-dot-error' : 'wf-dot-connecting';

  return (
    <div className="fc-wrap">
      {/* Header */}
      <div className="fc-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--txt)' }}>Funding Rates</span>
          <span className={`wf-dot ${dotCls}`} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Binance · Bybit · 30s</span>
          <button
            className="fc-info-btn"
            onClick={() => setShowInfo(v => !v)}
            title="What does this mean?"
          >
            {showInfo ? '✕ hide' : 'ℹ️ what is this?'}
          </button>
        </div>
      </div>

      {/* Explainer — shown when info toggled on */}
      {showInfo && (
        <div className="fc-explainer">
          <div className="fc-explainer-title">📚 What is the Funding Rate?</div>
          <p className="fc-explainer-p">
            In crypto futures, there are no expiry dates. Instead, every <strong>8 hours</strong> a fee called the <em>funding rate</em> is exchanged between traders holding long (buy) and short (sell) positions.
          </p>
          <div className="fc-explainer-row">
            <span className="fc-explainer-badge" style={{ color: '#f97316', background: 'rgba(249,115,22,.10)', borderColor: 'rgba(249,115,22,.25)' }}>Positive rate</span>
            <span className="fc-explainer-text">
              <strong>Longs pay shorts.</strong> The market has <em>too many longs</em>. The exchange charges longs to balance out the crowd. This is a warning sign — when too many people are long, smart money can dump and liquidate them.
            </span>
          </div>
          <div className="fc-explainer-row">
            <span className="fc-explainer-badge" style={{ color: '#34d399', background: 'rgba(52,211,153,.10)', borderColor: 'rgba(52,211,153,.25)' }}>Negative rate</span>
            <span className="fc-explainer-text">
              <strong>Shorts pay longs.</strong> The market has <em>too many shorts</em>. The exchange charges shorts. When the crowd is too bearish, smart money can squeeze them upward.
            </span>
          </div>
          <div className="fc-explainer-tip">
            💡 <strong>Tip:</strong> Extreme rates (+0.05% or −0.05%) signal very crowded trades. These often reverse hard. Use this to find <em>contrarian</em> setups — trade against the crowd.
          </div>
        </div>
      )}

      {/* Market reading */}
      {rows.length > 0 && (
        <div
          className="fc-reading"
          style={{
            borderColor: mktBias === 'long' ? 'rgba(249,115,22,.20)'
                       : mktBias === 'short' ? 'rgba(52,211,153,.20)'
                       : 'var(--bdr)',
          }}
        >
          <div className="fc-reading-emoji">
            {mktBias === 'long' ? '🔴' : mktBias === 'short' ? '🟢' : '⚪'}
          </div>
          <div>
            <div
              className="fc-reading-title"
              style={{
                color: mktBias === 'long'  ? '#f97316'
                     : mktBias === 'short' ? '#34d399'
                     : '#606060',
              }}
            >
              {mktBias === 'long'
                ? `${longHeavy}/${rows.length} coins: longs are paying — crowd is bullish`
                : mktBias === 'short'
                ? `${shortHeavy}/${rows.length} coins: shorts are paying — crowd is bearish`
                : 'Balanced — no strong crowd bias right now'}
            </div>
            <div className="fc-reading-sub">
              {mktBias === 'long'
                ? 'Too many longs paying fees → whales can dump to liquidate them. Favour SHORT setups or wait for funding to flush.'
                : mktBias === 'short'
                ? 'Too many shorts paying fees → whales can pump to squeeze them. Favour LONG setups or wait for shorts to cover.'
                : 'Market is neither overcrowded long or short. Use price action and other signals to pick direction.'}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="fc-legend">
        <span style={{ color: '#f97316' }}>▲ +0.01%+ longs paying</span>
        <span style={{ color: '#ef4444' }}>▲ +0.05%+ extreme</span>
        <span style={{ color: '#34d399' }}>▼ −0.01%− shorts paying</span>
        <span style={{ color: '#22d3ee' }}>▼ −0.05%− extreme</span>
        <span style={{ color: '#555' }}>⚡ &gt;0.02% cross-exchange divergence</span>
      </div>

      {/* Column headers */}
      <div className="fc-col-hdr">
        <span>Coin</span>
        <span>Binance</span>
        <span>Bybit</span>
        <span>Avg</span>
        <span style={{ textAlign: 'right' }}>Next</span>
      </div>

      {/* Data rows */}
      {rows.map(row => {
        const vals    = [row.binance, row.bybit];
        const mean    = avgOf(vals);
        const signal  = getSignal(mean);
        const sigColor = signal === 'LONG EDGE'  ? '#34d399'
                       : signal === 'SHORT EDGE' ? '#f97316'
                       : undefined;
        const borderColor = sigColor ?? 'transparent';

        return (
          <div
            key={row.coin}
            className="fc-row"
            style={{ borderLeftColor: borderColor }}
          >
            <div className="fc-coin-cell">
              <span className="fc-coin">{row.coin.toUpperCase()}</span>
              {signal !== 'NEUTRAL' && (
                <span className="fc-signal-tag" style={{ color: sigColor, borderColor: sigColor + '44', background: sigColor + '14' }}>
                  {signal}
                </span>
              )}
            </div>

            {vals.map((v, i) => (
              <span
                key={i}
                className="fc-cell"
                style={{ color: frColor(v), background: frBg(v) }}
                title={isDivergent(v, mean) ? 'Diverges >0.02% from average' : undefined}
              >
                {fmtFR(v)}{isDivergent(v, mean) ? ' ⚡' : ''}
              </span>
            ))}

            <span
              className="fc-cell"
              style={{ color: frColor(mean), background: frBg(mean), fontWeight: 800 }}
            >
              {fmtFR(mean)}
            </span>

            <span className="fc-next">{fmtCountdown(row.nextFundingMs)}</span>
          </div>
        );
      })}

      {/* States */}
      {status === 'loading' && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: '#444', fontSize: 12 }}>
          Fetching funding rates…
        </div>
      )}
      {status === 'error' && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: '#f87171', fontSize: 12 }}>
          Failed to load — retrying in 30s
        </div>
      )}

      {/* Footer */}
      {ts && (
        <div className="fc-footer">
          Rows sorted by |avg|. ⚡ = one exchange differs &gt;0.02% from avg — potential cross-exchange imbalance.
          Updated {new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.
        </div>
      )}
    </div>
  );
}
