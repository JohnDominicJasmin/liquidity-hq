'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMarket } from '@/lib/marketStore';

const NAV = [
  { path: '/', icon: '📊', label: 'Dashboard' },
  { path: '/briefing', icon: '🌅', label: 'Briefing' },
  { path: '/hours', icon: '🕐', label: 'Best Hours' },
  { path: '/news', icon: '📰', label: 'News' },
  null,
  { path: '/playbook', icon: '📖', label: 'Playbook' },
  null,
  { path: '/arena', icon: '🤖', label: 'AI Arena' },
  { path: '/liq',   icon: '🔥', label: 'Liq Map' },
  { path: '/funding', icon: '💸', label: 'FR History' },
  { path: '/correlation', icon: '🔗', label: 'Correlation' },
  null,
  { path: '/journal', icon: '📓', label: 'Journal' },
  null,
  { path: '/about', icon: 'ℹ️', label: 'About' },
];

// Desktop nav excludes dividers and About
const DESKTOP_NAV = NAV.filter(Boolean) as NonNullable<typeof NAV[0]>[];

function useStatusDot() {
  const { store } = useMarket();
  const ws = store.wsStatus;
  if (!ws || ws === 'Connecting...') return { cls: 'dot-connecting', title: 'Connecting…' };
  if (ws.includes('WebSocket')) return { cls: 'dot-live', title: 'Live · Binance WebSocket' };
  if (ws.includes('REST')) return { cls: 'dot-rest', title: 'Live via REST fallback' };
  return { cls: 'dot-error', title: 'Connection error' };
}

export default function NavDrawer() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const pathname = usePathname();
  const dot = useStatusDot();

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

          {/* Hamburger — mobile only */}
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
