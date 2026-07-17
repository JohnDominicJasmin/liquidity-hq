'use client';
import { useMarket, COIN_DEC, fmtPrice, computeCoinHealth } from '@/lib/marketStore';
import type { CoinId } from '@/lib/marketStore';
import { useSettings } from '@/lib/settings';
import { coinBadgeColor } from '@/lib/coinBadge';
import Sparkline24h from '@/components/Sparkline24h';

export default function WatchlistFeed() {
  const { store, selectCoin } = useMarket();
  const { settings } = useSettings();
  const watchlist = settings.watchlist ?? [];

  if (watchlist.length === 0) {
    return (
      <div style={{ padding: '12px 0', fontSize: 12, color: 'var(--txt3)' }}>
        No coins in your watchlist.{' '}
        <a href="/settings" style={{ color: 'var(--accent-2)', textDecoration: 'none' }}>Add coins →</a>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
      {watchlist.map(id => {
        const d      = store.coins[id as CoinId];
        const dec    = COIN_DEC[id as CoinId] ?? 2;
        const chg    = d?.change ?? 0;
        const up     = chg >= 0;
        const sel    = store.selectedCoin === id;
        const health = computeCoinHealth(d);
        const badgeCol = coinBadgeColor(id);

        // Top signal - same priority logic as CoinSidebar
        let sig: { text: string; col: string } | null = null;
        if (d?.fundingRate != null) {
          const fr = d.fundingRate * 100;
          if (fr >= 0.04)       sig = { text: 'Longs overcrowded', col: '#f87171' };
          else if (fr <= -0.02) sig = { text: 'Shorts squeezed',   col: '#34d399' };
        }
        if (!sig && d?.cvdDivergence === 'bullish') sig = { text: 'Smart buyers active', col: '#34d399' };
        if (!sig && d?.cvdDivergence === 'bearish') sig = { text: 'Smart sellers active', col: '#f87171' };
        if (!sig && d?.oiTrend === 'strong_up')     sig = { text: 'New buyers opening',   col: '#34d399' };
        if (!sig && d?.oiTrend === 'strong_down')   sig = { text: 'New sellers opening',  col: '#f87171' };

        return (
          <div
            key={id}
            onClick={() => selectCoin(id as CoinId)}
            style={{
              background: sel ? 'var(--accent-bg)' : 'linear-gradient(180deg, var(--bg2) 0%, var(--bg1) 100%)',
              border: `0.5px solid ${sel ? 'var(--accent-bdr)' : 'var(--bdr)'}`,
              borderRadius: 'var(--radius-card)',
              padding: '10px 12px',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            {/* Top row: badge + name + health grade */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 6 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 800, fontFamily: 'var(--font-mono), monospace',
                  background: badgeCol + '24', color: badgeCol, border: `0.5px solid ${badgeCol}55`,
                }}>
                  {id.slice(0, 2).toUpperCase()}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', letterSpacing: '.03em' }}>
                  {id.toUpperCase()}
                </span>
              </span>
              {d?.price && (
                <span style={{
                  fontSize: 11, fontWeight: 800,
                  padding: '1px 4px', borderRadius: 4,
                  color: health.color,
                  background: health.color + '22',
                  border: `0.5px solid ${health.color}55`,
                  letterSpacing: '.04em',
                }}>
                  {health.grade}
                </span>
              )}
            </div>

            {/* Price */}
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>
              {d?.price ? '$' + fmtPrice(d.price, dec) : '-'}
            </div>

            {/* Change + sparkline */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: up ? '#34d399' : '#f87171' }}>
                {up ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%
              </span>
              <Sparkline24h coin={id} width={40} height={14} />
            </div>

            {/* Signal */}
            {sig ? (
              <div style={{ fontSize: 10, color: sig.col, lineHeight: 1.3 }}>{sig.text}</div>
            ) : (
              <div style={{ fontSize: 10, color: 'var(--txt3)' }}>No signal</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
