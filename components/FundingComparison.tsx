'use client';
import { useEffect, useState, useCallback } from 'react';

interface FundingRow {
  coin:          string;
  binance:       number | null;
  bybit:         number | null;
  okx:           number | null;
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

export default function FundingComparison() {
  const [rows,   setRows]   = useState<FundingRow[]>([]);
  const [ts,     setTs]     = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/funding');
      const json = await res.json();
      if (json.data) {
        const sorted = [...json.data].sort((a: FundingRow, b: FundingRow) => {
          const aa = Math.abs(avgOf([a.binance, a.bybit, a.okx]) ?? 0);
          const ba = Math.abs(avgOf([b.binance, b.bybit, b.okx]) ?? 0);
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

  const dotCls =
    status === 'ok'    ? 'wf-dot-live'       :
    status === 'error' ? 'wf-dot-error'      : 'wf-dot-connecting';

  return (
    <div className="fc-wrap">
      {/* Header */}
      <div className="fc-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#e8e8e8' }}>💸 Funding Rates</span>
          <span className={`wf-dot ${dotCls}`} />
        </div>
        <span style={{ fontSize: 11, color: '#444' }}>Binance · Bybit · OKX · 30s refresh</span>
      </div>

      {/* Legend */}
      <div className="fc-legend">
        <span style={{ color: '#f97316' }}>▲ +0.01%+ longs paying</span>
        <span style={{ color: '#ef4444' }}>▲ +0.05%+ extreme</span>
        <span style={{ color: '#34d399' }}>▼ −0.01%− shorts paying</span>
        <span style={{ color: '#22d3ee' }}>▼ −0.05%− extreme</span>
        <span style={{ color: '#555' }}>⚡ &gt;0.02% divergence</span>
      </div>

      {/* Column headers */}
      <div className="fc-col-hdr">
        <span>Coin</span>
        <span>Binance</span>
        <span>Bybit</span>
        <span>OKX</span>
        <span>Avg</span>
        <span style={{ textAlign: 'right' }}>Next</span>
      </div>

      {/* Data rows */}
      {rows.map(row => {
        const vals = [row.binance, row.bybit, row.okx];
        const mean = avgOf(vals);
        return (
          <div key={row.coin} className="fc-row">
            <span className="fc-coin">{row.coin.toUpperCase()}</span>

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
          Sorted by |avg|. Positive = longs paying. ⚡ = one exchange &gt;0.02% from avg.
          Updated {new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.
        </div>
      )}
    </div>
  );
}
