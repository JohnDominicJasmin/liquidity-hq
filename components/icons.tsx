import type { CSSProperties, ReactNode } from 'react';

/**
 * Shared inline SVG icons - replaces emoji/glyph iconography in the UI so it
 * renders consistently (per-OS emoji looks vibe-coded) and follows CSS `color`
 * via currentColor. Match the tab-bar SVG style: viewBox 0 0 20 20, 1.5px stroke.
 */

interface IconProps {
  size?: number;
  style?: CSSProperties;
}

/** Warning triangle - inherits color from parent (amber/red warning text). */
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

/** Download / install-to-device glyph - used for "Add to Home Screen" prompts. */
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

/** Sun - light-mode indicator, used by the nav theme toggle and Settings'
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

/** Moon - dark-mode indicator, same context as IconSun above. */
export function IconMoon({ size = 16, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" style={style}>
      <path d="M16.5 12.7A7 7 0 0 1 7.3 3.5 7 7 0 1 0 16.5 12.7Z" fill="currentColor" />
    </svg>
  );
}

/** Article/no-image placeholder - News cards without a thumbnail used to
    render a completely empty solid-color block (read as a rendering bug,
    "solid black card"). A muted glyph reads as an intentional placeholder. */
export function ArticleIcon({ size = 26, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" style={style}>
      <rect x="3" y="4" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <line x1="6" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="6" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="6" y1="14" x2="11" y2="14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/* ── Nav icons ──────────────────────────────────────────────────────────────
   One glyph per destination for the mobile nav grid. All share the house
   style: viewBox 0 0 20 20, currentColor, ~1.5px stroke, so they follow the
   tile's active/inactive text color. Kept in one file so the whole nav set
   reads as a single visual language. ── */
function svg(size: number, style: CSSProperties | undefined, children: ReactNode) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" style={style}>
      {children}
    </svg>
  );
}

export function NavDashboard({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <rect x="2.5" y="2.5" width="6" height="6" rx="1.4" fill="currentColor" />
    <rect x="11.5" y="2.5" width="6" height="6" rx="1.4" fill="currentColor" opacity="0.5" />
    <rect x="2.5" y="11.5" width="6" height="6" rx="1.4" fill="currentColor" opacity="0.5" />
    <rect x="11.5" y="11.5" width="6" height="6" rx="1.4" fill="currentColor" />
  </>);
}
export function NavBriefing({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <circle cx="10" cy="10" r="3.6" fill="currentColor" />
    <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="10" y1="1.5" x2="10" y2="3.2" /><line x1="10" y1="16.8" x2="10" y2="18.5" />
      <line x1="1.5" y1="10" x2="3.2" y2="10" /><line x1="16.8" y1="10" x2="18.5" y2="10" />
      <line x1="4.2" y1="4.2" x2="5.4" y2="5.4" /><line x1="14.6" y1="14.6" x2="15.8" y2="15.8" />
      <line x1="15.8" y1="4.2" x2="14.6" y2="5.4" /><line x1="5.4" y1="14.6" x2="4.2" y2="15.8" />
    </g>
  </>);
}
export function NavArena({ size = 20, style }: IconProps) {
  return svg(size, style, <path d="M11 1.5 3.5 11.5H9L8 18.5 16 8H10.5L11 1.5Z" fill="currentColor" />);
}
export function NavMarkets({ size = 20, style }: IconProps) {
  return svg(size, style, <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="6" y1="3" x2="6" y2="17" /><rect x="4" y="6" width="4" height="7" rx="1" fill="currentColor" stroke="none" />
    <line x1="14" y1="3.5" x2="14" y2="16.5" /><rect x="12" y="8" width="4" height="6" rx="1" fill="currentColor" stroke="none" />
  </g>);
}
export function NavPrices({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <path d="M10 3.2v13.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M13 6.2c0-1.5-1.4-2.3-3-2.3S7 4.7 7 6.1s1.4 2 3 2.4 3 1 3 2.5-1.4 2.4-3 2.4-3-.9-3-2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>);
}
export function NavScanner({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
    <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 10 15 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="10" cy="10" r="1.1" fill="currentColor" />
  </>);
}
export function NavLiqMap({ size = 20, style }: IconProps) {
  return svg(size, style, <path d="M7.4 2.7 2.8 4.5v12.8l4.6-1.8 5.2 1.8 4.6-1.8V2.7l-4.6 1.8-5.2-1.8Zm0 0v12.8m5.2-11v12.8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />);
}
export function NavFunding({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <line x1="5" y1="15" x2="15" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="6.4" cy="6.4" r="2.1" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="13.6" cy="13.6" r="2.1" stroke="currentColor" strokeWidth="1.5" />
  </>);
}
export function NavCorrelation({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <path d="M3 17V3M3 17h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="7" cy="12" r="1.3" fill="currentColor" /><circle cx="10" cy="8.5" r="1.3" fill="currentColor" />
    <circle cx="13" cy="10" r="1.3" fill="currentColor" /><circle cx="15.5" cy="6" r="1.3" fill="currentColor" />
  </>);
}
export function NavBacktest({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <path d="M3.5 10a6.5 6.5 0 1 1 1.9 4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M3.2 6.2 3.5 10l3.8-.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 7v3.2l2.3 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>);
}
export function NavTracking({ size = 20, style }: IconProps) {
  return svg(size, style, <path d="M2.5 10.5h3l2-5 3 9 2-6 1.5 2h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />);
}
export function NavResearch({ size = 20, style }: IconProps) {
  return svg(size, style, <path d="M8 2.5h4M8.4 2.5v5L4.3 15a1.6 1.6 0 0 0 1.4 2.5h8.6A1.6 1.6 0 0 0 15.7 15l-4.1-7.5v-5M6.7 11.5h6.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />);
}
export function NavNews({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <circle cx="5" cy="15" r="1.8" fill="currentColor" />
    <path d="M5 9.6C9.3 9.6 12.6 12.9 12.6 17.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M5 5.2C11.5 5.2 15.8 9.5 15.8 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </>);
}
export function NavCalendar({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <rect x="3" y="4" width="14" height="13" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
    <line x1="3" y1="7.8" x2="17" y2="7.8" stroke="currentColor" strokeWidth="1.5" />
    <line x1="6.5" y1="2.5" x2="6.5" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="13.5" y1="2.5" x2="13.5" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="7" cy="11.5" r="1" fill="currentColor" /><circle cx="10.5" cy="11.5" r="1" fill="currentColor" />
  </>);
}
export function NavJournal({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <path d="M5 2.8h8.5A1.5 1.5 0 0 1 15 4.3v12.9H6.5A1.5 1.5 0 0 1 5 15.7V2.8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M5 14.2h10" stroke="currentColor" strokeWidth="1.5" />
    <line x1="7.5" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="7.5" y1="9" x2="12" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>);
}
export function NavCalc({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <rect x="4" y="2.5" width="12" height="15" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
    <rect x="6.4" y="4.8" width="7.2" height="3" rx="0.8" fill="currentColor" />
    <g fill="currentColor"><circle cx="7.2" cy="11" r="0.9" /><circle cx="10" cy="11" r="0.9" /><circle cx="12.8" cy="11" r="0.9" /><circle cx="7.2" cy="14.2" r="0.9" /><circle cx="10" cy="14.2" r="0.9" /><circle cx="12.8" cy="14.2" r="0.9" /></g>
  </>);
}
export function NavAlerts({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <path d="M5.2 8.4a4.8 4.8 0 0 1 9.6 0c0 4 1.4 5.4 1.4 5.4H3.8s1.4-1.4 1.4-5.4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M8.4 16.2a1.8 1.8 0 0 0 3.2 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>);
}
export function NavHours({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 5.8V10l3 1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </>);
}
export function NavPlaybook({ size = 20, style }: IconProps) {
  return svg(size, style, <path d="M10 5.2C8.4 3.9 6.4 3.4 3.5 3.4v11c2.9 0 4.9.5 6.5 1.8 1.6-1.3 3.6-1.8 6.5-1.8v-11c-2.9 0-4.9.5-6.5 1.8Zm0 0v10.6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />);
}
export function NavSettings({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </>);
}
export function NavAbout({ size = 20, style }: IconProps) {
  return svg(size, style, <>
    <circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.5" />
    <line x1="10" y1="9" x2="10" y2="13.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="10" cy="6.3" r="1" fill="currentColor" />
  </>);
}
