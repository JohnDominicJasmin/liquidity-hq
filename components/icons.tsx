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

/** Download / install-to-device glyph — used for "Add to Home Screen" prompts. */
export function Download({ size = 14, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-2px', flexShrink: 0, ...style }}
    >
      <path d="M10 3v9.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 9.2 10 13.2 14 9.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 15.3v1.2c0 .72.58 1.3 1.3 1.3h10.4c.72 0 1.3-.58 1.3-1.3v-1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Sun — light-mode indicator, used by the nav theme toggle and Settings'
    theme chips (previously three separately-inlined copies). */
export function IconSun({ size = 16, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" style={style}>
      <circle cx="10" cy="10" r="3.5" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="10" y1="1.5" x2="10" y2="3.3" />
        <line x1="10" y1="16.7" x2="10" y2="18.5" />
        <line x1="1.5" y1="10" x2="3.3" y2="10" />
        <line x1="16.7" y1="10" x2="18.5" y2="10" />
        <line x1="4" y1="4" x2="5.3" y2="5.3" />
        <line x1="14.7" y1="14.7" x2="16" y2="16" />
        <line x1="16" y1="4" x2="14.7" y2="5.3" />
        <line x1="5.3" y1="14.7" x2="4" y2="16" />
      </g>
    </svg>
  );
}

/** Moon — dark-mode indicator, same context as IconSun above. */
export function IconMoon({ size = 16, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" style={style}>
      <path d="M16.5 12.7A7 7 0 0 1 7.3 3.5 7 7 0 1 0 16.5 12.7Z" fill="currentColor" />
    </svg>
  );
}
