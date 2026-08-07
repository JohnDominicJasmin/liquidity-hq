import * as Sentry from '@sentry/nextjs';
import { monitoringOptions } from '@/lib/monitoring';

// No session replay / breadcrumb DOM capture here on purpose - PostHog already
// does session replay for this app (see components/PostHogProvider.tsx); running
// two replay recorders would double the privacy surface, not add value.
//
// Shares lib/monitoring.ts with the server and edge runtimes. Before that, this
// file carried its own copy of the options and was the one missing the release
// tag and the PII scrubber - the client is where user ids end up in URLs, so it
// was the copy that most needed them.
Sentry.init(monitoringOptions());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
