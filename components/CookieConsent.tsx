'use client';
import { useEffect, useRef, useState } from 'react';
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
  const barRef = useRef<HTMLDivElement>(null);

  // Read after mount, never during render: localStorage does not exist on the
  // server, so reading it during render would desync SSR from hydration.
  useEffect(() => {
    if (readConsent() === 'unknown') setShow(true);
    // Marks "consent state is now known", regardless of the answer. The Ask AI
    // FAB waits for this before it paints - see body.consent-pending in
    // globals.css. Without it the FAB rendered immediately, then this banner
    // arrived a beat later and shoved it off screen, which looked like the FAB
    // breaking rather than a banner appearing.
    document.body.classList.remove('consent-pending');
  }, []);

  // Publish how far up the screen this bar reaches, so the bottom-right cluster
  // can sit ABOVE it instead of being hidden.
  //
  // It used to hide the FAB outright (body.consent-open -> opacity: 0). That was
  // wrong: on a phone this bar stacks to roughly 190px and starts at bottom:56,
  // so it completely covers the FAB's slot - but "covered" was solved by making
  // the FAB vanish, which reads as the feature being broken. Now the FAB just
  // moves up out of the way and stays usable.
  //
  // Measured rather than hardcoded because the height depends on how the body
  // text wraps, which changes with locale and screen width. ResizeObserver keeps
  // it correct through rotation and font-size changes.
  useEffect(() => {
    document.body.classList.toggle('consent-open', show);
    const root = document.documentElement;
    if (!show) {
      root.style.removeProperty('--consent-top');
      return () => { document.body.classList.remove('consent-open'); };
    }
    const measure = () => {
      const el = barRef.current;
      if (!el) return;
      // Distance from the viewport's bottom edge to the top of the bar. Using
      // this rather than the bar's height keeps one formula working on both
      // breakpoints, since the bar sits at bottom:0 on desktop and bottom:56
      // (above the tab bar) on mobile.
      root.style.setProperty('--consent-top', `${Math.round(window.innerHeight - el.getBoundingClientRect().top)}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (barRef.current) ro.observe(barRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      document.body.classList.remove('consent-open');
      root.style.removeProperty('--consent-top');
    };
  }, [show]);

  if (!show) return null;

  const choose = (state: 'granted' | 'denied') => {
    writeConsent(state);
    setShow(false);
  };

  return (
    <div ref={barRef} className="consent-bar" role="region" aria-label={t('CONSENT_ARIA_LABEL')}>
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
