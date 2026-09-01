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
      <span className="coin-icon" style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: bg ?? 'rgba(255,255,255,0.07)',
        border: `0.5px solid ${color ? withAlpha(color, '44') : 'rgba(255,255,255,0.1)'}`,
        display: 'inline-block',
      }} />
    );
  }
  return (
    // Deliberately a plain <img>, not next/image. These are 22px PNGs already
    // bundled in public/coin-icons and dozens render at once in coin lists and
    // tables. next/image would put each one through the image optimizer for no
    // gain at that size, and none of them is ever the LCP element - the rule is
    // arguing about a cost this particular image does not have.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="coin-icon"
      src={src}
      alt={coin}
      width={size}
      height={size}
      style={{ borderRadius: '50%', flexShrink: 0, display: 'block' }}
      onError={() => setFailed(true)}
    />
  );
}
