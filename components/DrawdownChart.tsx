'use client';
import { useEffect, useState } from 'react';
import { useMarket, COINS, CoinId } from '@/lib/marketStore';
import Tip from '@/components/Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';

interface AthEntry {
  ath: number;
  athDate: string;
  drawdownPct: number;
}

function drawdownColor(pct: number): string {
  const abs = Math.abs(pct);
  if (abs >= 80) return '#ef4444';
  if (abs >= 60) return '#f87171';
  if (abs >= 40) return '#fb923c';
  if (abs >= 20) return '#fbbf24';
  return '#34d399';
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return '-';
  }
}

function fmtPrice(p: number): string {
  if (p >= 1000)  return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1)     return '$' + p.toFixed(2);
  if (p >= 0.01)  return '$' + p.toFixed(4);
  return '$' + p.toFixed(7);
}

/* /api/ath covers 17 coins (CG_IDS in app/api/ath/route.ts), and every one of
   them ends up as a row here, so the loading skeleton renders the same count.
   Kept as a constant rather than inlined so the link between the two is
   visible: if that map grows, this follows. */
const SKELETON_ROWS = 17;

export default function DrawdownChart() {
  const { t } = useLabels();
  const { store } = useMarket();
  const [ath, setAth] = useState<Record<string, AthEntry> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/ath')
      .then(r => r.ok ? r.json() : Promise.reject(`${r.status}`))
      .then(setAth)
      .catch(e => setErr(String(e)));
  }, []);

  const rows = COINS
    .map(c => {
      const entry    = ath?.[c];
      const curPrice = store.coins[c]?.price ?? null;
      const drawdown = entry?.drawdownPct ?? null;
      return { c, curPrice, drawdown, ath: entry?.ath ?? null, athDate: entry?.athDate ?? null };
    })
    .filter(r => r.drawdown != null)
    .sort((a, b) => (a.drawdown ?? 0) - (b.drawdown ?? 0)); // most drawdown first

  const nearAth = rows.filter(r => Math.abs(r.drawdown!) < 20).length;

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
        <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase', flex: 1 }}>
          <Tip text={t('DRAWDOWN_CHART_TOOLTIP')}>{t('DRAWDOWN_CHART_TITLE')}</Tip>
        </span>
        {nearAth > 0 && (
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 7px', borderRadius: 20, color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '0.5px solid rgba(52,211,153,0.25)' }}>
            {t('DRAWDOWN_CHART_NEAR_ATH_BADGE', { count: nearAth })}
          </span>
        )}
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>{t('DRAWDOWN_CHART_SOURCE')}</span>
      </div>

      {/* Loading / error states */}
      {!ath && !err && (
        /* One skeleton row per coin this card will actually show, shaped like a
           real row (label line + bar). Five generic bars reserved ~120px where
           the loaded card needs ~650, so the card grew by 454px the moment the
           data landed and shoved everything below it down the page - the
           single largest card-growth on /scanner. A skeleton that does not
           match the shape it is standing in for is decoration, not a
           placeholder. */
        <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 7 }} role="status" aria-live="polite">
          <span className="sr-only">{t('DRAWDOWN_CHART_LOADING_SR')}</span>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: Math.max(0.25, 1 - i * 0.05) }}>
              <SkeletonBar width="45%" height={11} radius={4} />
              <SkeletonBar height={10} radius={4} />
            </div>
          ))}
        </div>
      )}
      {err && (
        <div style={{ padding: '16px 14px', fontSize: 'var(--fs-caption)', color: '#f87171' }}>{t('DRAWDOWN_CHART_ERROR', { error: err })}</div>
      )}

      {/* Bar chart rows */}
      {ath && rows.length === 0 && (
        <div style={{ padding: '20px 14px', fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>{t('DRAWDOWN_CHART_EMPTY')}</div>
      )}

      {ath && rows.length > 0 && (
        <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {rows.map(({ c, curPrice, drawdown, ath: athPrice, athDate }) => {
            const absDd  = Math.abs(drawdown!);
            const barPct = Math.min(100, absDd);
            const col    = drawdownColor(drawdown!);
            const isNear = absDd < 20;
            return (
              <div key={c}>
                {/* Coin label + values */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: isNear ? '#34d399' : 'var(--txt)', width: 40, flexShrink: 0 }}>
                    {c.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: col, fontVariantNumeric: 'tabular-nums', minWidth: 52 }}>
                    {drawdown!.toFixed(1)}%
                  </span>
                  {curPrice != null && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtPrice(curPrice)}
                    </span>
                  )}
                  {athPrice != null && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', fontVariantNumeric: 'tabular-nums' }}>
                      {t('DRAWDOWN_CHART_ATH_PRICE', { price: fmtPrice(athPrice) })}
                    </span>
                  )}
                  {athDate && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', marginLeft: 'auto' }}>
                      {fmtDate(athDate)}
                    </span>
                  )}
                </div>
                {/* Bar */}
                <div style={{ height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99,
                    width: barPct + '%',
                    background: col,
                    transition: 'width .5s ease',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '5px 14px 8px', borderTop: '0.5px solid rgba(255,255,255,0.05)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {([
          { labelKey: 'DRAWDOWN_CHART_LEGEND_UNDER_20', col: '#34d399' },
          { labelKey: 'DRAWDOWN_CHART_LEGEND_20_40', col: '#fbbf24' },
          { labelKey: 'DRAWDOWN_CHART_LEGEND_40_60', col: '#fb923c' },
          { labelKey: 'DRAWDOWN_CHART_LEGEND_60_80', col: '#f87171' },
          { labelKey: 'DRAWDOWN_CHART_LEGEND_OVER_80', col: '#ef4444' },
        ] as const).map(({ labelKey, col }) => (
          <span key={labelKey} style={{ fontSize: 'var(--fs-caption)', color: col, fontWeight: 600 }}>{t(labelKey)}</span>
        ))}
      </div>
    </div>
  );
}
