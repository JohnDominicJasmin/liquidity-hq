'use client';
import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import Link from 'next/link';

const VISIT_KEY = 'lhq_briefing_last_visit';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function MorningBriefingPrompt() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!user) return;
    try {
      const last = localStorage.getItem(VISIT_KEY);
      if (last !== todayStr()) setShow(true);
    } catch {
      setShow(true);
    }
  }, [user]);

  function dismiss() {
    try { localStorage.setItem(VISIT_KEY, todayStr()); } catch { /* ignore */ }
    setShow(false);
  }

  if (!show || !user) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '10px 14px',
      background: 'rgba(90,106,255,0.06)',
      border: '0.5px solid rgba(90,106,255,0.22)',
      borderRadius: 10,
      marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ flexShrink: 0, lineHeight: 0, color: 'var(--amber)' }}>
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="3.4" fill="currentColor" />
            <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <line x1="10" y1="2" x2="10" y2="3.6" /><line x1="10" y1="16.4" x2="10" y2="18" />
              <line x1="2" y1="10" x2="3.6" y2="10" /><line x1="16.4" y1="10" x2="18" y2="10" />
              <line x1="4.2" y1="4.2" x2="5.4" y2="5.4" /><line x1="14.6" y1="14.6" x2="15.8" y2="15.8" />
              <line x1="15.8" y1="4.2" x2="14.6" y2="5.4" /><line x1="5.4" y1="14.6" x2="4.2" y2="15.8" />
            </g>
          </svg>
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', lineHeight: 1.3 }}>
            Your morning briefing is ready
          </div>
          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2, lineHeight: 1.4 }}>
            AI market recap, key levels, and today&apos;s trade bias
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <Link
          href="/briefing"
          onClick={dismiss}
          style={{
            fontSize: 11, fontWeight: 700, color: 'var(--accent)',
            background: 'rgba(90,106,255,0.1)',
            border: '0.5px solid rgba(90,106,255,0.28)',
            borderRadius: 6, padding: '5px 12px',
            textDecoration: 'none', whiteSpace: 'nowrap',
          }}
        >
          Open →
        </Link>
        <button
          onClick={dismiss}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--txt3)', fontSize: 17, padding: '2px 4px', lineHeight: 1,
          }}
          aria-label="Dismiss for today"
        >
          ×
        </button>
      </div>
    </div>
  );
}
