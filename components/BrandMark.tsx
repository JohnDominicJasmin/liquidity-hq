// LiquidityHQ mark - "Ladder L": an L (stem + foot) beside 2 or 3 ascending
// bars. Recreated pixel-for-pixel from the design handoff's MarkLadder
// component (App logo redesign-handoff/project/MarkLadder.dc.html) - every
// percentage below is copied from that source, not eyeballed.
//
// The L's two rects are fixed regardless of variant. The bars differ:
// non-compact renders 3 (dim/accent/accent2, each 9.5% wide) sharing a
// baseline at 75.5%; compact (<=24px use) renders 2 thicker bars (14% wide,
// accent/accent2 only - no dim bar) so it doesn't turn to mush at small
// sizes. Every bar's top is computed from its own height so all bars share
// the same 75.5% baseline as the L's foot.
export type MarkTone = 'dark' | 'light' | 'mono';

interface BrandMarkProps {
  size: number;
  tone?: MarkTone;
  compact?: boolean;
  accent?: string;
  radiusPct?: number;
  className?: string;
}

const BASELINE = 75.5;

function tonePalette(tone: MarkTone, accent: string) {
  if (tone === 'light') {
    // accent2 intentionally equals accent here (not a second blue) - the
    // light tone uses one blue plus a neutral gray, matching the source.
    return { bg: '#EEF2F8', fg: '#0A1020', dim: '#A9BBD2', accent, accent2: accent };
  }
  if (tone === 'mono') {
    return { bg: '#080C15', fg: '#FFFFFF', dim: '#FFFFFF', accent: '#FFFFFF', accent2: '#FFFFFF' };
  }
  return { bg: '#080C15', fg: '#F4F7FB', dim: '#1C3E76', accent, accent2: '#6FD3FF' };
}

export default function BrandMark({
  size, tone = 'dark', compact = false, accent = '#2E7BFF', radiusPct = 22.5, className,
}: BrandMarkProps) {
  const p = tonePalette(tone, accent);
  const bars = compact
    ? [{ left: 51, w: 14, h: 30, color: p.accent }, { left: 69, w: 14, h: 45.5, color: p.accent2 }]
    : [
        { left: 51,   w: 9.5, h: 17, color: p.dim },
        { left: 63.5, w: 9.5, h: 29, color: p.accent },
        { left: 76,   w: 9.5, h: 42, color: p.accent2 },
      ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={{ flex: '0 0 auto', display: 'block' }}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx={radiusPct} ry={radiusPct} fill={p.bg} />
      <rect x="14" y="22" width="11.5" height="42" fill={p.fg} />
      <rect x="14" y="64" width="29" height="11.5" fill={p.fg} />
      {bars.map((b) => (
        <rect key={b.left} x={b.left} y={BASELINE - b.h} width={b.w} height={b.h} fill={b.color} />
      ))}
    </svg>
  );
}
