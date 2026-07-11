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
        <span style={{ fontSize: 15, flexShrink: 0, lineHeight: 1 }}>☀</span>
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
