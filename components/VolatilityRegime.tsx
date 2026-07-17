'use client';
import { useEffect, useState } from 'react';
import Tip from './Tip';

interface HVData {
  hv30:       number;   // current 30-day annualized HV %
  percentile: number;   // 0–100, where current HV sits vs past ~120 days
  regime:     'low' | 'neutral' | 'high';
}

const REGIME_META = {
  low:     { label: 'Low Vol',  col: '#34d399', bg: 'rgba(52,211,153,0.10)',  bdr: 'rgba(52,211,153,0.3)',  hint: 'Build positions - volatility likely to expand' },
  neutral: { label: 'Normal',   col: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  bdr: 'rgba(251,191,36,0.3)',  hint: 'Standard position sizing' },
  high:    { label: 'High Vol', col: '#f87171', bg: 'rgba(248,113,113,0.10)', bdr: 'rgba(248,113,113,0.3)', hint: 'Reduce exposure or hedge' },
};

const CACHE_KEY = 'lhq_vol_regime';
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours - daily data barely changes

function calcHV(symbol: string): Promise<HVData | null> {
  return fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=152`)
    .then(r => r.ok ? r.json() : null)
    .then((data: [number, string, string, string, string][] | null) => {
      if (!data || data.length < 32) return null;

      const closes = data.map(c => parseFloat(c[4]));

      // Log returns
      const logRets: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        logRets.push(Math.log(closes[i] / closes[i - 1]));
      }

      // Rolling 30-day annualized HV
      function hv30(rets: number[]): number {
        const n    = rets.length;
        const mean = rets.reduce((s, r) => s + r, 0) / n;
        const vari = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
        return Math.sqrt(vari * 252) * 100;
      }

      const hvSeries: number[] = [];
      for (let i = 0; i <= logRets.length - 30; i++) {
        hvSeries.push(hv30(logRets.slice(i, i + 30)));
      }

      if (hvSeries.length < 2) return null;

      const current = hvSeries[hvSeries.length - 1];
      const history = hvSeries.slice(0, -1);
      const pct     = Math.round((history.filter(h => h <= current).length / history.length) * 100);
      const regime: HVData['regime'] = pct < 20 ? 'low' : pct > 80 ? 'high' : 'neutral';

      return {
        hv30:       Math.round(current * 10) / 10,
        percentile: pct,
        regime,
      };
    })
    .catch(() => null);
}

type LoadState = HVData | null | 'loading';

function HVRow({ label, data }: { label: string; data: LoadState }) {
  if (data === 'loading') return (
    <div style={{ padding: '9px 0', borderTop: '0.5px solid var(--bdr)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', minWidth: 28 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Loading…</span>
    </div>
  );

  if (!data) return (
    <div style={{ padding: '9px 0', borderTop: '0.5px solid var(--bdr)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', minWidth: 28 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Unavailable</span>
    </div>
  );

  const m = REGIME_META[data.regime];

  return (
    <div style={{ padding: '9px 0', borderTop: '0.5px solid var(--bdr)' }}>
      {/* Top row: coin + regime badge + HV% + percentile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt2)', minWidth: 28, flexShrink: 0 }}>{label}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
          background: m.bg, color: m.col, border: `0.5px solid ${m.bdr}`,
          letterSpacing: '0.03em',
        }}>
          {m.label}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, fontWeight: 800, color: m.col, fontFamily: 'var(--font-mono), monospace' }}>
          {data.hv30}%
        </span>
        <span style={{ fontSize: 10, color: 'var(--txt3)', fontFamily: 'var(--font-mono), monospace' }}>
          p{data.percentile}
        </span>
      </div>

      {/* Percentile track */}
      <div style={{ position: 'relative', height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'visible' }}>
        {/* Low zone (0–20%) */}
        <div style={{ position: 'absolute', left: 0, width: '20%', height: '100%', background: 'rgba(52,211,153,0.2)', borderRadius: '3px 0 0 3px' }} />
        {/* High zone (80–100%) */}
        <div style={{ position: 'absolute', left: '80%', width: '20%', height: '100%', background: 'rgba(248,113,113,0.2)', borderRadius: '0 3px 3px 0' }} />
        {/* Marker dot */}
        <div style={{
          position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
          width: 9, height: 9, borderRadius: '50%',
          background: m.col, border: '1.5px solid var(--bg2)',
          left: `${data.percentile}%`,
          boxShadow: `0 0 6px ${m.col}66`,
        }} />
      </div>

      {/* Hint */}
      <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 5 }}>{m.hint}</div>
    </div>
  );
}

export default function VolatilityRegime() {
  const [btc, setBtc] = useState<LoadState>('loading');
  const [eth, setEth] = useState<LoadState>('loading');

  useEffect(() => {
    // Try localStorage cache first
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { ts, btcData, ethData } = JSON.parse(raw) as { ts: number; btcData: HVData; ethData: HVData };
        if (Date.now() - ts < CACHE_TTL) {
          setBtc(btcData);
          setEth(ethData);
          return;
        }
      }
    } catch { /* ignore */ }

    // Fetch fresh
    Promise.all([calcHV('BTCUSDT'), calcHV('ETHUSDT')]).then(([btcData, ethData]) => {
      setBtc(btcData);
      setEth(ethData);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), btcData, ethData }));
      } catch { /* ignore */ }
    });
  }, []);

  return (
    <div style={{ padding: '12px 14px' }}>
      {/* Header */}
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--txt3)', marginBottom: 2,
      }}>
        <Tip width={300} text="Historical Volatility (HV) measures how much price has moved over the past 30 days, annualized. The percentile shows where today's HV sits vs. the past ~120 days. Low vol historically precedes expansion - volatility mean-reverts. High vol means the market is already moving hard: size down or hedge.">
          Volatility Regime
        </Tip>
      </div>

      {/* Zone legend */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 2 }}>
        {(['low', 'neutral', 'high'] as const).map(r => {
          const m = REGIME_META[r];
          return (
            <span key={r} style={{ fontSize: 11, color: m.col, display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.col, flexShrink: 0 }} />
              {r === 'low' ? '< p20' : r === 'high' ? '> p80' : 'p20–p80'}
            </span>
          );
        })}
      </div>

      <HVRow label="BTC" data={btc} />
      <HVRow label="ETH" data={eth} />
    </div>
  );
}
