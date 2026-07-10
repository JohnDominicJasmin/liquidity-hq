'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMarket } from '@/lib/marketStore';
import { useAuth } from './AuthProvider';
import { track } from '@/lib/analytics';
import SettingsModal from './SettingsModal';
import { getCurrentWindow } from '@/lib/session';

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
  // are statically prerendered — so "is a window active" can only be decided
  // once we're actually on the client with the real current time. Gating on
  // `mounted` makes the server render (and client's first render, before this
  // effect runs) always emit nothing, avoiding a hydration mismatch on
  // whether this element exists at all (suppressHydrationWarning can't help
  // here — it only covers text content, not element presence).
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
    <div suppressHydrationWarning className="session-pill" style={{ color: win.color, background: win.bg, borderColor: win.color + '44' }}>
      <span className="session-pill-dot" style={{ background: win.color }} />
      {win.name.toUpperCase()} · {timeStr}
    </div>
  );
}

/* ── Nav data ──────────────────────────────────────────────────────────────── */
const PRIMARY = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/briefing',  label: 'Briefing'  },
];

const SCANNERS = [
  { path: '/arena',       label: 'LiquidityAI'       },
  { path: '/scanner',     label: 'Setup Scanner'     },
  { path: '/liq',         label: 'Liquidation Map'   },
  { path: '/funding',     label: 'FR History'        },
  { path: '/correlation', label: 'Correlation'       },
  { path: '/backtest',    label: 'Backtest'          },
  { path: '/live-tracking', label: 'Live Tracking'   },
];

const TOOLS = [
  { path: '/journal',        label: 'Journal'             },
  { path: '/calc',           label: 'Calculators'         },
  { path: '/econ-calendar',  label: 'Economic Calendar'   },
  { path: '/alerts',         label: 'Alerts'              },
  { path: '/hours',          label: 'Best Hours'          },
  { path: '/playbook',       label: 'Playbook'            },
];

const TAIL = [
  { path: '/news', label: 'News' },
];

type NavEntry =
  | { path: string; label: string; modal?: boolean }
  | { header: string }
  | null;

const MOBILE_NAV: NavEntry[] = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/briefing',  label: 'Briefing'  },

  { header: 'Analysis' },
  { path: '/arena',       label: 'LiquidityAI'       },
  { path: '/scanner',     label: 'Setup Scanner'     },
  { path: '/liq',         label: 'Liquidation Map'   },
  { path: '/funding',     label: 'FR History'        },
  { path: '/correlation', label: 'Correlation'       },
  { path: '/backtest',    label: 'Backtest'          },
  { path: '/live-tracking', label: 'Live Tracking'   },

  { header: 'Research' },
  { path: '/news',          label: 'News'              },
  { path: '/econ-calendar', label: 'Economic Calendar' },

  { header: 'My Tools' },
  { path: '/journal',  label: 'Journal'         },
  { path: '/calc',     label: 'Position Sizer'  },
  { path: '/alerts',   label: 'Alerts'          },
  { path: '/hours',    label: 'Best Hours'      },
  { path: '/playbook', label: 'Playbook'        },

  { header: 'Account' },
  { path: '/settings', label: 'Settings', modal: true },
  { path: '/about',    label: 'About'           },
];

/* ── Status dot ────────────────────────────────────────────────────────────── */
function useStatusDot() {
  const { store } = useMarket();
  const ws = store.wsStatus;
  if (!ws || ws === 'Connecting...') return { cls: 'dot-connecting', title: 'Connecting…' };
  if (ws.includes('WebSocket')) return { cls: 'dot-live', title: 'Live · Binance WebSocket' };
  if (ws.includes('REST')) return { cls: 'dot-rest', title: 'Live via REST fallback' };
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
  const [openDrop, setOpenDrop]         = useState<DropKey | null>(null);
  const [authOpen, setAuthOpen]         = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme]               = useState<'dark' | 'light'>('dark');
  const pathname = usePathname();
  const router   = useRouter();
  const dot      = useStatusDot();
  const { user, loading: authLoading, signOut } = useAuth();
  const authRef  = useRef<HTMLDivElement>(null);
  const initials = user?.email?.[0]?.toUpperCase() ?? '?';

  // Hide the floating Ask AI button while the mobile nav drawer is open —
  // it otherwise sits on top of the bottom nav links and eats their taps.
  useEffect(() => {
    document.body.classList.toggle('nav-drawer-open', drawerOpen);
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
              {theme === 'dark' ? '☀' : '◑'}
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

            <div className={`hamburger${drawerOpen ? ' open' : ''}`} onClick={() => setDrawerOpen(v => !v)}>
              <div className="ham-line" />
              <div className="ham-line" />
              <div className="ham-line" />
            </div>
          </div>
        </div>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <div className={`nav-drawer${drawerOpen ? ' open' : ''}`}>
        <div className="nav-overlay" onClick={() => setDrawerOpen(false)} />
        <div className="nav-menu">
          {MOBILE_NAV.map((item, i) =>
            item === null ? (
              <div key={i} className="nav-divider" />
            ) : 'header' in item ? (
              <div key={i} className="nav-group-label">{item.header}</div>
            ) : item.modal ? (
              <button
                key={item.path}
                className="nav-item"
                style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                onClick={() => { setDrawerOpen(false); setSettingsOpen(true); }}
              >
                {item.label}
              </button>
            ) : (
              <Link
                key={item.path}
                href={item.path}
                className={`nav-item${pathname === item.path ? ' on' : ''}`}
                onClick={() => setDrawerOpen(false)}
              >
                {item.label}
              </Link>
            )
          )}

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
