'use client';
import { useMarket } from '@/lib/marketStore';

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

interface Signal { label: string; value: string; score: number; max: number; color: string; }

export default function BtcRiskLevel() {
  const { store } = useMarket();
  const fng    = store.fng;
  const btcDom = store.btcDom;
  const btcRsi = store.coins['btc']?.rsiDaily ?? null;
  const btcFr  = store.coins['btc']?.fundingRate ?? null;

  let total = 0, maxPossible = 0;
  const signals: Signal[] = [];

  if (fng != null) {
    const s = (fng / 100) * 33;
    total += s; maxPossible += 33;
    const c = fng > 70 ? '#f87171' : fng < 30 ? '#34d399' : '#fbbf24';
    signals.push({ label: 'Fear & Greed', value: String(fng), score: s, max: 33, color: c });
  }

  if (btcRsi != null) {
    const s = clamp((btcRsi - 30) / 50, 0, 1) * 33;
    total += s; maxPossible += 33;
    const c = btcRsi > 70 ? '#f87171' : btcRsi < 30 ? '#34d399' : '#fbbf24';
    signals.push({ label: 'BTC RSI (Daily)', value: btcRsi.toFixed(1), score: s, max: 33, color: c });
  }

  if (btcFr != null) {
    const pct = btcFr * 100;
    const s = clamp(Math.abs(btcFr) / 0.001, 0, 1) * 34;
    total += s; maxPossible += 34;
    const c = Math.abs(pct) > 0.05 ? '#f87171' : '#34d399';
    const sign = pct >= 0 ? '+' : '';
    signals.push({ label: 'Funding Rate', value: `${sign}${pct.toFixed(4)}%`, score: s, max: 34, color: c });
  }

  const score = maxPossible > 0 ? Math.round((total / maxPossible) * 100) : null;

  const { label, color } = score == null
    ? { label: '—', color: 'var(--txt3)' }
    : score <= 30 ? { label: 'Low Risk',      color: '#34d399' }
    : score <= 55 ? { label: 'Moderate',       color: '#fbbf24' }
    : score <= 75 ? { label: 'High Risk',      color: '#fb923c' }
    :               { label: 'Extreme Risk',   color: '#f87171' };

  return (
    <div style={{
      background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
      borderRadius: 14, padding: '14px 16px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase' }}>
          BTC Risk Level
        </span>
        {score != null && (
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
            color, background: color + '18', border: `0.5px solid ${color}44`,
            padding: '2px 7px', borderRadius: 20,
          }}>{label}</span>
        )}
      </div>

      {/* Score */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 36, fontWeight: 800, color: score != null ? color : 'var(--txt3)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {score ?? '—'}
        </span>
        <span style={{ fontSize: 12, color: 'var(--txt3)' }}>/ 100</span>
        {btcDom != null && (
          <span style={{ fontSize: 11, color: 'var(--txt3)', marginLeft: 'auto' }}>
            BTC Dom {btcDom.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Progress bar */}
      {score != null && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 99, width: score + '%', background: color, transition: 'width .4s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 9, color: '#34d399' }}>Low</span>
            <span style={{ fontSize: 9, color: '#fbbf24' }}>Moderate</span>
            <span style={{ fontSize: 9, color: '#fb923c' }}>High</span>
            <span style={{ fontSize: 9, color: '#f87171' }}>Extreme</span>
          </div>
        </div>
      )}

      {/* Signal breakdown */}
      {signals.length > 0 ? (
        <div style={{ borderTop: '0.5px solid var(--bdr)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {signals.map(sig => (
            <div key={sig.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--txt3)', width: 120, flexShrink: 0 }}>{sig.label}</span>
              <div style={{ flex: 1, height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 99, width: `${(sig.score / sig.max) * 100}%`, background: sig.color }} />
              </div>
              <span style={{ fontSize: 10, color: sig.color, width: 72, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {sig.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Waiting for market data…</div>
      )}
    </div>
  );
}
