import * as Sentry from '@sentry/nextjs';

// No session replay / breadcrumb DOM capture here on purpose - PostHog already
// does session replay for this app (see components/PostHogProvider.tsx); running
// two replay recorders would double the privacy surface, not add value.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? 'production',
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
