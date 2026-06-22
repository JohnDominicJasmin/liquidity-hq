'use client';
import Link from 'next/link';
import { useMarket, COINS, COIN_DEC, fmtPrice, fmtChg, fmtVol, classifyFunding } from '@/lib/marketStore';

export default function PricesPage() {
  const { store, selectCoin } = useMarket();
  const { coins, wsStatus } = store;

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 0 2rem' }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 16px 10px', borderBottom: '0.5px solid var(--bdr)',
        position: 'sticky', top: 52, background: 'var(--bg)', zIndex: 10,
      }}>
        <Link href="/dashboard" style={{
          fontSize: 13, color: 'var(--txt3)', textDecoration: 'none',
          fontWeight: 600, letterSpacing: '.01em', padding: '4px 0', flexShrink: 0,
        }}>
          ← Back
        </Link>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--txt)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
          Live Prices
        </span>
        <span style={{ fontSize: 10, color: 'var(--txt3)', flexShrink: 0 }}>{wsStatus}</span>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto auto',
        padding: '6px 16px', gap: 8,
        borderBottom: '0.5px solid rgba(255,255,255,0.05)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase' }}>Coin</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase', textAlign: 'right', minWidth: 90 }}>Price</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase', textAlign: 'right', minWidth: 56 }}>24h</span>
      </div>

      {/* Coin rows */}
      {COINS.map(id => {
        const d = coins[id];
        const dec = COIN_DEC[id];
        const up = (d?.change ?? 0) >= 0;
        const fund = d?.fundingRate != null ? classifyFunding(d.fundingRate) : null;

        return (
          <div
            key={id}
            onClick={() => selectCoin(id)}
            style={{
              display: 'grid', gridTemplateColumns: '1fr auto auto',
              alignItems: 'center', gap: 8,
              padding: '11px 16px',
              borderBottom: '0.5px solid rgba(255,255,255,0.05)',
              cursor: 'pointer',
            }}
          >
            {/* Left: coin + secondary stats */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)', letterSpacing: '.04em' }}>
                  {id.toUpperCase()}
                </span>
                {fund && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4 }}
                    className={`ticker-fund ${fund.cls}`}>
                    FR {d!.fundingRate! >= 0 ? '+' : ''}{(d!.fundingRate! * 100).toFixed(4)}%
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {d?.vol24 != null && (
                  <span style={{ fontSize: 9, color: 'var(--txt3)' }}>
                    Vol: {fmtVol(d.vol24)}
                  </span>
                )}
                {d?.oi != null && (
                  <span style={{ fontSize: 9, color: '#505050' }}>
                    OI: {d.oi >= 1e9 ? '$' + (d.oi / 1e9).toFixed(2) + 'B' : '$' + (d.oi / 1e6).toFixed(1) + 'M'}
                  </span>
                )}
              </div>
            </div>

            {/* Price */}
            <span style={{
              fontSize: 14, fontWeight: 600, color: 'var(--txt)',
              letterSpacing: '-0.3px', fontVariantNumeric: 'tabular-nums',
              textAlign: 'right', minWidth: 90,
            }}>
              {d?.price ? '$' + fmtPrice(d.price, dec) : '---'}
            </span>

            {/* Change badge */}
            <span className={`ticker-chg ${d ? (up ? 'chg-up' : 'chg-dn') : ''}`}
              style={{ minWidth: 56, textAlign: 'center', fontSize: 11 }}>
              {d ? fmtChg(d.change) : '--%'}
            </span>
          </div>
        );
      })}

      <div style={{ padding: '16px', fontSize: 10, color: 'var(--txt3)', textAlign: 'center' }}>
        {COINS.length} coins · {wsStatus}
      </div>
    </div>
  );
}
