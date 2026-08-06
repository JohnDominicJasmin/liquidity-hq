/**
 * Shared GlitchTip/Sentry configuration for all three runtimes.
 *
 * Error reporting was already wired before this file existed - `instrumentation.ts`
 * (node + edge), `instrumentation-client.ts` (browser), and `lib/apiError.ts` for
 * the ~25 routes that catch their own errors and would otherwise never reach the
 * error boundary. Issue #51 asked for monitoring to be *added*; it was already
 * there and live in production. What was actually missing were three of the five
 * things that issue asked for, and this file is where they live so client, server
 * and edge cannot drift apart:
 *
 *   1. environment separation that does not break table selection (see below)
 *   2. a release tag, so "did this start with v2026.08.06.3?" is answerable
 *   3. PII scrubbing before an event leaves the process
 *
 * Deliberately NOT here: performance tracing. `tracesSampleRate` stays 0. Trace
 * events once consumed 99% of GlitchTip's 1,000/month free quota - 2,138 traces
 * against 14 real error issues - which throttled the error alerting this exists
 * for. Adding tracing back means paying for a plan or losing errors.
 */

/**
 * The environment label on every event.
 *
 * READ THIS BEFORE "FIXING" THE QA LABEL BY SETTING NEXT_PUBLIC_APP_ENV=qa.
 *
 * `NEXT_PUBLIC_APP_ENV` is not a label - it is a switch. `lib/tables.ts` does:
 *
 *     const p = process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_' : 'lhq_';
 *
 * so anything that is not exactly `'dev'` selects PRODUCTION table names. The qa
 * service therefore has to run with `NEXT_PUBLIC_APP_ENV=dev`, and it reports its
 * errors as "dev" as a side effect. This has already gone wrong once: qa was set
 * to `qa` at one point and pointed at the `lhq_*` tables while using the dev
 * database (docs/INFRASTRUCTURE.md §4b).
 *
 * So the error-tracker environment gets its OWN variable. Set
 * `NEXT_PUBLIC_SENTRY_ENV=qa` on the qa service and its events separate from dev's
 * without touching which tables it reads. Everywhere else can leave it unset.
 *
 * This matters more here than it would elsewhere: qa and dev share one Supabase
 * project, so their errors genuinely look alike. The environment tag is the only
 * thing that tells them apart.
 */
export function monitoringEnvironment(): string {
  return process.env.NEXT_PUBLIC_SENTRY_ENV
    || process.env.NEXT_PUBLIC_APP_ENV
    || 'production';
}

/**
 * The deployed commit, or undefined when it cannot be known.
 *
 * Render exposes `RENDER_GIT_COMMIT` at build time. `next.config.ts` copies it to
 * `NEXT_PUBLIC_RELEASE` so the browser bundle carries it too - a server-only value
 * would tag half the events and leave the other half unversioned, which is worse
 * than none because it looks like it works.
 *
 * Undefined rather than a placeholder on purpose: a literal "unknown" release
 * groups every untagged deploy together and reads like a real one.
 */
export function monitoringRelease(): string | undefined {
  return process.env.NEXT_PUBLIC_RELEASE || undefined;
}

/* A v4 UUID, which is what every user id and row id in this app looks like. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL = /[^\s/?&=]+@[^\s/?&=]+\.[a-z]{2,}/gi;

/**
 * Header names dropped outright. Lowercased before comparison - Next normalises
 * incoming headers but `onRequestError` hands them through as received, so both
 * `Authorization` and `authorization` turn up in practice.
 *
 * `apikey` is the Supabase anon key. It is publishable and RLS is the real
 * boundary, so this is not a breach - but an error tracker is not where it should
 * accumulate, and a reader who finds a key in a bug report cannot tell which kind
 * it is.
 */
const DROP_HEADERS = new Set([
  'authorization', 'cookie', 'set-cookie', 'apikey', 'x-api-key',
  'x-supabase-auth', 'proxy-authorization', 'x-cron-secret',
]);

/**
 * Strip identifiers out of a URL or path.
 *
 * Two jobs at once. The obvious one is privacy: this app puts user ids and row
 * ids directly in paths (`/api/hypotheses/<uuid>`), and query strings carry coin
 * symbols and occasionally an email.
 *
 * The less obvious one is that it makes the error tracker usable. Without it,
 * one broken route produces a separate issue per user id, and 400 issues that are
 * all the same bug look like 400 bugs. Collapsing to `/api/hypotheses/:id` is
 * what makes "this route is throwing" visible at all.
 */
export function scrubUrl(url: string): string {
  if (!url) return url;
  const [path, query] = url.split('?');
  const cleanPath = path.replace(UUID, ':id').replace(EMAIL, ':email');
  // The query string goes entirely. Nothing in this app puts anything in a query
  // parameter that is worth the risk of keeping - and "keep the safe ones" needs
  // an allowlist that some future route will forget to update.
  return query ? `${cleanPath}?<redacted>` : cleanPath;
}

/** Redact identifiers in free text - error messages, breadcrumb strings. */
export function scrubText(text: string): string {
  return text.replace(UUID, ':id').replace(EMAIL, ':email');
}

/** `Array.prototype.map` passes (value, index, array); scrubText's second
 *  parameter would silently become the index if passed directly. */
const scrubLine = (line: string) => (typeof line === 'string' ? scrubText(line) : line);

/**
 * The subset of a Sentry event this touches.
 *
 * Structural rather than imported from the SDK because `scrubEvent` is generic
 * over whatever it is handed - Sentry's `ErrorEvent` and `TransactionEvent` are
 * different types with the same relevant shape, and the unit tests pass plain
 * object literals. Naming only the fields we read keeps a version bump that adds
 * a field from turning into a type error here.
 */
type StackFrame = {
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  vars?: Record<string, unknown>;
};

type ScrubbableEvent = {
  request?: { url?: string; headers?: Record<string, unknown>; query_string?: unknown; cookies?: unknown; data?: unknown };
  user?: Record<string, unknown>;
  breadcrumbs?: ({ message?: string; data?: Record<string, unknown> } | undefined)[];
  exception?: { values?: { value?: string; stacktrace?: { frames?: StackFrame[] } }[] };
  message?: string;
};

/**
 * Last thing that runs before an event leaves the process.
 *
 * Exported and pure so it can be unit-tested without a browser or a network -
 * see `__tests__/monitoringScrub.test.mts`. A scrubber that is only exercised by
 * real traffic is one nobody finds out is broken until after the leak.
 *
 * Mutates and returns the event rather than cloning: Sentry hands us the object
 * it is about to serialise, and a clone that misses a field it did not know about
 * would silently drop context. Dropping what we name is safer than keeping only
 * what we name here, because the shape is the SDK's, not ours.
 */
export function scrubEvent<T>(event: T): T {
  const e = event as ScrubbableEvent;

  if (e.request) {
    if (typeof e.request.url === 'string') {
      e.request.url = scrubUrl(e.request.url);
    }
    delete e.request.query_string;
    delete e.request.cookies;
    // Request bodies can hold anything a user typed - journal notes, an email on
    // a sign-in attempt. There is no version of this worth keeping.
    delete e.request.data;
    if (e.request.headers) {
      for (const name of Object.keys(e.request.headers)) {
        if (DROP_HEADERS.has(name.toLowerCase())) delete e.request.headers[name];
      }
    }
  }

  /* The user id is deliberately KEPT. It is the difference between "someone hit
     this" and "every user hits this", and it is already the primary key we would
     use to reproduce. Email and IP are not - those identify a person rather than
     a row, and neither helps debug anything. */
  if (e.user) {
    delete e.user.email;
    delete e.user.ip_address;
    delete e.user.username;
  }

  if (typeof e.message === 'string') e.message = scrubText(e.message);

  for (const value of e.exception?.values ?? []) {
    if (typeof value.value === 'string') value.value = scrubText(value.value);

    /* Stack frames carry SOURCE CODE, not just line numbers - the SDK's
       contextLines integration attaches the throwing line plus several either
       side, verbatim. Found while verifying this scrubber end to end: the
       exception message came through correctly redacted while an email survived
       in `post_context`, because the surrounding source contained it.

       In that instance the source was the test harness, so it was not a product
       leak. It is still the right thing to close: these are bytes leaving the
       process that nothing else inspects, and `vars` (opt-in local-variable
       capture, off today) would carry runtime values into the same field if it
       were ever switched on. */
    for (const frame of value.stacktrace?.frames ?? []) {
      if (typeof frame.context_line === 'string') frame.context_line = scrubText(frame.context_line);
      if (Array.isArray(frame.pre_context)) frame.pre_context = frame.pre_context.map(scrubLine);
      if (Array.isArray(frame.post_context)) frame.post_context = frame.post_context.map(scrubLine);
      if (frame.vars) {
        for (const [k, v] of Object.entries(frame.vars)) {
          if (typeof v === 'string') frame.vars[k] = scrubText(v);
        }
      }
    }
  }

  for (const crumb of e.breadcrumbs ?? []) {
    if (!crumb) continue;
    if (typeof crumb.message === 'string') crumb.message = scrubText(crumb.message);
    if (crumb.data && typeof crumb.data.url === 'string') crumb.data.url = scrubUrl(crumb.data.url);
    // Navigation breadcrumbs carry the path on `from`/`to`, not `url`.
    if (crumb.data && typeof crumb.data.from === 'string') crumb.data.from = scrubUrl(crumb.data.from);
    if (crumb.data && typeof crumb.data.to === 'string') crumb.data.to = scrubUrl(crumb.data.to);
  }

  return event;
}

/**
 * The options every runtime shares. Spread this, then add runtime-specific keys.
 *
 * `sendDefaultPii: false` is the SDK default in v8+, but it is stated explicitly
 * because it is the single flag that decides whether request headers, cookies and
 * IPs get attached at all. Leaving it implicit means a future SDK upgrade, or
 * someone copying an example from the docs that sets it true, changes what leaves
 * this app with nothing in the diff to argue with.
 */
export function monitoringOptions() {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: monitoringEnvironment(),
    release: monitoringRelease(),
    // See the file header - this is a quota decision, not an oversight.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    /* Passed by reference rather than wrapped in an arrow. `scrubEvent` is
       generic in its argument, so it satisfies both hook signatures without
       importing `ErrorEvent`/`TransactionEvent` - the latter is not re-exported
       by @sentry/nextjs, and reaching into @sentry/core for a type would add an
       undeclared dependency on a transitive package. */
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  };
}
