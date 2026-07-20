import * as Sentry from '@sentry/nextjs';

// Server + edge init. NEXT_PUBLIC_SENTRY_DSN doubles as the server-side DSN
// (Sentry DSNs are not secret - they're meant to be public) so one env var
// covers both instrumentation.ts and instrumentation-client.ts. Unset DSN =
// Sentry.init no-ops, same "off until configured" pattern as lib/email.ts.
export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      environment: process.env.NEXT_PUBLIC_APP_ENV ?? 'production',
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      environment: process.env.NEXT_PUBLIC_APP_ENV ?? 'production',
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
