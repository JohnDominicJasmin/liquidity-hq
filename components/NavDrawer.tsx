'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMarket } from '@/lib/marketStore';
import { useAuth } from './AuthProvider';
import { track } from '@/lib/analytics';
import SettingsModal from './SettingsModal';
import { getCurrentWindow } from '@/lib/session';

/* ── Live session pill shown in navbar ── */
function pad2(n: number) { return String(n).padStart(2, '0'); }
function phtNow() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })); }
function findEndsInMs(nowMs: number, name: string): number {
  for (let t = nowMs + 60_000; t < nowMs + 6 * 3600_000; t += 60_000) {
    const w = getCurrentWindow(new Date(new Date(t).toLocaleString('en-US', { timeZone: 'Asia/Manila' })));
    if (!w || w.name !== name) return t - nowMs;
  }
  return 6 * 3600_000;
}
function SessionPill() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const win = getCurrentWindow(phtNow());
  if (!win) return null;
  const endsMs = findEndsInMs(nowMs, win.name);
  const h = Math.floor(endsMs / 3_600_000);
  const m = Math.floor((endsMs % 3_600_000) / 60_000);
  const timeStr = h > 0 ? `${h}h ${pad2(m)}m` : `${m}m left`;
  return (
    <div className="session-pill" style={{ color: win.color, background: win.bg, borderColor: win.color + '44' }}>
      <span className="session-pill-dot" style={{ background: win.color }} />
      {win.name.toUpperCase()} · {timeStr}
    </div>
  );
}

const NAV = [
  { path: '/dashboard',   icon: '📊', label: 'Dashboard',   desk: true  },
  { path: '/briefing',    icon: '🌅', label: 'Briefing',    desk: true  },
  { path: '/alerts',      icon: '🔔', label: 'Alerts',      desk: false },
  { path: '/hours',       icon: '🕐', label: 'Best Hours',  desk: false },
  { path: '/news',        icon: '📰', label: 'News',        desk: true  },
  null,
  { path: '/playbook',    icon: '📖', label: 'Playbook',    desk: false },
  null,
  { path: '/arena',       icon: '🤖', label: 'LiquidityAI', desk: true  },
  { path: '/liq',         icon: '🔥', label: 'Liquidation Map', desk: true  },
  { path: '/funding',     icon: '💸', label: 'FR History',  desk: true  },
  { path: '/correlation', icon: '🔗', label: 'Correlation', desk: true  },
  null,
  { path: '/journal',     icon: '📓', label: 'Journal',     desk: true  },
  { path: '/calc',        icon: '🧮', label: 'Position Sizer', desk: false },
  null,
  { path: '/settings',    icon: '⚙️', label: 'Settings',    desk: false, modal: true },
  { path: '/about',       icon: 'ℹ️', label: 'About',       desk: false },
];

// Desktop nav: only items flagged desk:true
const DESKTOP_NAV = NAV.filter(item => item && item.desk)  as NonNullable<typeof NAV[0]>[];
// "More" dropdown: items flagged desk:false
const MORE_NAV    = NAV.filter(item => item && !item.desk) as NonNullable<typeof NAV[0]>[];

function useStatusDot() {
  const { store } = useMarket();
  const ws = store.wsStatus;
  if (!ws || ws === 'Connecting...') return { cls: 'dot-connecting', title: 'Connecting…' };
  if (ws.includes('WebSocket')) return { cls: 'dot-live', title: 'Live · Binance WebSocket' };
  if (ws.includes('REST')) return { cls: 'dot-rest', title: 'Live via REST fallback' };
  return { cls: 'dot-error', title: 'Connection error' };
}

export default function NavDrawer() {
  const [open, setOpen]             = useState(false);
  const [moreOpen, setMoreOpen]     = useState(false);
  const [authOpen, setAuthOpen]     = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme]           = useState<'dark' | 'light'>('dark');
  const pathname = usePathname();
  const router   = useRouter();
  const dot      = useStatusDot();
  const { user, loading: authLoading, signOut } = useAuth();
  const authRef  = useRef<HTMLDivElement>(null);

  // Initials from email (e.g. "dominic@..." → "D")
  const initials = user?.email?.[0]?.toUpperCase() ?? '?';

  // Close "More" dropdown on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = () => setMoreOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [moreOpen]);

  // Close auth dropdown on outside click
  useEffect(() => {
    if (!authOpen) return;
    const handler = (e: MouseEvent) => {
      if (authRef.current && !authRef.current.contains(e.target as Node)) {
        setAuthOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [authOpen]);

  // Initialise from localStorage on first mount
  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('theme')) as 'dark' | 'light' | null;
    const initial: 'dark' | 'light' = saved === 'light' ? 'light' : 'dark';
    setTheme(initial);
    document.documentElement.setAttribute('data-theme', initial);
  }, []);

  const toggleTheme = () => {
    const next: 'dark' | 'light' = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  };

  return (
    <>
      <div className="app-bar">
        <div className="app-bar-inner">
          <Link href="/" className="app-logo" style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
            LiquidityHQ<span>.ai</span>
            <span className={`status-dot ${dot.cls}`} title={dot.title} />
          </Link>

          {/* Desktop nav — hidden on mobile */}
          <nav className="desktop-nav">
            {DESKTOP_NAV.map(item => (
              <Link
                key={item.path}
                href={item.path}
                className={`desktop-nav-item${pathname === item.path ? ' on' : ''}`}
              >
                {item.label}
              </Link>
            ))}

            {/* More dropdown */}
            <div className="nav-more-wrap" onClick={e => e.stopPropagation()}>
              <button
                className={`desktop-nav-item nav-more-btn${moreOpen ? ' on' : ''}`}
                onClick={() => setMoreOpen(v => !v)}
              >
                More {moreOpen ? '▴' : '▾'}
              </button>
              {moreOpen && (
                <div className="nav-more-dropdown">
                  {MORE_NAV.map(item => (
                    <Link
                      key={item.path}
                      href={item.path}
                      className={`nav-more-item${pathname === item.path ? ' on' : ''}`}
                      onClick={() => setMoreOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </nav>

          {/* Session pill — shows active trading window */}
          <div className="session-pill-wrap">
            <SessionPill />
          </div>

          {/* Theme toggle — always visible */}
          <button
            className="theme-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀' : '◑'}
          </button>

          {/* Auth button — avatar when signed in, "Sign In" when not */}
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
                    <Link
                      href="/arena"
                      className="auth-dropdown-usage"
                      onClick={() => setAuthOpen(false)}
                    >
                      LiquidityAI — <span>view usage</span>
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

          {/* Hamburger — mobile only (hidden on desktop via CSS) */}
          <div className={`hamburger${open ? ' open' : ''}`} onClick={() => setOpen(v => !v)}>
            <div className="ham-line" />
            <div className="ham-line" />
            <div className="ham-line" />
          </div>
        </div>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Mobile drawer */}
      <div className={`nav-drawer${open ? ' open' : ''}`}>
        <div className="nav-overlay" onClick={() => setOpen(false)} />
        <div className="nav-menu">
          {NAV.map((item, i) =>
            item === null ? (
              <div key={i} className="nav-divider" />
            ) : (item as { modal?: boolean }).modal ? (
              <button
                key={item.path}
                className="nav-item"
                style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                onClick={() => { setOpen(false); setSettingsOpen(true); }}
              >
                {item.label}
              </button>
            ) : (
              <Link
                key={item.path}
                href={item.path}
                className={`nav-item${pathname === item.path ? ' on' : ''}`}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            )
          )}

          {/* Auth entry at bottom of mobile drawer */}
          {!authLoading && (
            <>
              <div className="nav-divider" />
              {user ? (
                <button
                  className="nav-item nav-signout"
                  onClick={async () => {
                    setOpen(false);
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
                  onClick={() => setOpen(false)}
                >
                  Sign In
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
