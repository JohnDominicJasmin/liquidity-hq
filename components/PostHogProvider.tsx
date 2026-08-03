'use client';
import posthog from 'posthog-js';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, Suspense } from 'react';
import { readConsent, onConsentChange, type ConsentState } from '@/lib/consent';

const PH_KEY  = process.env.NEXT_PUBLIC_POSTHOG_KEY  ?? '';
const PH_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

function PageViewTracker() {
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const url = window.origin + pathname + (searchParams?.toString() ? '?' + searchParams.toString() : '');
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

// Analytics is gated on explicit consent (lib/consent.ts, components/
// CookieConsent.tsx). This used to init unconditionally on mount, which meant
// PostHog set its own cookie and started SESSION RECORDING for every visitor
// before they had agreed to anything.
//
// The gate is "do not init at all", not posthog's own opt_out_capturing_by_
// default. Both work, but not calling init() is the version that is trivially
// verifiable in devtools: with no consent there is no PostHog request and no
// PostHog cookie, rather than a loaded SDK we are trusting to stay quiet.
export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<ConsentState>('unknown');
  const [active, setActive]   = useState(false);
  const inited = useRef(false);

  // Resolve real consent after mount (localStorage is client-only), then keep
  // following it - the banner and the settings toggle both publish changes.
  useEffect(() => {
    setConsent(readConsent());
    return onConsentChange(setConsent);
  }, []);

  useEffect(() => {
    if (!PH_KEY) return;

    if (consent === 'granted') {
      if (!inited.current) {
        posthog.init(PH_KEY, {
          api_host:           PH_HOST,
          ui_host:            'https://us.posthog.com',
          capture_pageview:   false,
          capture_pageleave:  true,
          persistence:        'localStorage+cookie',
          session_recording: {
            maskAllInputs: true,
            // maskAllInputs only covers form inputs. Rendered TEXT - a saved
            // trade's notes, its thesis, and every dollar/R figure in
            // TradeJournal - was captured in the clear, so a user's trade
            // history and P&L landed in PostHog's recordings unmasked even
            // though nothing was ever typed into a masked field during that
            // capture. These are the only classes covered - PostHog masks
            // exactly the matched elements' text, not the whole page, so
            // anything added to TradeJournal later needs one of these classes
            // (or a new one added here) to be covered too.
            maskTextSelector: '.tj-trade-notes, .tj-tp-val, .tj-stat-val, .tj-breakdown-pnl, .tj-thesis-text',
          },
        });
        inited.current = true;
      } else {
        // Re-granted after a withdrawal in this same page load.
        posthog.opt_in_capturing();
      }
      setActive(true);
      return;
    }

    // Withdrawn mid-session. opt_out_capturing stops events AND recording and
    // clears posthog's stored ids; reset() drops the distinct_id so a later
    // re-consent is not silently stitched back onto the same person.
    if (inited.current) {
      posthog.opt_out_capturing();
      posthog.reset();
    }
    setActive(false);
  }, [consent]);

  return (
    <>
      {PH_KEY && active && (
        <Suspense fallback={null}>
          <PageViewTracker />
        </Suspense>
      )}
      {children}
    </>
  );
}
