'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMarket } from '@/lib/marketStore';
import { useAuth } from './AuthProvider';
import { track } from '@/lib/analytics';
import SettingsModal from './SettingsModal';
import { getCurrentWindow } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { withAlpha } from '@/lib/color';
import {
  IconSun, IconMoon,
  NavDashboard, NavBriefing, NavArena, NavMarkets, NavPrices, NavScanner,
  NavLiqMap, NavFunding, NavCorrelation, NavBacktest, NavTracking, NavResearch,
  NavNews, NavCalendar, NavJournal, NavCalc, NavAlerts, NavHours, NavPlaybook,
  NavSettings, NavAbout,
} from './icons';
import type { ComponentType } from 'react';

/* ── Mobile tab bar icons - plain SVGs, not emoji. Emoji glyphs like ⚡ render
   as native color emoji on most platforms (a hardcoded yellow bolt) and
   ignore CSS `color` entirely, which is why Arena's icon stayed yellow
   regardless of active state. currentColor lets these follow the same
   active/inactive styling as the label text. ── */
function IconDashboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="7" height="7" rx="1.5" fill="currentColor" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}
function IconArena() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M11 1.5 3.5 11.5H9L8 18.5 16 8H10.5L11 1.5Z" fill="currentColor" />
    </svg>
  );
}
function IconBriefing() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="10" y1="1" x2="10" y2="3" />
        <line x1="10" y1="17" x2="10" y2="19" />
        <line x1="1" y1="10" x2="3" y2="10" />
        <line x1="17" y1="10" x2="19" y2="10" />
        <line x1="3.5" y1="3.5" x2="5" y2="5" />
        <line x1="15" y1="15" x2="16.5" y2="16.5" />
        <line x1="16.5" y1="3.5" x2="15" y2="5" />
        <line x1="5" y1="15" x2="3.5" y2="16.5" />
      </g>
    </svg>
  );
}
function IconNews() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="5" cy="15" r="2" fill="currentColor" />
      <path d="M5 9.5C9.5 9.5 13 13 13 17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 5C12.5 5 17 9.5 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconMore() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="4" cy="10" r="1.8" fill="currentColor" />
      <circle cx="10" cy="10" r="1.8" fill="currentColor" />
      <circle cx="16" cy="10" r="1.8" fill="currentColor" />
    </svg>
  );
}

/* ── Session pill ──────────────────────────────────────────────────────────── */
function pad2(n: number) { return String(n).padStart(2, '0'); }
function findEndsInMs(nowMs: number, name: string): number {
  for (let t = nowMs + 60_000; t < nowMs + 6 * 3600_000; t += 60_000) {
    const w = getCurrentWindow(new Date(t));
    if (!w || w.name !== name) return t - nowMs;
  }
  return 6 * 3600_000;
}
function SessionPill() {
  // This pill is rendered on every page (via the root layout), most of which
  // are statically prerendered - so "is a window active" can only be decided
  // once we're actually on the client with the real current time. Gating on
  // `mounted` makes the server render (and client's first render, before this
  // effect runs) always emit nothing, avoiding a hydration mismatch on
  // whether this element exists at all (suppressHydrationWarning can't help
  // here - it only covers text content, not element presence).
  const [mounted, setMounted] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  if (!mounted) return null;
  const win = getCurrentWindow(new Date(nowMs));
  if (!win) return null;
  const endsMs = findEndsInMs(nowMs, win.name);
  const h = Math.floor(endsMs / 3_600_000);
  const m = Math.floor((endsMs % 3_600_000) / 60_000);
  const timeStr = h > 0 ? `${h}h ${pad2(m)}m` : `${m}m left`;
  return (
    <div suppressHydrationWarning className="session-pill" style={{ color: win.color, background: win.bg, borderColor: withAlpha(win.color, '44') }}>
      <span className="session-pill-dot" style={{ background: win.color }} />
      {win.name.toUpperCase()} · {timeStr}
    </div>
  );
}

/* ── Nav data ──────────────────────────────────────────────────────────────── */
const PRIMARY = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/arena',     label: 'Arena'     },
  { path: '/briefing',  label: 'Briefing'  },
];

const SCANNERS = [
  { path: '/markets',     label: 'Markets'           },
  { path: '/prices',      label: 'Live Prices'       },
  { path: '/scanner',     label: 'Setup Scanner'     },
  { path: '/liq',         label: 'Liquidation Map'   },
  { path: '/funding',     label: 'FR History'        },
  { path: '/correlation', label: 'Correlation'       },
  { path: '/backtest',    label: 'Backtest'          },
  { path: '/live-tracking', label: 'Live Tracking'   },
];

const TOOLS = [
  { path: '/journal',        label: 'Journal'             },
  { path: '/research',       label: 'Research'            },
  { path: '/calc',           label: 'Calculators'         },
  { path: '/econ-calendar',  label: 'Economic Calendar'   },
  { path: '/alerts',         label: 'Alerts'              },
  { path: '/hours',          label: 'Best Hours'          },
  { path: '/playbook',       label: 'Playbook'            },
];

const TAIL = [
  { path: '/news', label: 'News' },
];

type NavIcon = ComponentType<{ size?: number }>;
type NavDest = { path: string; label: string; Icon: NavIcon; modal?: boolean };
type NavSection = { header: string; items: NavDest[] };

const NAV_SECTIONS: NavSection[] = [
  { header: 'Main', items: [
    { path: '/dashboard', label: 'Dashboard', Icon: NavDashboard },
    { path: '/briefing',  label: 'Briefing',  Icon: NavBriefing },
  ] },
  { header: 'Analysis', items: [
    { path: '/arena',         label: 'Arena',           Icon: NavArena },
    { path: '/markets',       label: 'Markets',         Icon: NavMarkets },
    { path: '/prices',        label: 'Live Prices',     Icon: NavPrices },
    { path: '/scanner',       label: 'Setup Scanner',   Icon: NavScanner },
    { path: '/liq',           label: 'Liquidation Map', Icon: NavLiqMap },
    { path: '/funding',       label: 'FR History',      Icon: NavFunding },
    { path: '/correlation',   label: 'Correlation',     Icon: NavCorrelation },
    { path: '/backtest',      label: 'Backtest',        Icon: NavBacktest },
    { path: '/live-tracking', label: 'Live Tracking',   Icon: NavTracking },
  ] },
  { header: 'Research', items: [
    { path: '/research',      label: 'Research',          Icon: NavResearch },
    { path: '/news',          label: 'News',              Icon: NavNews },
    { path: '/econ-calendar', label: 'Economic Calendar', Icon: NavCalendar },
    { path: '/learn',         label: 'Glossary',          Icon: NavPlaybook },
  ] },
  { header: 'My Tools', items: [
    { path: '/journal',  label: 'Journal',        Icon: NavJournal },
    { path: '/calc',     label: 'Position Sizer', Icon: NavCalc },
    { path: '/alerts',   label: 'Alerts',         Icon: NavAlerts },
    { path: '/hours',    label: 'Best Hours',     Icon: NavHours },
    { path: '/playbook', label: 'Playbook',       Icon: NavPlaybook },
  ] },
  { header: 'Account', items: [
    { path: '/settings', label: 'Settings', Icon: NavSettings, modal: true },
    { path: '/about',    label: 'About',    Icon: NavAbout },
  ] },
];

const ALL_DESTS: NavDest[] = NAV_SECTIONS.flatMap(s => s.items);

/* ── Status dot ────────────────────────────────────────────────────────────── */
function useStatusDot() {
  const { store } = useMarket();
  const ws = store.wsStatus;
  if (!ws || ws === 'Connecting...') return { cls: 'dot-connecting', title: 'Connecting…' };
  if (ws.includes('backup')) return { cls: 'dot-rest', title: 'Live · backup feed' };
  if (ws === 'Live') return { cls: 'dot-live', title: 'Live' };
  return { cls: 'dot-error', title: 'Connection error' };
}

/* ── Dropdown component ────────────────────────────────────────────────────── */
type DropKey = 'scanners' | 'tools';

function NavDropdown({ label, items, open, onToggle, onClose, pathname }: {
  label: string;
  items: { path: string; label: string }[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  pathname: string;
}) {
  const isActive = items.some(i => pathname === i.path);
  return (
    <div className="nav-more-wrap" onClick={e => e.stopPropagation()}>
      <button
        className={`desktop-nav-item nav-more-btn${open || isActive ? ' on' : ''}`}
        onClick={onToggle}
      >
        {label} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="nav-more-dropdown">
          {items.map(item => (
            <Link
              key={item.path}
              href={item.path}
              className={`nav-more-item${pathname === item.path ? ' on' : ''}`}
              onClick={onClose}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── NavDrawer ─────────────────────────────────────────────────────────────── */
export default function NavDrawer() {
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [navQuery, setNavQuery]         = useState('');
  const [openDrop, setOpenDrop]         = useState<DropKey | null>(null);
  const [authOpen, setAuthOpen]         = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { theme, toggleTheme }          = useTheme();
  const pathname = usePathname();
  const router   = useRouter();
  const dot      = useStatusDot();
  const { user, loading: authLoading, signOut } = useAuth();
  const authRef  = useRef<HTMLDivElement>(null);
  const initials = user?.email?.[0]?.toUpperCase() ?? '?';

  // "More" tab is active whenever we're not on one of the 4 direct bottom-nav
  // destinations - so the bottom bar always shows where you are (the tab, or
  // "More" for the ~21 drawer-only screens).
  const PRIMARY_TAB_PATHS = ['/dashboard', '/arena', '/briefing', '/news'];
  const moreActive = !PRIMARY_TAB_PATHS.includes(pathname);

  // Hide the floating Ask AI button while the mobile nav drawer is open -
  // it otherwise sits on top of the bottom nav links and eats their taps.
  useEffect(() => {
    document.body.classList.toggle('nav-drawer-open', drawerOpen);
    if (!drawerOpen) setNavQuery(''); // reopen clean
    return () => { document.body.classList.remove('nav-drawer-open'); };
  }, [drawerOpen]);

  useEffect(() => {
    if (!openDrop) return;
    const handler = () => setOpenDrop(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openDrop]);

  useEffect(() => {
    if (!authOpen) return;
    const handler = (e: MouseEvent) => {
      if (authRef.current && !authRef.current.contains(e.target as Node)) setAuthOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [authOpen]);

  const toggleDrop = (key: DropKey) => setOpenDrop(v => v === key ? null : key);
  const closeDrop  = () => setOpenDrop(null);

  return (
    <>
      <div className="app-bar">
        <div className="app-bar-inner">
          <Link href="/dashboard" className="app-logo" style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            LiquidityHQ
            <span className={`status-dot ${dot.cls}`} title={dot.title} />
          </Link>

          <nav className="desktop-nav">
            {PRIMARY.map(item => (
              <Link
                key={item.path}
                href={item.path}
                className={`desktop-nav-item${pathname === item.path ? ' on' : ''}`}
              >
                {item.label}
              </Link>
            ))}

            <NavDropdown
              label="Scanners"
              items={SCANNERS}
              open={openDrop === 'scanners'}
              onToggle={() => toggleDrop('scanners')}
              onClose={closeDrop}
              pathname={pathname}
            />

            <NavDropdown
              label="Tools"
              items={TOOLS}
              open={openDrop === 'tools'}
              onToggle={() => toggleDrop('tools')}
              onClose={closeDrop}
              pathname={pathname}
            />

            {TAIL.map(item => (
              <Link
                key={item.path}
                href={item.path}
                className={`desktop-nav-item${pathname === item.path ? ' on' : ''}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="app-bar-right">
            <div className="session-pill-wrap">
              <SessionPill />
            </div>

            <button
              className="theme-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>

            {!authLoading && (
              user ? (
                <div className="auth-wrap" ref={authRef}>
                  <button
                    className="auth-avatar-btn"
                    onClick={() => setAuthOpen(v => !v)}
                    title={user.email ?? 'Account'}
                    aria-label="Account menu"
                  >
                    {initials}
                  </button>
                  {authOpen && (
                    <div className="auth-dropdown">
                      <div className="auth-dropdown-email">{user.email}</div>
                      <Link href="/arena" className="auth-dropdown-usage" onClick={() => setAuthOpen(false)}>
                        LiquidityAI - <span>view usage</span>
                      </Link>
                      <button
                        className="auth-dropdown-usage"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', padding: 0 }}
                        onClick={() => { setAuthOpen(false); setSettingsOpen(true); }}
                      >
                        Settings
                      </button>
                      <button
                        className="auth-signout-btn"
                        onClick={async () => {
                          setAuthOpen(false);
                          track.signOut();
                          await signOut();
                          router.push('/login');
                        }}
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link href="/login" className="auth-signin-btn">Sign In</Link>
              )
            )}

            <div className={`hamburger${drawerOpen ? ' open' : ''}`} onClick={() => setDrawerOpen(v => !v)}>
              <div className="ham-line" />
              <div className="ham-line" />
              <div className="ham-line" />
            </div>
          </div>
        </div>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Mobile bottom tab bar - 4 direct one-tap destinations plus a "More"
          tab that opens the full drawer. The app has ~25 screens but only 4
          fit here, so every other screen used to leave the whole bar inactive
          (no "you are here", no way back to a section from the thumb zone).
          "More" lights up whenever the current route isn't one of the 4 direct
          tabs, so the bar always reflects location and the long tail is always
          one tap away. On phones this replaces the top hamburger entirely. */}
      <nav className="mobile-tab-bar" aria-label="Main navigation">
        {[
          { path: '/dashboard', label: 'Dashboard', Icon: IconDashboard },
          { path: '/arena',     label: 'Arena',      Icon: IconArena },
          { path: '/briefing',  label: 'Briefing',   Icon: IconBriefing },
          { path: '/news',      label: 'News',       Icon: IconNews },
        ].map(item => {
          const active = pathname === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`mobile-tab-item${active ? ' on' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="mobile-tab-icon-wrap">
                <item.Icon />
              </span>
              <span className="mobile-tab-label">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`mobile-tab-item${moreActive ? ' on' : ''}`}
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="menu"
          aria-expanded={drawerOpen}
          aria-controls="nav-drawer"
          aria-label="More"
        >
          <span className="mobile-tab-icon-wrap">
            <IconMore />
          </span>
          <span className="mobile-tab-label">More</span>
        </button>
      </nav>

      <div id="nav-drawer" className={`nav-drawer${drawerOpen ? ' open' : ''}`}>
        <div className="nav-overlay" onClick={() => setDrawerOpen(false)} />
        <div className="nav-menu">
          <div className="nav-search-bar">
            <div className="nav-search-wrap">
              <svg className="nav-search-icon" width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
                <line x1="13.5" y1="13.5" x2="17.5" y2="17.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                className="nav-search"
                type="text"
                value={navQuery}
                onChange={e => setNavQuery(e.target.value)}
                placeholder="Search pages"
                aria-label="Search pages"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              {navQuery && (
                <button className="nav-search-clear" onClick={() => setNavQuery('')} aria-label="Clear search" type="button">
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <line x1="5" y1="5" x2="15" y2="15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    <line x1="15" y1="5" x2="5" y2="15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {(() => {
            const renderTile = (d: NavDest) => {
              const on = pathname === d.path;
              const inner = (
                <>
                  <span className="nav-tile-icon"><d.Icon size={20} /></span>
                  <span className="nav-tile-label">{d.label}</span>
                </>
              );
              return d.modal ? (
                <button
                  key={d.path}
                  type="button"
                  className={`nav-tile${on ? ' on' : ''}`}
                  onClick={() => { setDrawerOpen(false); setSettingsOpen(true); }}
                >
                  {inner}
                </button>
              ) : (
                <Link
                  key={d.path}
                  href={d.path}
                  className={`nav-tile${on ? ' on' : ''}`}
                  aria-current={on ? 'page' : undefined}
                  onClick={() => setDrawerOpen(false)}
                >
                  {inner}
                </Link>
              );
            };

            const q = navQuery.trim().toLowerCase();
            if (q) {
              const matches = ALL_DESTS.filter(d => d.label.toLowerCase().includes(q));
              return matches.length ? (
                <div className="nav-grid">{matches.map(renderTile)}</div>
              ) : (
                <div className="nav-empty">No pages match “{navQuery.trim()}”</div>
              );
            }
            return NAV_SECTIONS.map(sec => (
              <div key={sec.header} className="nav-section">
                <div className="nav-section-label">{sec.header}</div>
                <div className="nav-grid">{sec.items.map(renderTile)}</div>
              </div>
            ));
          })()}

          <div className="nav-divider" />
          {!authLoading && (
            user ? (
              <button
                className="nav-item nav-signout"
                onClick={async () => {
                  setDrawerOpen(false);
                  track.signOut();
                  await signOut();
                  router.push('/login');
                }}
              >
                Sign Out
              </button>
            ) : (
              <Link
                href="/login"
                className={`nav-item${pathname === '/login' ? ' on' : ''}`}
                onClick={() => setDrawerOpen(false)}
              >
                Sign In
              </Link>
            )
          )}
        </div>
      </div>
    </>
  );
}
