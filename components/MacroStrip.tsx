'use client';
import { useState, useEffect } from 'react';
import { useMarket } from '@/lib/marketStore';

export default function MacroStrip() {
  const { store } = useMarket();
  const [jpyUsd, setJpyUsd] = useState<number | null>(null);

  useEffect(() => {
    const load = () =>
      fetch('/api/forex/jpy')
        .then(r => r.json())
        .then((d: { jpy?: number }) => { if (d?.jpy) setJpyUsd(d.jpy); })
        .catch(() => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  const jpyCol = jpyUsd == null ? 'var(--txt3)'
    : jpyUsd >= 160 ? 'var(--red)'
    : jpyUsd >= 158 ? 'var(--amber)'
    : 'var(--green)';
  const jpySig = jpyUsd == null ? null
    : jpyUsd >= 160 ? { txt: 'BOJ intervention risk', col: 'var(--red)' }
    : jpyUsd >= 158 ? { txt: 'Approaching danger', col: 'var(--amber)' }
    : { txt: 'Carry trade stable', col: 'var(--green)' };

  const items = [
    {
      label: 'DXY',
      price: store.dxy,
      chg: store.dxyChg,
      fmt: (v: number) => v.toFixed(2),
      signal: (chg: number) => chg > 0.2 ? { txt: 'USD strength → BTC headwind', col: 'var(--red)' }
                              : chg < -0.2 ? { txt: 'USD weakness → BTC tailwind', col: 'var(--green)' }
                              : { txt: 'Neutral', col: 'var(--txt3)' },
    },
    {
      label: 'SPX',
      price: store.spx,
      chg: store.spxChg,
      fmt: (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
      signal: (chg: number) => chg > 0.3 ? { txt: 'Risk-on → crypto tailwind', col: 'var(--green)' }
                              : chg < -0.5 ? { txt: 'Risk-off → crypto headwind', col: 'var(--red)' }
                              : { txt: 'Neutral', col: 'var(--txt3)' },
    },
    {
      label: 'Gold',
      price: store.gold,
      chg: store.goldChg,
      fmt: (v: number) => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
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
                {chg != null ? (chg >= 0 ? '↑ +' : '↓ ') + chg.toFixed(2) + '%' : '—'}
              </div>
              {sig && (
                <div className="macro-item-signal" style={{ color: sig.col }}>{sig.txt}</div>
              )}
            </div>
          );
        })}

        {/* JPY carry trade risk indicator */}
        <div className="macro-item">
          <div className="macro-item-label">JPY</div>
          <div className="macro-item-price" style={{ color: jpyCol }}>
            {jpyUsd != null ? jpyUsd.toFixed(2) : '—'}
          </div>
          <div className="macro-item-chg" style={{ color: jpyCol }}>
            {jpyUsd != null
              ? jpyUsd >= 160 ? 'Danger' : jpyUsd >= 158 ? 'Warning' : 'Safe'
              : '—'}
          </div>
          {jpySig && (
            <div className="macro-item-signal" style={{ color: jpySig.col }}>{jpySig.txt}</div>
          )}
        </div>
      </div>
    </div>
  );
}
