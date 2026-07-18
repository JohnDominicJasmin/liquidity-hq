'use client';
import { useState } from 'react';
import type { CoinId } from '@/lib/marketStore';
import { withAlpha } from '@/lib/color';

/** Crypto coin icon - CDN with letter-avatar fallback. */
export default function CoinIcon({ coin, size = 22, color, bg }: { coin: CoinId; size?: number; color?: string; bg?: string }) {
  const [failed, setFailed] = useState(false);
  // cryptocurrency-icons covers BTC/ETH/SOL/XRP/BNB/DOGE/AVAX/LINK/ADA/DOT/ATOM/NEAR
  // HYPE/SUI/WIF/PEPE/BONK are too new - onError falls through to letter avatar
  const src = `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${coin}.svg`;
  if (failed) {
    return (
      <span style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: bg ?? 'rgba(255,255,255,0.07)',
        border: `0.5px solid ${color ? withAlpha(color, '44') : 'rgba(255,255,255,0.1)'}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.38), fontWeight: 800,
        color: color ?? '#555',
      }}>
        {coin.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={coin}
      width={size}
      height={size}
      style={{ borderRadius: '50%', flexShrink: 0, display: 'block' }}
      onError={() => setFailed(true)}
    />
  );
}
