'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMarket } from '@/lib/marketStore';

const NAV = [
  { path: '/',            icon: '📊', label: 'Dashboard',   desk: true  },
  { path: '/briefing',    icon: '🌅', label: 'Briefing',    desk: true  },
  { path: '/alerts',      icon: '🔔', label: 'Alerts',      desk: false },
  { path: '/hours',       icon: '🕐', label: 'Best Hours',  desk: false },
  { path: '/news',        icon: '📰', label: 'News',        desk: true  },
  null,
  { path: '/playbook',    icon: '📖', label: 'Playbook',    desk: false },
  null,
  { path: '/arena',       icon: '🤖', label: 'AI Arena',    desk: true  },
  { path: '/liq',         icon: '🔥', label: 'Liq Map',     desk: true  },
  { path: '/funding',     icon: '💸', label: 'FR History',  desk: true  },
  { path: '/correlation', icon: '🔗', label: 'Correlation', desk: true  },
  null,
  { path: '/journal',     icon: '📓', label: 'Journal',     desk: true  },
  null,
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
  const [open, setOpen]         = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [theme, setTheme]       = useState<'dark' | 'light'>('dark');
  const pathname = usePathname();
  const dot = useStatusDot();

  // Close "More" dropdown on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = () => setMoreOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [moreOpen]);

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
            Liquidity<span>HQ</span>
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

          {/* Theme toggle — always visible */}
          <button
            className="theme-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀' : '◑'}
          </button>

          {/* Hamburger — mobile only (hidden on desktop via CSS) */}
          <div className={`hamburger${open ? ' open' : ''}`} onClick={() => setOpen(v => !v)}>
            <div className="ham-line" />
            <div className="ham-line" />
            <div className="ham-line" />
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      <div className={`nav-drawer${open ? ' open' : ''}`}>
        <div className="nav-overlay" onClick={() => setOpen(false)} />
        <div className="nav-menu">
          {NAV.map((item, i) =>
            item === null ? (
              <div key={i} className="nav-divider" />
            ) : (
              <Link
                key={item.path}
                href={item.path}
                className={`nav-item${pathname === item.path ? ' on' : ''}`}
                onClick={() => setOpen(false)}
              >
                <span className="nav-item-icon">{item.icon}</span>
                {item.label}
              </Link>
            )
          )}
        </div>
      </div>
    </>
  );
}
