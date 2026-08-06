import * as Sentry from '@sentry/nextjs';
import { monitoringOptions } from '@/lib/monitoring';

// Server + edge init. NEXT_PUBLIC_SENTRY_DSN doubles as the server-side DSN
// (Sentry DSNs are not secret - they're meant to be public) so one env var
// covers both instrumentation.ts and instrumentation-client.ts. Unset DSN =
// Sentry.init no-ops, same "off until configured" pattern as lib/email.ts.
//
// Everything that was spelled out per-runtime here now comes from
// lib/monitoring.ts: environment, release tag, PII scrubbing, and the
// tracesSampleRate: 0 quota decision with the reasoning behind it. The node and
// edge blocks were byte-identical duplicates of each other and a near-duplicate
// of the client's, which is how the client ended up without the same guarantees.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(monitoringOptions());
  }
}

export const onRequestError = Sentry.captureRequestError;
