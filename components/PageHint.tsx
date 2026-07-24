'use client';
import { useState, useEffect } from 'react';
import { useLabels } from '@/lib/labels';

interface Props {
  pageKey: string;
  title: string;
  body: string;
}

export default function PageHint({ pageKey, title, body }: Props) {
  const key = `lhq_hint_${pageKey}`;
  const [show, setShow] = useState(false);
  const { t } = useLabels();

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
      background: 'rgba(26,122,255,0.07)',
      border: '0.5px solid rgba(26,122,255,0.22)',
      borderRadius: 10,
      padding: '10px 12px',
      marginBottom: 14,
    }}>
      <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: 'var(--accent)', background: 'rgba(26,122,255,0.18)', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, letterSpacing: 0 }}>i</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.55 }}>{body}</div>
      </div>
      <button
        onClick={dismiss}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--txt3)',
          fontSize: '1rem',
          lineHeight: 1,
          padding: '0 2px',
          flexShrink: 0,
          opacity: 0.6,
        }}
        aria-label={t('PAGE_HINT_DISMISS_LABEL')}
      >×</button>
    </div>
  );
}
