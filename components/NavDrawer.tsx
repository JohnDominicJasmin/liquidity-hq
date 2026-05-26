'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useNews } from './NewsProvider';

const NAV = [
  { path: '/', icon: '📊', label: 'Dashboard' },
  { path: '/scanner', icon: '🔍', label: 'Trade Scanner' },
  { path: '/hours', icon: '🕐', label: 'Best Hours' },
  null,
  { path: '/bible', icon: '📖', label: 'Bible' },
  { path: '/clusters', icon: '🎯', label: 'Clusters' },
  null,
  { path: '/arena', icon: '🤖', label: 'AI Arena' },
  null,
  { path: '/about', icon: 'ℹ️', label: 'About' },
];

export default function NavDrawer() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { newsActive } = useNews();

  return (
    <>
      <div className="app-bar">
        <div className="app-bar-inner">
          <div className="app-logo" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Liquidity<span>HQ</span>
            <div className={`news-dot${newsActive ? ' active' : ''}`} title="Breaking news" />
          </div>
          <div className={`hamburger${open ? ' open' : ''}`} onClick={() => setOpen(v => !v)}>
            <div className="ham-line" />
            <div className="ham-line" />
            <div className="ham-line" />
          </div>
        </div>
      </div>

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
