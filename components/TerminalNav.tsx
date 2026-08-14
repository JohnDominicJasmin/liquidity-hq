'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavDashboard, NavArena, NavScanner, NavTracking, NavJournal } from './icons';
import { getSessionName } from '@/lib/session';
import BrandMark from './BrandMark';

/* The Monochrome Terminal navigation (#413).
 *
 * Five destinations replacing twenty-five nav entries. The ROUTES are unchanged
 * - every page keeps its own URL and its own page.tsx, which QA and I both
 * verified against the handoff independently. This is a navigation change, not
 * a routing one: bookmarks, deep links and the sitemap all keep working.
 *
 * GLYPHS ARE THE REPO'S OWN, per README:72 - "Reuse those components rather
 * than the path strings in the prototypes". They are already currentColor and
 * already the right stroke weight, so the design's spec and the existing icons
 * agree without editing either.
 *
 * The seventeen other Nav* exports are not dead: the standalone routes still
 * exist and may want them for in-page headers. Do not delete them on the
 * strength of this file.
 */

interface Destination {
  key:   string;
  label: string;
  href:  string;
  Icon:  typeof NavDashboard;
  /** Every route this destination is the active one for. From the handoff's
   *  "Absorbs" table - `/funding` is still its own page, it just lights up
   *  Flow in the nav rather than having a nav entry of its own. */
  owns:  string[];
}

const DESTINATIONS: Destination[] = [
  { key: 'overview', label: 'OVERVIEW', href: '/dashboard', Icon: NavDashboard,
    owns: ['/dashboard', '/briefing'] },
  { key: 'arena',    label: 'ARENA',    href: '/arena',     Icon: NavArena,
    owns: ['/arena'] },
  { key: 'scan',     label: 'SCAN',     href: '/markets',   Icon: NavScanner,
    owns: ['/markets', '/scanner'] },
  { key: 'flow',     label: 'FLOW',     href: '/liq',       Icon: NavTracking,
    owns: ['/liq', '/funding', '/correlation'] },
  { key: 'book',     label: 'BOOK',     href: '/journal',   Icon: NavJournal,
    owns: ['/journal', '/alerts', '/calc', '/playbook', '/hours', '/research',
           '/news', '/econ-calendar', '/settings'] },
];

/** Which destination a path belongs to, or null when none does.
 *
 *  Exact match, not prefix. `/liq` must not claim `/liquidations-something`
 *  later, and the same reasoning as `isChromeless` in AppShell: a future route
 *  that merely starts with one of these words should be a deliberate decision,
 *  not something that silently inherits an active nav item. */
export function activeDestination(pathname: string): string | null {
  return DESTINATIONS.find(d => d.owns.includes(pathname))?.key ?? null;
}

export default function TerminalNav() {
  const pathname = usePathname();
  const active = activeDestination(pathname);

  return (
    <>
      {/* ── Desktop: one 44px bar ── */}
      <nav className="tnav" aria-label="Main navigation">
        <Link href="/dashboard" className="tnav-brand">
          {/* 18-26px in every nav bar and mobile header - README:197. */}
          <BrandMark size={22} tone="dark" />
          <span className="tnav-wordmark">LIQUIDITYHQ</span>
        </Link>

        <div className="tnav-items">
          {DESTINATIONS.map(d => (
            <Link
              key={d.key}
              href={d.href}
              className={`tnav-item${active === d.key ? ' on' : ''}`}
              aria-current={active === d.key ? 'page' : undefined}
              data-testid={`tnav-${d.key}`}
            >
              {d.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* ── Mobile: 38px header ──
          README:82 - "38px header (logo, screen name, status)". Missed in the
          first pass, which built only the tab bar: on a phone the app had no
          header at all, on every screen. QA found it, and it is shell-level -
          21 screens, not one.

          The screen name comes from the active destination rather than the
          path, so /funding reads FLOW - matching what the nav highlights
          instead of naming a route the design no longer surfaces. */}
      <header className="tnav-mhead">
        <BrandMark size={18} tone="dark" />
        <span className="tnav-mbrand">LIQUIDITYHQ</span>
        <span className="tnav-mscreen">{DESTINATIONS.find(d => d.key === active)?.label ?? ''}</span>
        <span className="tnav-mstatus">
          <span className="tnav-mdot" />
          {getSessionName(new Date())}
        </span>
      </header>

      {/* ── Mobile: 60px bottom tab bar ──
          Its own element rather than a media-query restyle of the desktop bar:
          the two carry different content (glyph + label vs label only) and the
          bottom bar is fixed while the top bar is not. */}
      <nav className="tnav-tabs" aria-label="Main navigation">
        {DESTINATIONS.map(d => {
          const { Icon } = d;
          return (
            <Link
              key={d.key}
              href={d.href}
              className={`tnav-tab${active === d.key ? ' on' : ''}`}
              aria-current={active === d.key ? 'page' : undefined}
              data-testid={`tnav-tab-${d.key}`}
            >
              <Icon size={19} />
              <span className="tnav-tab-label">{d.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
