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
    // #1397: a memory line in the log every 10 minutes (lib/memWatch.ts), so a rise in the instance's memory names what grew.
    const { startMemWatch } = await import('@/lib/memWatch');
    startMemWatch();
    // #1263: load the label tables once at server start, so the first visitor after a deploy or a restart does not pay the 2.5-3 s read (lib/labelsServer.ts). Never throws; a failed warm leaves it cold.
    const { warmLabels } = await import('@/lib/labelsServer');
    warmLabels();
    // #1632 item 4: the liquidation collector runs in this process, on the production service only (LIQ_COLLECTOR=1; a no-op otherwise). See lib/liqCollector.ts.
    const { startLiqCollector } = await import('@/lib/liqCollector');
    startLiqCollector();
    // The stablecoin supply series behind /research is cached a day; warm it so the first visitor does not wait on DeFi Llama (lib/dryPowderSeries.ts). Never throws.
    const { warmDryPowderSeries } = await import('@/lib/dryPowderSeries');
    warmDryPowderSeries();
    // A ban an exchange gave this IP before the restart still applies: read the saved breaker state now, before the warm-ups below call
    // any exchange (lib/exchangeBreakerStore.ts). Not awaited; the first exchange call waits for it briefly. Never throws.
    const { hydrateExchangeBreaker } = await import('@/lib/exchangeGuard');
    void hydrateExchangeBreaker();
    /* The market snapshot and the RSI map are cold after every deploy and restart, and the first visitors were served partial data
       while the fan-out filled (owner sweep 2026-11-18). Started a few seconds after boot so the server is up first; never throws, and a
       failed warm simply leaves the cache cold as before. Not in tests or builds (NEXT_RUNTIME is only set by a running server). */
    setTimeout(() => {
      void import('@/lib/marketSnapshotData').then(m => m.marketSnapshotData()).catch(() => {});
      void import('@/lib/marketRsi').then(m => m.rsiGroups()).catch(() => {});
    }, 5_000).unref?.();
  }
}

export const onRequestError = Sentry.captureRequestError;
