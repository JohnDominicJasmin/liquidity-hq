'use client';
import { useState, useEffect } from 'react';

interface Props {
  pageKey: string;
  title: string;
  body: string;
}

export default function PageHint({ pageKey, title, body }: Props) {
  const key = `lhq_hint_${pageKey}`;
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(key)) setShow(true);
    } catch {}
  }, [key]);

  if (!show) return null;

  function dismiss() {
    try { localStorage.setItem(key, '1'); } catch {}
    setShow(false);
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      background: 'rgba(90,106,255,0.07)',
      border: '0.5px solid rgba(90,106,255,0.22)',
      borderRadius: 10,
      padding: '10px 12px',
      marginBottom: 14,
    }}>
      <span style={{ fontSize: 15, lineHeight: '1.4', flexShrink: 0 }}>💡</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--txt3)', lineHeight: 1.55 }}>{body}</div>
      </div>
      <button
        onClick={dismiss}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--txt3)',
          fontSize: 16,
          lineHeight: 1,
          padding: '0 2px',
          flexShrink: 0,
          opacity: 0.6,
        }}
        aria-label="Dismiss hint"
      >×</button>
    </div>
  );
}
