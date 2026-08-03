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

// opt_out_capturing() stops further capture but leaves PostHog's own
// distinct_id sitting in a cookie and in localStorage. Withdrawing consent
// should not leave behind the identifier that was created under it, so drop
// those too. Matches on the ph_/posthog prefixes PostHog itself uses; the
// consent key (lhq_analytics_consent_v1) does not match either, so the user's
// choice survives the cleanup that choice triggers.
function clearPosthogArtifacts() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('ph_') || k.toLowerCase().includes('posthog'))
      .forEach(k => localStorage.removeItem(k));
  } catch { /* storage blocked - nothing to clear */ }
  try {
    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0].trim();
      if (name.startsWith('ph_') || name.toLowerCase().includes('posthog')) {
        document.cookie = `${name}=; Max-Age=0; path=/`;
      }
    }
  } catch { /* ignore */ }
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

    // Withdrawn mid-session. Order matters: reset() clears posthog's
    // persistence, which takes the opt-out flag with it, so opting out FIRST
    // and resetting second leaves capture re-enabled for the rest of the page
    // view - verified in a local audit, where no opt-out marker survived the
    // reset. reset() first drops the distinct_id so a later re-consent is not
    // stitched back onto the same person; opt_out_capturing() last is what
    // actually stops events and session recording, and it has to be the write
    // that sticks. The init gate above still blocks everything on next load
    // either way; this is what makes "turning this off stops collection
    // immediately" true within the current one.
    if (inited.current) {
      posthog.reset();
      posthog.opt_out_capturing();
    }
    // Runs even when posthog was never initialised in THIS page view, which is
    // the case that actually does the work. Measured behaviour:
    //
    //   Withdrawing mid-session - opt_out_capturing() stops events and
    //   recording straight away, but posthog then flushes its own persistence
    //   asynchronously and rewrites the distinct_id, so this clear does not
    //   stick for the rest of that page view. Deferring it by a macrotask was
    //   tried and still lost the race.
    //
    //   Next load - the gate above means posthog is never initialised, so
    //   there is nothing left to rewrite and the entries are removed for good.
    //
    // So capture stops immediately and the identifier is gone by the next
    // navigation. Not worth fighting posthog's write ordering for the seconds
    // in between, when nothing is being captured anyway.
    clearPosthogArtifacts();
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
