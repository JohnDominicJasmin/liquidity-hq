'use client';
import { useState, useEffect } from 'react';

export default function PWAInstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const count = parseInt(localStorage.getItem('lhq_visit_count') || '0', 10) + 1;
      localStorage.setItem('lhq_visit_count', String(count));
    } catch {}

    const handler = (e: Event) => {
      e.preventDefault();
      try {
        const count = parseInt(localStorage.getItem('lhq_visit_count') || '0', 10);
        const dismissed = localStorage.getItem('lhq_pwa_dismissed');
        if (count >= 2 && !dismissed) {
          setPrompt(e as BeforeInstallPromptEvent);
          setShow(true);
        }
      } catch {}
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!show || !prompt) return null;

  function dismiss() {
    try { localStorage.setItem('lhq_pwa_dismissed', '1'); } catch {}
    setShow(false);
  }

  async function install() {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      try { localStorage.setItem('lhq_pwa_dismissed', '1'); } catch {}
    }
    setShow(false);
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 80,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9000,
      background: 'var(--bg2)',
      border: '0.5px solid var(--bdr)',
      borderRadius: 12,
      padding: '12px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
      maxWidth: 320,
      width: 'calc(100vw - 32px)',
    }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>📲</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>Add to Home Screen</div>
        <div style={{ fontSize: 11, color: 'var(--txt3)', lineHeight: 1.4 }}>Install LiquidityHQ for instant access</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          onClick={install}
          style={{
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 6,
            padding: '5px 11px',
            fontSize: 11,
            fontWeight: 700,
            color: '#fff',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >Install</button>
        <button
          onClick={dismiss}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--txt3)',
            fontSize: 18,
            lineHeight: 1,
            padding: '0 2px',
            opacity: 0.6,
          }}
          aria-label="Dismiss"
        >×</button>
      </div>
    </div>
  );
}

// Augment the global Window interface
declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }
}
