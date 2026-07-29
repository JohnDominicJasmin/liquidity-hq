'use client';
import posthog from 'posthog-js';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, Suspense } from 'react';

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

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!PH_KEY) return;
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
  }, []);

  return (
    <>
      {PH_KEY && (
        <Suspense fallback={null}>
          <PageViewTracker />
        </Suspense>
      )}
      {children}
    </>
  );
}
