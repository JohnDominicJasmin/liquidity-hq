'use client';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, Suspense } from 'react';

const PH_KEY  = process.env.NEXT_PUBLIC_POSTHOG_KEY  ?? '';
const PH_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

// ── Page view tracker (needs Suspense because of useSearchParams) ─────────
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

// ── Provider ──────────────────────────────────────────────────────────────
export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!PH_KEY) return;
    posthog.init(PH_KEY, {
      api_host:           PH_HOST,
      ui_host:            'https://us.posthog.com',
      capture_pageview:   false,   // we fire $pageview manually per route change
      capture_pageleave:  true,
      persistence:        'localStorage+cookie',
      // Session recording — mask only passwords
      session_recording: {
        maskAllInputs:    false,
        maskInputOptions: { password: true },
      },
    });
  }, []);

  if (!PH_KEY) return <>{children}</>;

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </PHProvider>
  );
}
