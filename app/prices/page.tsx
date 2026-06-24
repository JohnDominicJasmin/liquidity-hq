'use client';
import Link from 'next/link';
import { useMarket, COINS, COIN_DEC, fmtPrice, fmtChg, fmtVol, classifyFunding } from '@/lib/marketStore';

export default function PricesPage() {
  const { store, selectCoin } = useMarket();
  const { coins, wsStatus } = store;

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', paddingBottom: 80 }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px',
        borderBottom: '0.5px solid var(--bdr)',
        position: 'sticky', top: 52, background: 'var(--bg)', zIndex: 10,
      }}>
        <Link href="/dashboard" style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 12, color: 'var(--txt3)', textDecoration: 'none',
          fontWeight: 600, padding: '5px 10px', borderRadius: 8,
          border: '0.5px solid var(--bdr)', background: 'var(--bg1)',
          flexShrink: 0, letterSpacing: '.01em',
        }}>
          ← Back
        </Link>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)', letterSpacing: '.02em' }}>
            Live Prices
          </div>
          <div style={{ fontSize: 9, color: 'var(--txt3)', marginTop: 1, letterSpacing: '.02em' }}>
            {COINS.length} coins · {wsStatus}
          </div>
        </div>

        <span style={{
          fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 20,
          color: 'var(--green)', background: 'rgba(52,211,153,0.1)',
          border: '0.5px solid rgba(52,211,153,0.2)',
          letterSpacing: '.08em', textTransform: 'uppercase', flexShrink: 0,
        }}>
          Live
        </span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 110px 64px',
        padding: '5px 16px 5px 18px', gap: 8,
        borderBottom: '0.5px solid rgba(255,255,255,0.05)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.5 }}>Coin</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.08em', textTransform: 'uppercase', textAlign: 'right', opacity: 0.5 }}>Price</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.08em', textTransform: 'uppercase', textAlign: 'center', opacity: 0.5 }}>24h</span>
      </div>

      {/* Coin rows */}
      {COINS.map(id => {
        const d = coins[id];
        const dec = COIN_DEC[id];
        const up = (d?.change ?? 0) >= 0;
        const fr = d?.fundingRate;
        const frPct = fr != null ? (fr * 100) : null;
        const frColor = frPct == null ? 'var(--txt3)'
          : Math.abs(frPct) >= 0.05 ? (frPct > 0 ? 'var(--red)' : 'var(--green)')
          : 'var(--txt3)';
        const accentColor = up ? 'rgba(52,211,153,0.45)' : 'rgba(248,113,113,0.45)';

        return (
          <div
            key={id}
            onClick={() => selectCoin(id)}
            style={{
              display: 'grid', gridTemplateColumns: '1fr 110px 64px',
              alignItems: 'center', gap: 8,
              padding: '11px 16px 11px 14px',
              borderBottom: '0.5px solid rgba(255,255,255,0.05)',
              borderLeft: `2px solid ${accentColor}`,
              cursor: 'pointer',
              transition: 'background 0.1s',
            }}
          >
            {/* Left: coin name + secondary stats */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)', letterSpacing: '.03em' }}>
                  {id.toUpperCase()}
                </span>
                {frPct != null && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: frColor, letterSpacing: '.01em' }}>
                    {frPct >= 0 ? '+' : ''}{frPct.toFixed(4)}%
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {d?.vol24 != null && (
                  <span style={{ fontSize: 9, color: 'var(--txt3)', opacity: 0.7 }}>
                    Vol {fmtVol(d.vol24)}
                  </span>
                )}
                {d?.oi != null && (
                  <span style={{ fontSize: 9, color: 'var(--txt3)', opacity: 0.5 }}>
                    Open Interest {d.oi >= 1e9 ? '$' + (d.oi / 1e9).toFixed(2) + 'B' : '$' + (d.oi / 1e6).toFixed(1) + 'M'}
                  </span>
                )}
              </div>
            </div>

            {/* Price */}
            <span style={{
              fontSize: 14, fontWeight: 600, color: 'var(--txt)',
              letterSpacing: '-0.3px', fontVariantNumeric: 'tabular-nums',
              textAlign: 'right',
            }}>
              {d?.price ? '$' + fmtPrice(d.price, dec) : '---'}
            </span>

            {/* Change badge */}
            <div style={{ textAlign: 'center' }}>
              <span className={`ticker-chg ${d ? (up ? 'chg-up' : 'chg-dn') : ''}`}
                style={{ fontSize: 11 }}>
                {d ? fmtChg(d.change) : '--%'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
