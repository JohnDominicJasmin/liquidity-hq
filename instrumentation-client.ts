import { monitoringOptions } from '@/lib/monitoring';

// No session replay / breadcrumb DOM capture here on purpose - PostHog already
// does session replay for this app (see components/PostHogProvider.tsx); running
// two replay recorders would double the privacy surface, not add value.
//
// Shares lib/monitoring.ts with the server and edge runtimes. Before that, this
// file carried its own copy of the options and was the one missing the release
// tag and the PII scrubber - the client is where user ids end up in URLs, so it
// was the copy that most needed them.
//
// LOADED AFTER THE PAGE IS IDLE (speed audit 2026-11-17): the Sentry SDK was in the first-load JavaScript of
// every page (about 120 KB of the 540 KB a static page shipped). It is now imported after the load event and an
// idle moment. An error thrown before that is not lost: a tiny listener keeps the first few and hands them to
// Sentry once it is ready. lib/monitoring.ts has no imports, so reading the options here costs nothing.
type SentryModule = typeof import('@sentry/nextjs');

let sentry: SentryModule | null = null;
const early: unknown[] = [];
const MAX_EARLY = 10;
let pendingNav: Array<[string, string]> = [];

function keep(e: unknown) { if (early.length < MAX_EARLY) early.push(e); }

if (typeof window !== 'undefined') {
  const onError = (ev: ErrorEvent) => keep(ev.error ?? ev.message);
  const onRejection = (ev: PromiseRejectionEvent) => keep(ev.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  const start = () => {
    import('@sentry/nextjs').then((S) => {
      S.init(monitoringOptions());
      sentry = S;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      for (const e of early.splice(0)) { try { S.captureException(e); } catch { /* never breaks the page */ } }
      for (const [href, type] of pendingNav) {
        try { S.captureRouterTransitionStart(href, type as Parameters<SentryModule['captureRouterTransitionStart']>[1]); } catch { /* ditto */ }
      }
      pendingNav = [];
    }).catch(() => { /* monitoring unavailable: the page works without it */ });
  };
  const idle = () => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(start, { timeout: 5000 });
    else setTimeout(start, 3000);
  };
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

export const onRouterTransitionStart = (href: string, navigationType: string) => {
  if (sentry) sentry.captureRouterTransitionStart(href, navigationType as Parameters<SentryModule['captureRouterTransitionStart']>[1]);
  else if (pendingNav.length < 20) pendingNav.push([href, navigationType]);
};
