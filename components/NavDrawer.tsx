'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMarket } from '@/lib/marketStore';
import { useAuth } from './AuthProvider';
import { track } from '@/lib/analytics';
import UsageModal from './UsageModal';
import LanguageNavSwitcher from './LanguageNavSwitcher';
import TerminalNav from './TerminalNav';
import { useDesignMode } from './DesignModeProvider';
import { getCurrentWindow } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { withAlpha } from '@/lib/color';
import BrandMark from './BrandMark';
import {
  IconSun, IconMoon,
  NavDashboard, NavBriefing, NavArena, NavMarkets, NavScanner,
  NavLiqMap, NavFunding, NavCorrelation, NavResearch,
  NavNews, NavCalendar, NavJournal, NavCalc, NavAlerts, NavHours, NavPlaybook,
  NavSettings, NavAbout,
} from './icons';
import type { ComponentType } from 'react';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

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
  { path: '/dashboard', labelKey: 'NAV_DASHBOARD' as const },
  { path: '/arena',     labelKey: 'NAV_ARENA'     as const },
  { path: '/briefing',  labelKey: 'NAV_BRIEFING'  as const },
];

const SCANNERS = [
  { path: '/markets',       labelKey: 'NAV_MARKETS'        as const },
  { path: '/scanner',       labelKey: 'NAV_SETUP_SCANNER'  as const },
  { path: '/liq',           labelKey: 'NAV_LIQUIDATION_MAP' as const },
  { path: '/funding',       labelKey: 'NAV_FR_HISTORY'     as const },
  { path: '/correlation',   labelKey: 'NAV_CORRELATION'    as const },
];

const TOOLS = [
  { path: '/journal',       labelKey: 'NAV_JOURNAL'       as const },
  { path: '/research',      labelKey: 'NAV_RESEARCH'      as const },
  { path: '/calc',          labelKey: 'NAV_CALCULATORS'   as const },
  { path: '/econ-calendar', labelKey: 'NAV_ECON_CALENDAR' as const },
  { path: '/alerts',        labelKey: 'NAV_ALERTS'        as const },
  { path: '/hours',         labelKey: 'NAV_BEST_HOURS'    as const },
  { path: '/playbook',      labelKey: 'NAV_PLAYBOOK'      as const },
];

const TAIL = [
  { path: '/news', labelKey: 'NAV_NEWS' as const },
];

type NavIcon = ComponentType<{ size?: number }>;
type NavDest = { path: string; labelKey: LabelKey; Icon: NavIcon };
type NavSection = { headerKey: LabelKey; items: NavDest[] };

const NAV_SECTIONS: NavSection[] = [
  { headerKey: 'NAV_SECTION_MAIN', items: [
    { path: '/dashboard', labelKey: 'NAV_DASHBOARD', Icon: NavDashboard },
    { path: '/briefing',  labelKey: 'NAV_BRIEFING',  Icon: NavBriefing },
  ] },
  { headerKey: 'NAV_SECTION_ANALYSIS', items: [
    { path: '/arena',         labelKey: 'NAV_ARENA',           Icon: NavArena },
    { path: '/markets',       labelKey: 'NAV_MARKETS',         Icon: NavMarkets },
    { path: '/scanner',       labelKey: 'NAV_SETUP_SCANNER',   Icon: NavScanner },
    { path: '/liq',           labelKey: 'NAV_LIQUIDATION_MAP', Icon: NavLiqMap },
    { path: '/funding',       labelKey: 'NAV_FR_HISTORY',      Icon: NavFunding },
    { path: '/correlation',   labelKey: 'NAV_CORRELATION',     Icon: NavCorrelation },
  ] },
  { headerKey: 'NAV_SECTION_RESEARCH', items: [
    { path: '/research',      labelKey: 'NAV_RESEARCH',      Icon: NavResearch },
    { path: '/news',          labelKey: 'NAV_NEWS',          Icon: NavNews },
    { path: '/econ-calendar', labelKey: 'NAV_ECON_CALENDAR', Icon: NavCalendar },
    { path: '/learn',         labelKey: 'NAV_GLOSSARY',      Icon: NavPlaybook },
  ] },
  { headerKey: 'NAV_SECTION_MY_TOOLS', items: [
    { path: '/journal',  labelKey: 'NAV_JOURNAL',        Icon: NavJournal },
    { path: '/calc',     labelKey: 'NAV_POSITION_SIZER', Icon: NavCalc },
    { path: '/alerts',   labelKey: 'NAV_ALERTS',         Icon: NavAlerts },
    { path: '/hours',    labelKey: 'NAV_BEST_HOURS',     Icon: NavHours },
    { path: '/playbook', labelKey: 'NAV_PLAYBOOK',       Icon: NavPlaybook },
  ] },
  { headerKey: 'NAV_SECTION_ACCOUNT', items: [
    /* Was `modal: true`, which intercepted this entry and opened SettingsModal
       instead of navigating - so the tile named /settings and went somewhere
       else. That component is deleted; see the note on renderTile below. */
    { path: '/settings', labelKey: 'NAV_SETTINGS_LABEL', Icon: NavSettings },
    { path: '/about',    labelKey: 'NAV_ABOUT',          Icon: NavAbout },
  ] },
];

const ALL_DESTS: NavDest[] = NAV_SECTIONS.flatMap(s => s.items);

/* ── Status dot ────────────────────────────────────────────────────────────── */
function useStatusDot() {
  const { store } = useMarket();
  const ws = store.wsStatus;
  /* `Idle` means the provider is mounted but deliberately not polling, on routes
     that render no market data (#200). Distinct from `Connecting...` on purpose:
     this page is never going to connect, and a spinner that never resolves reads
     as a broken feed rather than as a page that does not need one. */
  if (ws === 'Idle') return { cls: 'dot-idle', title: 'Market feed off - this page shows no live market data' };
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
  const { t } = useLabels();
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [navQuery, setNavQuery]         = useState('');
  const [openDrop, setOpenDrop]         = useState<DropKey | null>(null);
  const [authOpen, setAuthOpen]         = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const { theme, toggleTheme }          = useTheme();
  const pathname = usePathname();
  const dot      = useStatusDot();
  const mode     = useDesignMode();
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

  /* Terminal renders TerminalNav in place of .app-bar and .mobile-tab-bar,
     and keeps the drawer below (#599). Not additive: the .tnav-* CSS carries
     its own warning that the two tab bars must never stack, and they would -
     .mobile-tab-bar and .tnav-tabs are both position:fixed at bottom:0.
     TerminalNav lives HERE rather than in AppShell because the drawer's open
     state is local to this component; rendering it here means the opener is
     a prop instead of a window event threaded through the shell. */
  const terminal = mode === 'terminal';

  return (
    <>
      {terminal && <TerminalNav onOpenDrawer={() => setDrawerOpen(true)} />}
      {!terminal && (
      <div className="app-bar">
        <div className="app-bar-inner">
          <Link href="/dashboard" className="app-logo" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            {/* tone="dark" is fixed, not theme-derived - .app-bar's background
                (#090b16) never changes with the light/dark toggle, so the mark
                shouldn't either. */}
            <BrandMark size={24} tone="dark" />
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
                {t(item.labelKey)}
              </Link>
            ))}

            <NavDropdown
              label={t('NAV_DROPDOWN_SCANNERS')}
              items={SCANNERS.map(i => ({ path: i.path, label: t(i.labelKey) }))}
              open={openDrop === 'scanners'}
              onToggle={() => toggleDrop('scanners')}
              onClose={closeDrop}
              pathname={pathname}
            />

            <NavDropdown
              label={t('NAV_DROPDOWN_TOOLS')}
              items={TOOLS.map(i => ({ path: i.path, label: t(i.labelKey) }))}
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
                {t(item.labelKey)}
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

            <LanguageNavSwitcher />

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
                      <button
                        className="auth-dropdown-usage"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', padding: 0 }}
                        onClick={() => { setAuthOpen(false); setUsageOpen(true); }}
                      >
                        {t('NAV_VIEW_USAGE')}
                      </button>
                      <Link
                        href="/settings"
                        className="auth-dropdown-usage"
                        style={{ display: 'block', textAlign: 'left', width: '100%', padding: 0, textDecoration: 'none' }}
                        onClick={() => setAuthOpen(false)}
                      >
                        {t('NAV_SETTINGS_LABEL')}
                      </Link>
                      <button
                        className="auth-signout-btn"
                        onClick={async () => {
                          setAuthOpen(false);
                          track.signOut();
                          await signOut();
                          // Hard navigation - see the note on the Settings control (#304).
                          window.location.assign('/login');
                        }}
                      >
                        {t('NAV_SIGN_OUT_MENU')}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link href="/login" className="auth-signin-btn">{t('NAV_SIGN_IN')}</Link>
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
      )}

      <UsageModal open={usageOpen} onClose={() => setUsageOpen(false)} />

      {/* Mobile bottom tab bar - 4 direct one-tap destinations plus a "More"
          tab that opens the full drawer. The app has ~25 screens but only 4
          fit here, so every other screen used to leave the whole bar inactive
          (no "you are here", no way back to a section from the thumb zone).
          "More" lights up whenever the current route isn't one of the 4 direct
          tabs, so the bar always reflects location and the long tail is always
          one tap away. On phones this replaces the top hamburger entirely. */}
      {!terminal && (
      <nav className="mobile-tab-bar" aria-label="Main navigation">
        {[
          { path: '/dashboard', labelKey: 'NAV_HOME'     as const, Icon: IconDashboard },
          { path: '/briefing',  labelKey: 'NAV_BRIEFING' as const, Icon: IconBriefing },
          { path: '/arena',     labelKey: 'NAV_ARENA'    as const, Icon: IconArena },
          { path: '/news',      labelKey: 'NAV_NEWS'     as const, Icon: IconNews },
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
              <span className="mobile-tab-label">{t(item.labelKey)}</span>
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
          aria-label={t('NAV_MORE')}
        >
          <span className="mobile-tab-icon-wrap">
            <IconMore />
          </span>
          <span className="mobile-tab-label">{t('NAV_MORE')}</span>
        </button>
      </nav>
      )}

      {/* inert while closed - see the same fix in GrokChat. The drawer is
          hidden with a transform and pointer-events:none, so its 23 focusable
          controls stayed in the tab order behind an invisible panel. */}
      <div
        id="nav-drawer"
        className={`nav-drawer${drawerOpen ? ' open' : ''}`}
        inert={!drawerOpen}
        aria-hidden={!drawerOpen}
      >
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
                placeholder={t('NAV_SEARCH_PLACEHOLDER')}
                aria-label={t('NAV_SEARCH_PLACEHOLDER')}
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
                  <span className="nav-tile-label">{t(d.labelKey)}</span>
                </>
              );
              /* Every destination is a real link now. The one exception was
                 Settings, which rendered a <button> that opened a modal while
                 naming /settings as its path - so it had no href, could not be
                 opened in a new tab, middle-clicked or bookmarked, and gave a
                 screen reader "button" where every sibling said "link". */
              return (
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
              const matches = ALL_DESTS.filter(d => t(d.labelKey).toLowerCase().includes(q));
              return matches.length ? (
                <div className="nav-grid">{matches.map(renderTile)}</div>
              ) : (
                <div className="nav-empty">{t('NAV_NO_MATCHES', { query: navQuery.trim() })}</div>
              );
            }
            return NAV_SECTIONS.map(sec => (
              <div key={sec.headerKey} className="nav-section">
                <div className="nav-section-label">{t(sec.headerKey)}</div>
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
                  // Hard navigation - see the note on the Settings control (#304).
                  window.location.assign('/login');
                }}
              >
                {t('NAV_SIGN_OUT_DRAWER')}
              </button>
            ) : (
              <Link
                href="/login"
                className={`nav-item${pathname === '/login' ? ' on' : ''}`}
                onClick={() => setDrawerOpen(false)}
              >
                {t('NAV_SIGN_IN')}
              </Link>
            )
          )}
        </div>
      </div>
    </>
  );
}
