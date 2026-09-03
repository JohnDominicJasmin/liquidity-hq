'use client';
import { useState } from 'react';
import type { CoinId } from '@/lib/marketStore';
import { withAlpha } from '@/lib/color';

/** Crypto coin icon - locally bundled real logo for every supported coin (public/coin-icons/{coin}.png). */
/* `square` exists because the radius is set INLINE below, and an inline style
 * beats a stylesheet rule without !important - so a terminal-scoped CSS
 * override would have silently done nothing. That is exactly how #629's first
 * attempt at hiding the price ticker failed, and the lesson is the same one:
 * when the component sets the value, the component owns the decision.
 *
 * Opt-in rather than derived from `size`, so the current design's own 26px
 * marks are untouched - the project's radius ruling (50% only on inherently
 * circular glyphs, <=24px) is what makes the terminal's 26px one wrong, and
 * only that call site is being corrected here. The frames keep their 16px
 * rail marks round, so this is not "squares everywhere". */
export default function CoinIcon({ coin, size = 22, color, bg, square = false }: { coin: CoinId; size?: number; color?: string; bg?: string; square?: boolean }) {
  const radius = square ? 0 : '50%';
  const [failed, setFailed] = useState(false);
  const src = `/coin-icons/${coin}.png`;
  // Every supported coin has a bundled icon file, so this should never trigger. If a file is
  // ever missing, fall back to a plain neutral shape in the same silhouette as
  // the icon it replaces - never a letter/text abbreviation.
  if (failed) {
    return (
      <span className="coin-icon" style={{
        width: size, height: size, borderRadius: radius, flexShrink: 0,
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
      style={{ borderRadius: radius, flexShrink: 0, display: 'block' }}
      onError={() => setFailed(true)}
    />
  );
}
