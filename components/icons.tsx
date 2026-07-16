import type { CSSProperties } from 'react';

/**
 * Shared inline SVG icons — replaces emoji/glyph iconography in the UI so it
 * renders consistently (per-OS emoji looks vibe-coded) and follows CSS `color`
 * via currentColor. Match the tab-bar SVG style: viewBox 0 0 20 20, 1.5px stroke.
 */

interface IconProps {
  size?: number;
  style?: CSSProperties;
}

/** Warning triangle — inherits color from parent (amber/red warning text). */
export function Warn({ size = 13, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-2px', flexShrink: 0, ...style }}
    >
      <path d="M10 2.6 18.4 17H1.6L10 2.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <line x1="10" y1="8" x2="10" y2="11.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14.2" r="0.95" fill="currentColor" />
    </svg>
  );
}
