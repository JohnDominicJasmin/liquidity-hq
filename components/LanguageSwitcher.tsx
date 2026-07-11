'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { Locale } from '@/lib/i18n/dictionaries';

const OPTIONS: Array<{ code: Locale; label: string; href: string }> = [
  { code: 'en', label: 'English',  href: '/' },
  { code: 'ko', label: '한국어',    href: '/ko' },
  { code: 'zh', label: '中文',      href: '/zh' },
  { code: 'ar', label: 'العربية',  href: '/ar' },
];

export default function LanguageSwitcher({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = OPTIONS.find(o => o.code === locale) ?? OPTIONS[0];

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          fontSize: 12, fontWeight: 600, color: 'var(--txt2)',
          background: 'var(--bg2)', border: '0.5px solid var(--bdr)',
          borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}
      >
        {current.label}
        <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', insetInlineEnd: 0, zIndex: 50,
          background: 'var(--bg1)', border: '0.5px solid var(--bdr2)', borderRadius: 10,
          overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', minWidth: 120,
        }}>
          {OPTIONS.map(o => (
            <Link
              key={o.code}
              href={o.href}
              onClick={() => setOpen(false)}
              style={{
                display: 'block', padding: '9px 14px', fontSize: 13, textDecoration: 'none',
                color: o.code === locale ? 'var(--accent-2)' : 'var(--txt2)',
                background: o.code === locale ? 'var(--accent-bg)' : 'transparent',
              }}
            >
              {o.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
