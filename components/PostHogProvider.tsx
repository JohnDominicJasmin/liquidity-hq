'use client';
import posthog from 'posthog-js';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, Suspense } from 'react';
import { readConsent, onConsentChange, type ConsentState } from '@/lib/consent';
import { analyticsKey } from '@/lib/analytics';

// analyticsKey() also returns '' on any non-production environment, so a
// dev/qa/staging build cannot write into production's single PostHog project
// even if it is handed the key. See lib/analytics.ts.
//
// THE TWO VALUES MUST BE SPELLED OUT AS STATIC `process.env.NEXT_PUBLIC_*`
// MEMBER ACCESSES, exactly as below. Next.js inlines only that literal form at
// build time; passing `process.env` as an object and reading properties off it
// inside the function is a runtime lookup, and `process.env` is empty in the
// browser - so the key came back '' in EVERY environment, production included.
// That is how the first version of this shipped-in-thirty-seconds change would
// have silently switched analytics off for real users. Caught by building twice
// and checking the key was present in a prod build, not only absent in a dev one.
//
// NEXT_PUBLIC_* are inlined at build time, so this is resolved per build - a
// service that changes NEXT_PUBLIC_APP_ENV needs a rebuild, not a restart.
const PH_KEY  = analyticsKey({
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_APP_ENV:     process.env.NEXT_PUBLIC_APP_ENV,
});
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
    // A cookie can only be deleted by a write whose domain/path MATCH the one
    // it was set with. PostHog scopes its cookie to a domain, so expiring it
    // with `path=/` alone silently does nothing - verified on the dev deploy,
    // where the path-only write left the cookie untouched and adding an
    // explicit domain removed it. localhost hid this: there is no registrable
    // domain to scope to, so path-only happened to work there.
    //
    // We cannot read a cookie's domain back from document.cookie, so write the
    // expiry against every candidate: no domain, the exact host, and each
    // dot-prefixed parent suffix. Writes that do not match are inert.
    const host = location.hostname;
    const parts = host.split('.');
    const domains: (string | undefined)[] = [undefined, host, `.${host}`];
    for (let i = 1; i < parts.length - 1; i++) domains.push(`.${parts.slice(i).join('.')}`);

    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0].trim();
      if (!name.startsWith('ph_') && !name.toLowerCase().includes('posthog')) continue;
      for (const d of domains) {
        document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ''}`;
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
