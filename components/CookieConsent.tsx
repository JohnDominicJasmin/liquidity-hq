'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLabels } from '@/lib/labels';
import { readConsent, writeConsent } from '@/lib/consent';

// Consent banner for analytics + session replay. Shown only while the stored
// state is 'unknown'; accepting or declining both silence it permanently.
//
// Accept and Decline are deliberately the same size and weight. Making refusal
// visibly harder than acceptance is the classic dark pattern that consent
// rules single out, and it would undercut the reason this component exists.
export default function CookieConsent() {
  const { t } = useLabels();
  const [show, setShow] = useState(false);

  // Read after mount, never during render: localStorage does not exist on the
  // server, so reading it during render would desync SSR from hydration.
  useEffect(() => {
    if (readConsent() === 'unknown') setShow(true);
  }, []);

  // The bottom-right corner already holds the Ask AI FAB, the Setup pill and
  // the PWA prompt. Rather than tetris this bar around them, hide them while
  // it is up - same body-class pattern as body.nav-drawer-open and
  // body.pwa-prompt-open (see globals.css).
  useEffect(() => {
    document.body.classList.toggle('consent-open', show);
    return () => { document.body.classList.remove('consent-open'); };
  }, [show]);

  if (!show) return null;

  const choose = (state: 'granted' | 'denied') => {
    writeConsent(state);
    setShow(false);
  };

  return (
    <div className="consent-bar" role="region" aria-label={t('CONSENT_ARIA_LABEL')}>
      <p className="consent-text">
        {t('CONSENT_BODY')}{' '}
        <Link href="/privacy" className="consent-link">{t('CONSENT_PRIVACY_LINK')}</Link>
      </p>
      <div className="consent-actions">
        <button type="button" className="consent-btn consent-decline" onClick={() => choose('denied')}>
          {t('CONSENT_DECLINE')}
        </button>
        <button type="button" className="consent-btn consent-accept" onClick={() => choose('granted')}>
          {t('CONSENT_ACCEPT')}
        </button>
      </div>
    </div>
  );
}
