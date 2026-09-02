'use client';
/* The Monochrome Terminal shell nav (#599, #413).
 *
 * Every one of the 18 design frames carries the identical nav - the same five
 * KEYS, the same 44px desktop bar, the same 38px mobile header and 60px bottom
 * tab bar. That is what makes this shell-level rather than per-screen: it is
 * not the dashboard's nav that arena happens to reuse, it is one nav that all
 * of them render inside.
 *
 * The CSS for it has existed since the #413 batch and was wired to nothing.
 * #616 corrected the desktop bar's values against the frames and #626 did the
 * mobile block; this file is what finally renders them.
 *
 * WHERE THE FIVE DESTINATIONS COME FROM. The frames name the keys - desk,
 * arena, scan, flow, book - but never bind them to routes, and the per-frame
 * "active" argument is not a mapping either: Setup Scanner.dc.html defines
 * navDesk, navArena, navScan, navFlow AND navBook in one file, because the
 * frames are a shared template exposing all five states as variants. The
 * binding for the three non-obvious ones comes from the landing frame's
 * feature grid, which is the only place the canvas defines what the words
 * mean: tag 'SCANNER' = "Setup scanner", tag 'FLOW' = "Funding and
 * correlation", tag 'JOURNAL' = "Journal and expectancy". PLAYBOOK is its own
 * separate tag there, which is what rules out book -> /playbook.
 *
 * WHAT IS DELIBERATELY NOT HERE. The frames draw a ⌘K chip in the desktop
 * bar and .tnav-kbd styles it. This product has no command palette - so the
 * chip is omitted rather than rendered, because a keyboard hint for a
 * shortcut that does not exist is decoration claiming to be functionality.
 * The CSS rule stays unused against the day a palette is built (#599).
 *
 * WHAT IS DELIBERATELY ADDED. The frames give mobile a five-item tab bar and
 * no drawer opener, but five tabs cannot reach twenty routes and the drawer
 * has to stay. The opener goes in the 38px header, in the space the frame
 * leaves empty, rather than as a sixth tab - the frame is explicit that the
 * tab bar is repeat(5,1fr) and silent about that gap, and a divergence
 * belongs where the design is silent, never where it is specific. */

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import BrandMark from './BrandMark';
import { useAuth } from './AuthProvider';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { getCurrentWindow, getLocalNow } from '@/lib/session';

/* Icon paths transcribed from the frames' own ICON map (Dashboard
   2a.dc.html:319-325), not redrawn. viewBox 0 0 20 20, stroked at 1.5 with
   round caps, exactly as the frames render them at :302. */
const ICON: Record<string, string> = {
  desk:  'M3.2 3.2h5.6v5.6H3.2zM11.2 3.2h5.6v5.6h-5.6zM3.2 11.2h5.6v5.6H3.2zM11.2 11.2h5.6v5.6h-5.6z',
  arena: 'M11 1.5 3.5 11.5H9L8 18.5 16 8H10.5L11 1.5Z',
  scan:  'M10 2.6v3.2M10 14.2v3.2M2.6 10h3.2M14.2 10h3.2M10 6.9a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2z',
  flow:  'M2.5 10.5h3l2-5 3 9 2-6 1.5 2h3.5',
  book:  'M5 2.8h8.5A1.5 1.5 0 0 1 15 4.3v12.9H6.5A1.5 1.5 0 0 1 5 15.7V2.8ZM5 14.2h10M7.5 6h4.5M7.5 9h4.5',
};

interface NavItem {
  key: string;
  href: string;
  /** Desktop bar label. 'desk' is the one key whose two labels differ - the
   *  frames draw OVERVIEW in the bar and DESK in the tab bar. */
  labelKey: LabelKey;
  /** Bottom tab label. */
  tabLabelKey: LabelKey;
}

const ITEMS: NavItem[] = [
  { key: 'desk',  href: '/dashboard', labelKey: 'TNAV_DESK_LABEL',  tabLabelKey: 'TNAV_DESK_TAB_LABEL' },
  { key: 'arena', href: '/arena',     labelKey: 'TNAV_ARENA_LABEL', tabLabelKey: 'TNAV_ARENA_LABEL' },
  { key: 'scan',  href: '/scanner',   labelKey: 'TNAV_SCAN_LABEL',  tabLabelKey: 'TNAV_SCAN_LABEL' },
  { key: 'flow',  href: '/funding',   labelKey: 'TNAV_FLOW_LABEL',  tabLabelKey: 'TNAV_FLOW_LABEL' },
  { key: 'book',  href: '/journal',   labelKey: 'TNAV_BOOK_LABEL',  tabLabelKey: 'TNAV_BOOK_LABEL' },
];

/* Minutes left in the window that is running right now.
 *
 * lib/session.ts has no helper for this - getCurrentWindow() answers "which
 * window" and getUpcomingWindows() counts down to FUTURE ones. So this walks
 * forward a minute at a time until the window changes, which is the same
 * technique getUpcomingWindows already uses internally to find a window's
 * start. The number therefore comes out of the enforced windows rather than
 * being estimated from their labels.
 *
 * Returns null when nothing is running, and the caller renders the session
 * name alone rather than a fabricated duration. The 8h ceiling is a guard,
 * not a business rule: the longest window this file defines is 4h30m, so
 * hitting it means the window logic changed and the honest answer is "no
 * duration" rather than a number from a runaway loop. */
function minutesLeftInWindow(now: Date): number | null {
  const current = getCurrentWindow(now);
  if (!current) return null;

  const LIMIT_MIN = 8 * 60;
  for (let m = 1; m <= LIMIT_MIN; m++) {
    const ahead = new Date(now.getTime() + m * 60_000);
    const win = getCurrentWindow(ahead);
    if (!win || win.name !== current.name) return m;
  }
  return null;
}

function formatRemaining(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** "Desk", "Arena", … for one of the five; otherwise the route's own last
 *  path segment. Derived from the URL rather than a hand-kept table, so a
 *  route with no nav entry still names itself instead of showing a generic
 *  placeholder or, worse, the wrong screen's name. */
function screenNameFor(pathname: string, t: (k: LabelKey) => string): string {
  const item = ITEMS.find(i => pathname === i.href || pathname.startsWith(i.href + '/'));
  if (item) return t(item.tabLabelKey);
  const seg = pathname.split('/').filter(Boolean).pop();
  return seg ? seg.replace(/-/g, ' ') : '';
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

interface TerminalNavProps {
  /** Opens the existing nav drawer. The frames draw no opener on mobile, and
   *  without one the ~15 drawer-only routes become unreachable in terminal. */
  onOpenDrawer: () => void;
}

export default function TerminalNav({ onOpenDrawer }: TerminalNavProps) {
  const pathname = usePathname();
  const { t } = useLabels();
  const { user } = useAuth();
  const [session, setSession] = useState<{ name: string; left: number | null } | null>(null);

  /* Resolved after mount, never during render: getLocalNow() reads the
     viewer's clock, so computing this on the server and again on the client
     produces two different strings for the same markup. Same reason
     DashboardTerminal's UTC stamp sits behind a mount guard. Re-derived every
     60s so the countdown and the window itself stay current without a
     reload. */
  useEffect(() => {
    const derive = () => {
      const now = getLocalNow();
      const win = getCurrentWindow(now);
      setSession(win ? { name: win.name, left: minutesLeftInWindow(now) } : null);
    };
    derive();
    const id = setInterval(derive, 60_000);
    return () => clearInterval(id);
  }, []);

  const initials = user?.email?.[0]?.toUpperCase() ?? '?';

  const tabs = (
    <nav className="tnav-tabs" aria-label={t('TNAV_ARIA_LABEL')}>
      {ITEMS.map(item => {
        const on = isActive(pathname, item.href);
        return (
          <Link
            key={item.key}
            href={item.href}
            className={`tnav-tab${on ? ' on' : ''}`}
            aria-current={on ? 'page' : undefined}
          >
            <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d={ICON[item.key]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="tnav-tab-label">{t(item.tabLabelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop 44px bar */}
      <header className="tnav">
        <Link href="/dashboard" className="tnav-brand">
          {/* tone/radius fixed rather than theme-derived: the frames use one
              logo asset in both the dark and light variants, and radius 0 is
              the design's blanket rule - it has no round elements. */}
          <BrandMark size={20} tone="mono" radiusPct={0} compact />
          <span className="tnav-wordmark">{t('TNAV_WORDMARK')}</span>
        </Link>

        <nav className="tnav-items" aria-label={t('TNAV_ARIA_LABEL')}>
          {ITEMS.map(item => {
            const on = isActive(pathname, item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`tnav-item${on ? ' on' : ''}`}
                aria-current={on ? 'page' : undefined}
              >
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div style={{ flex: 1 }} />

        <div className="tnav-right">
          {/* Rendered only once resolved - no skeleton, because an empty slot
              in a nav reads as "nothing here", while a shimmering bar reads as
              a value that is about to appear. */}
          {session && (
            <span className="tnav-session" suppressHydrationWarning>
              <span className="tnav-session-dot" />
              {session.left != null
                ? `${session.name} · ${formatRemaining(session.left)}`
                : session.name}
            </span>
          )}
          {/* No ⌘K chip - see the file header. */}
          {/* The avatar is the DESKTOP drawer opener. Hiding .app-bar for
              terminal takes the hamburger with it, and with it every route
              outside the five plus sign-out - so the bar needs an opener the
              same way the mobile header does. The frames draw this box but
              give it no behaviour at all, so attaching one adds nothing they
              specify and removes nothing either. */}
          <button
            type="button"
            className="tnav-avatar"
            onClick={onOpenDrawer}
            aria-haspopup="menu"
            aria-controls="nav-drawer"
            aria-label={t('TNAV_MORE_ARIA')}
          >
            {initials}
          </button>
        </div>
      </header>

      {/* Mobile 38px header */}
      <header className="tnav-mhead">
        <BrandMark size={18} tone="mono" radiusPct={0} compact />
        <span className="tnav-mbrand">{screenNameFor(pathname, t)}</span>
        <span className="tnav-mscreen" />
        {session && (
          <span className="tnav-mstatus" suppressHydrationWarning>
            <span className="tnav-mdot" />
            {session.name}
          </span>
        )}
        <button type="button" className="tnav-mmore" onClick={onOpenDrawer} aria-label={t('TNAV_MORE_ARIA')}>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {tabs}
    </>
  );
}
