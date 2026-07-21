'use client';
import { useState } from 'react';
import type { CoinId } from '@/lib/marketStore';
import { withAlpha } from '@/lib/color';

/** Crypto coin icon - locally bundled real logo for every supported coin (public/coin-icons/{coin}.png). */
export default function CoinIcon({ coin, size = 22, color, bg }: { coin: CoinId; size?: number; color?: string; bg?: string }) {
  const [failed, setFailed] = useState(false);
  const src = `/coin-icons/${coin}.png`;
  // Every supported coin has a bundled icon file, so this should never trigger. If a file is
  // ever missing, fall back to a plain neutral circle - never a letter/text abbreviation.
  if (failed) {
    return (
      <span style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: bg ?? 'rgba(255,255,255,0.07)',
        border: `0.5px solid ${color ? withAlpha(color, '44') : 'rgba(255,255,255,0.1)'}`,
        display: 'inline-block',
      }} />
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
