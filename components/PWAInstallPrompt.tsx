'use client';
import { useState, useEffect } from 'react';
import { Download } from '@/components/icons';

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

  // Mobile: the "Ask AI" FAB sits bottom-right and this toast is bottom-left
  // wide enough to reach under it (measured overlap). Hiding the FAB for as
  // long as the toast is up is simpler than shrinking the toast to squeeze
  // beside it - same body-class pattern as body.nav-drawer-open.
  useEffect(() => {
    document.body.classList.toggle('pwa-prompt-open', show);
    return () => { document.body.classList.remove('pwa-prompt-open'); };
  }, [show]);

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
    <div className="pwa-install-prompt" style={{
      // Bottom-center on every screen size. On mobile the "Ask AI" FAB is
      // hidden for as long as this is shown (body.pwa-prompt-open in
      // globals.css) so there's nothing to overlap; the mobile media query
      // there also lifts bottom above the tab bar.
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
      <span style={{
        flexShrink: 0, width: 34, height: 34, borderRadius: 10,
        background: 'rgba(26,122,255,0.14)', border: '0.5px solid rgba(26,122,255,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
      }}>
        <Download size={17} style={{ verticalAlign: 'baseline' }} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>Add to Home Screen</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', lineHeight: 1.4 }}>Install LiquidityHQ for instant access</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          onClick={install}
          style={{
            background: 'var(--accent-solid)',
            border: 'none',
            borderRadius: 6,
            padding: '5px 11px',
            fontSize: 'var(--fs-caption)',
            fontWeight: 700,
            color: 'var(--on-accent)',
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
            color: 'var(--txt)',
            fontSize: '1.125rem',
            lineHeight: 1,
            padding: '0 2px',
            opacity: 0.75,
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
