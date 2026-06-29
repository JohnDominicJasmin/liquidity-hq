'use client';
import { useMemo } from 'react';
import { useMarket, COINS, computeSqueezeScore, classifyFunding } from '@/lib/marketStore';

interface BarItem {
  text: string;
  color: string;
  bold?: boolean;
  pulse?: boolean;
}

export default function MarketSummaryBar() {
  const { store } = useMarket();

  const { shortSqCount, longLiqCount, setupCount } = useMemo(() => {
    let shortSqCount = 0;
    let longLiqCount = 0;
    let setupCount   = 0;
    for (const id of COINS) {
      const { score, dir } = computeSqueezeScore(store.coins[id]);
      if (dir === 'NEUTRAL') continue;
      if (score >= 65) {
        if (dir === 'SHORT_SQ') shortSqCount++;
        else longLiqCount++;
      } else if (score >= 45) {
        setupCount++;
      }
    }
    return { shortSqCount, longLiqCount, setupCount };
  }, [store.coins]);

  const btcFr     = store.coins['btc']?.fundingRate;
  const frClass   = btcFr != null ? classifyFunding(btcFr) : null;
  const frPct     = btcFr != null ? (btcFr * 100).toFixed(4) + '%' : null;
  const frColor   = frClass?.rpm === 'pos' ? '#f87171'
                  : frClass?.rpm === 'neg' ? '#34d399'
                  : '#6b7280';

  const cascade = store.cascadeAlert &&
    Date.now() - store.cascadeAlert.ts < 30 * 60_000
    ? store.cascadeAlert : null;

  const hasData = Object.keys(store.coins).length > 0;
  if (!hasData) return null;

  const items: BarItem[] = [];

  if (cascade) {
    const side = cascade.side === 'LONG' ? 'longs' : cascade.side === 'SHORT' ? 'shorts' : 'market';
    const usd  = cascade.totalUsd >= 1e6
      ? `$${(cascade.totalUsd / 1e6).toFixed(0)}M`
      : `$${(cascade.totalUsd / 1e3).toFixed(0)}K`;
    items.push({ text: `⚡ ${cascade.coin} ${usd} cascade — ${side} flushed`, color: '#f87171', bold: true, pulse: true });
  }

  if (shortSqCount > 0) {
    items.push({ text: `${shortSqCount} short squeeze${shortSqCount > 1 ? 's' : ''} active`, color: '#34d399' });
  }
  if (longLiqCount > 0) {
    items.push({ text: `${longLiqCount} long flush${longLiqCount > 1 ? 'es' : ''} active`, color: '#f87171' });
  }
  if (shortSqCount === 0 && longLiqCount === 0) {
    items.push({ text: 'no active squeezes', color: '#3a3a4a' });
  }

  if (frClass && frPct) {
    items.push({ text: `BTC FR ${frPct} · ${frClass.label.toLowerCase()}`, color: frColor });
  }

  if (setupCount > 0) {
    items.push({ text: `${setupCount} setup${setupCount > 1 ? 's' : ''} forming`, color: '#f59e0b' });
  }

  if (store.fng != null) {
    const fngColor = store.fng <= 24 ? '#34d399' : store.fng >= 75 ? '#f87171' : '#6b7280';
    items.push({ text: `F&G ${store.fng} · ${store.fngLabel?.toLowerCase()}`, color: fngColor });
  }

  return (
    <div style={{
      position: 'fixed',
      top: 52,
      left: 0,
      right: 0,
      zIndex: 998,
      height: 30,
      background: '#05040a',
      borderBottom: '0.5px solid rgba(255,255,255,0.055)',
      display: 'flex',
      alignItems: 'center',
      overflow: 'hidden',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 11,
    }}>
      {/* LIVE indicator */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '0 10px 0 13px',
        borderRight: '0.5px solid rgba(255,255,255,0.055)',
        height: '100%',
      }}>
        <div style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: '#34d399',
          boxShadow: '0 0 5px rgba(52,211,153,0.8)',
          animation: 'pulse 2s infinite',
          flexShrink: 0,
        }} />
        <span style={{ color: '#34d399', fontWeight: 700, fontSize: 9, letterSpacing: '0.1em' }}>LIVE</span>
      </div>

      {/* Scrollable items */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        flex: 1,
        overflowX: 'auto',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
        paddingLeft: 12,
        paddingRight: 12,
        gap: 0,
      } as React.CSSProperties}>
        {items.map((item, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {i > 0 && (
              <span style={{ color: 'rgba(255,255,255,0.1)', padding: '0 10px', flexShrink: 0 }}>·</span>
            )}
            <span style={{
              color: item.color,
              fontWeight: item.bold ? 700 : 500,
              whiteSpace: 'nowrap',
              animation: item.pulse ? 'pulse 1.5s infinite' : undefined,
            }}>
              {item.text}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
