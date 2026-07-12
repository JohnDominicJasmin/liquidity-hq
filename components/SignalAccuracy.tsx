'use client';
import { useEffect, useState } from 'react';

interface SignalStat {
  name:       string;
  label:      string;
  timeframe:  string;
  direction:  'long' | 'short';
  count:      number;
  accuracy3:  number;
  accuracy6:  number;
  avgReturn3: number;
  avgReturn6: number;
}

interface ApiResponse {
  stats:   SignalStat[];
  candles: number;
  error?:  string;
}

function accColor(pct: number): string {
  if (pct >= 70) return '#34d399';
  if (pct >= 55) return '#fbbf24';
  return '#f87171';
}

function retColor(r: number): string {
  if (r > 0.5)  return '#34d399';
  if (r > 0)    return '#6ee7b7';
  if (r > -0.5) return '#fca5a5';
  return '#f87171';
}

function accBar(pct: number, color: string) {
  return (
    <div style={{ height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginTop: 3 }}>
      <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function SignalAccuracy() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [err,  setErr]  = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/signal-accuracy')
      .then(r => r.ok ? r.json() : Promise.reject(`${r.status}`))
      .then((d: ApiResponse) => {
        if (d.error) setErr(d.error);
        else setData(d);
      })
      .catch(e => setErr(String(e)));
  }, []);

  return (
    <div style={{
      background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
      borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px 10px', borderBottom: '0.5px solid var(--bdr)',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase', flex: 1 }}>
          Signal Accuracy Tracker
        </span>
        {data?.candles && (
          <span style={{ fontSize: 9, color: '#444' }}>BTC · 4H · last {data.candles} candles</span>
        )}
        <span style={{ fontSize: 9, color: '#444' }}>10 min cache</span>
      </div>

      {/* Loading / error */}
      {!data && !err && (
        <div style={{ padding: '20px 14px', fontSize: 12, color: '#444' }}>Computing signal accuracy…</div>
      )}
      {err && (
        <div style={{ padding: '16px 14px', fontSize: 12, color: '#f87171' }}>Failed to load: {err}</div>
      )}

      {/* Column headers */}
      {data?.stats && data.stats.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 52px 80px 80px 64px',
            minWidth: 340,
            padding: '5px 14px',
            borderBottom: '0.5px solid rgba(255,255,255,0.05)',
            background: 'rgba(255,255,255,0.02)',
          }}>
            {[['Signal', 'left'], ['TF', 'right'], ['Win Rate 12h', 'right'], ['Win Rate 24h', 'right'], ['Count', 'right']].map(
              ([h, align]) => (
                <span key={h} style={{
                  fontSize: 9, fontWeight: 600, letterSpacing: '.07em',
                  textTransform: 'uppercase', color: '#333', textAlign: align as 'left' | 'right',
                }}>
                  {h}
                </span>
              )
            )}
          </div>

          {data.stats.map(sig => {
            const col3 = accColor(sig.accuracy3);
            const col6 = accColor(sig.accuracy6);
            const dirIcon = sig.direction === 'long' ? '↑' : '↓';
            const dirColor = sig.direction === 'long' ? '#34d399' : '#f87171';
            return (
              <div
                key={sig.name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 52px 80px 80px 64px',
                  minWidth: 340,
                  alignItems: 'center',
                  padding: '8px 14px',
                  borderBottom: '0.5px solid rgba(255,255,255,0.04)',
                }}
              >
                {/* Signal name */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: dirColor }}>{dirIcon}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt)' }}>{sig.label}</span>
                  </div>
                  <span style={{ fontSize: 9, color: '#444' }}>
                    avg {sig.direction === 'long' ? '+' : ''}{sig.avgReturn6.toFixed(2)}% at 24h
                  </span>
                </div>

                {/* Timeframe */}
                <span style={{ fontSize: 10, fontWeight: 600, color: '#555', textAlign: 'right' }}>
                  {sig.timeframe}
                </span>

                {/* Accuracy +3 candles */}
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: col3 }}>{sig.accuracy3}%</span>
                  {accBar(sig.accuracy3, col3)}
                </div>

                {/* Accuracy +6 candles */}
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: col6 }}>{sig.accuracy6}%</span>
                  {accBar(sig.accuracy6, col6)}
                </div>

                {/* Signal count */}
                <span style={{ fontSize: 10, color: '#444', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {sig.count}×
                </span>
              </div>
            );
          })}

          {/* Footer */}
          <div style={{ padding: '6px 14px 8px', borderTop: '0.5px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: 9, color: '#333' }}>
              Win Rate = % of signals where price moved in the expected direction after 12h or 24h
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
