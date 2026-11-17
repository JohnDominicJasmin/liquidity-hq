'use client';
import { useState, useEffect } from 'react';
import { useMarket } from '@/lib/marketStore';
import { useLabels } from '@/lib/labels';

export default function MacroStrip() {
  const { store } = useMarket();
  const { t } = useLabels();
  const [jpyUsd, setJpyUsd] = useState<number | null>(null);

  useEffect(() => {
    const load = () =>
      fetch('/api/forex/jpy')
        .then(r => r.json())
        .then((d: { jpy?: number }) => { if (d?.jpy) setJpyUsd(d.jpy); })
        .catch(() => {});
    load();
    const timer = setInterval(load, 5 * 60_000);
    return () => clearInterval(timer);
  }, []);

  const jpyCol = jpyUsd == null ? 'var(--txt3)'
    : jpyUsd >= 160 ? 'var(--red)'
    : jpyUsd >= 158 ? 'var(--amber)'
    : 'var(--green)';
  const jpySig = jpyUsd == null ? null
    : jpyUsd >= 160 ? { txt: t('MACRO_STRIP_JPY_INTERVENTION'), col: 'var(--red)' }
    : jpyUsd >= 158 ? { txt: t('MACRO_STRIP_JPY_APPROACHING', { level: '158' }), col: 'var(--amber)' }
    : { txt: t('MACRO_STRIP_JPY_CARRY_STABLE'), col: 'var(--green)' };

  const items = [
    {
      label: 'DXY',
      price: store.dxy,
      chg: store.dxyChg,
      fmt: (v: number) => v.toFixed(2),
      signal: (chg: number) => chg > 0.2 ? { txt: t('MACRO_STRIP_DXY_UP'), col: 'var(--red)' }
                              : chg < -0.2 ? { txt: t('MACRO_STRIP_DXY_DOWN'), col: 'var(--green)' }
                              : { txt: t('MACRO_STRIP_NEUTRAL'), col: 'var(--txt3)' },
    },
    {
      label: 'SPX',
      price: store.spx,
      chg: store.spxChg,
      fmt: (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
      signal: (chg: number) => chg > 0.3 ? { txt: t('MACRO_STRIP_SPX_UP', { pct: `${Math.abs(chg).toFixed(1)}%` }), col: 'var(--green)' }
                              : chg < -0.5 ? { txt: t('MACRO_STRIP_SPX_DOWN', { pct: `${Math.abs(chg).toFixed(1)}%` }), col: 'var(--red)' }
                              : { txt: t('MACRO_STRIP_NEUTRAL'), col: 'var(--txt3)' },
    },
    {
      label: t('MACRO_STRIP_GOLD'),
      price: store.gold,
      chg: store.goldChg,
      fmt: (v: number) => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
      signal: (chg: number) => chg > 0.5 ? { txt: t('MACRO_STRIP_GOLD_UP'), col: 'var(--amber)' }
                              : chg < -0.5 ? { txt: t('MACRO_STRIP_GOLD_DOWN'), col: 'var(--green)' }
                              : { txt: t('MACRO_STRIP_NEUTRAL'), col: 'var(--txt3)' },
    },
  ];

  return (
    <div className="macro-strip">
      <div className="macro-strip-title">{t('MACRO_STRIP_TITLE')}</div>
      <div className="macro-strip-row">
        {items.map(({ label, price, chg, fmt, signal }) => {
          const sig = chg != null ? signal(chg) : null;
          return (
            <div key={label} className="macro-item">
              <div className="macro-item-label">{label}</div>
              <div className="macro-item-price">
                {price != null ? fmt(price) : '-'}
              </div>
              <div className="macro-item-chg" style={{
                color: chg == null ? 'var(--txt3)' : chg >= 0 ? 'var(--green)' : 'var(--red)',
              }}>
                {chg != null ? (chg >= 0 ? '↑ +' : '↓ ') + chg.toFixed(2) + '%' : '-'}
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
            {jpyUsd != null ? jpyUsd.toFixed(2) : '-'}
          </div>
          <div className="macro-item-chg" style={{ color: jpyCol }}>
            {jpyUsd != null
              ? jpyUsd >= 160 ? t('MACRO_STRIP_JPY_DANGER') : jpyUsd >= 158 ? t('MACRO_STRIP_JPY_WARNING') : t('MACRO_STRIP_JPY_SAFE')
              : '-'}
          </div>
          {jpySig && (
            <div className="macro-item-signal" style={{ color: jpySig.col }}>{jpySig.txt}</div>
          )}
        </div>
      </div>
    </div>
  );
}
