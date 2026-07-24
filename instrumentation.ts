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
      // Performance tracing off - GlitchTip's free-tier event quota (1,000/mo)
      // was 99% consumed by trace events (2,138 in one month) vs 14 real
      // error issues, throttling the exact error-alerting apiError() relies
      // on. Errors matter here, latency traces don't - see lib/apiError.ts.
      tracesSampleRate: 0,
      environment: process.env.NEXT_PUBLIC_APP_ENV ?? 'production',
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      // Performance tracing off - GlitchTip's free-tier event quota (1,000/mo)
      // was 99% consumed by trace events (2,138 in one month) vs 14 real
      // error issues, throttling the exact error-alerting apiError() relies
      // on. Errors matter here, latency traces don't - see lib/apiError.ts.
      tracesSampleRate: 0,
      environment: process.env.NEXT_PUBLIC_APP_ENV ?? 'production',
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
