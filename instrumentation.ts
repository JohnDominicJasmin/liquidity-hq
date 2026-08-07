import * as Sentry from '@sentry/nextjs';
import { monitoringOptions } from '@/lib/monitoring';
import { checkEnv, reportEnv } from '@/lib/envCheck';

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
  // Node only. The edge runtime boots per-request in some deployments, so
  // running it there would repeat the same lines on every request, and it is
  // the node process that reads the server-side variables anyway.
  //
  // Runs AFTER Sentry.init so a fatal misconfiguration is still reported to
  // whatever monitoring is configured, rather than dying silently before the
  // client exists. See lib/envCheck.ts for why only one rule throws.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    reportEnv(checkEnv());
  }
}

export const onRequestError = Sentry.captureRequestError;
