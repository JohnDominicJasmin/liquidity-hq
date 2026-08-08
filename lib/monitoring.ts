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
 * The DSN, but only where reporting is actually wanted - production.
 *
 * WHY THIS IS A CODE GUARD AND NOT JUST A DASHBOARD SETTING.
 *
 * All three services pointed at ONE GlitchTip project (25983) sharing ONE
 * 1,000-event/month free quota, and dev plus qa spent it. Measured on
 * 2026-08-06: a forced error from prod AND from staging both returned HTTP 429.
 * So production error reporting was dead - not "noisy", dead - and nothing said
 * so. QA found it (issue #57), and a Playwright run against staging is part of
 * what filled it. QA doing its job should never be able to switch production
 * monitoring off.
 *
 * `environment` does not fix this. It is a TAG: it makes events filterable after
 * they arrive. It does not stop them arriving and it does not give them separate
 * quotas.
 *
 * Unsetting the DSN on the two non-prod services fixes it too, and should also
 * be done. This guard exists because that config is one dashboard edit away from
 * regressing, and the regression is SILENT - nobody discovers monitoring is off
 * until they need it, which is exactly when they cannot afford it to be off.
 *
 * ON THE PREDICATE. Issue #57 suggested `=== 'prod'`. This uses `!== 'dev'`
 * instead, deliberately, to match the one switch the rest of the app already
 * turns on (lib/tables.ts, lib/apiHealth.ts, the LemonSqueezy webhook):
 *
 *     NEXT_PUBLIC_APP_ENV === 'dev' ? <non-prod> : <prod>
 *
 * Both predicates exclude qa and dev, because qa is REQUIRED to run as 'dev'
 * (see monitoringEnvironment above). They differ only if the variable goes
 * missing on prod: `=== 'prod'` would then silently kill the monitoring this
 * issue exists to restore, while `!== 'dev'` keeps it on. A stray service that
 * forgets the variable and starts reporting is noisy but visible; that same
 * service would also be reading PRODUCTION tables, which is a far louder alarm
 * than a few extra error events.
 *
 * Neither case is silent now: a DSN that is present but suppressed logs once at
 * startup, so "why is nothing arriving" is answerable from the logs.
 */
export function monitoringDsn(): string | undefined {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return undefined;

  if (process.env.NEXT_PUBLIC_APP_ENV === 'dev') {
    // Deliberately not silent. The whole failure mode being fixed here is
    // "monitoring is off and nothing said so" - suppressing quietly would just
    // move that failure rather than remove it.
    console.info(
      '[monitoring] DSN present but suppressed: NEXT_PUBLIC_APP_ENV=dev. ' +
      'Non-production services do not report, so they cannot spend production\'s ' +
      'shared GlitchTip quota (issue #57). Unset the DSN here to silence this.',
    );
    return undefined;
  }
  return dsn;
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

/* CREDENTIALS. Added 2026-08-08 after QA's pipeline test captured a real
 * envelope carrying a session token in the clear (#72):
 *
 *   "checkout failed for :email with sb-abcdef-auth-token"
 *
 * The email was redacted. The token was not, because until now this file only
 * knew about UUIDs and emails. Error messages are exactly where credentials
 * land - a failing request tends to include what it authenticated with.
 *
 * These are deliberately SPECIFIC patterns rather than one "long random string"
 * rule. A generic rule redacts ids, hashes and stack frames, and a scrubber
 * that mangles ordinary output gets weakened by the next person who has to read
 * through it.
 */

/* A JWT: three base64url segments, the first starting `eyJ` because that is
   base64 for `{"`. Supabase access and refresh tokens are JWTs, and so is the
   legacy anon/service-role key - so this one pattern covers the credential that
   matters most and the one that must never appear at all. Nothing else in this
   app's output has this shape. */
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g;

/* `Authorization: Bearer <token>` reproduced inside a message body. The header
   itself is dropped by DROP_HEADERS; this catches the copy that ends up in
   prose, which is the path DROP_HEADERS cannot see. */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/* Supabase's newer key format, which is not a JWT: sb_secret_… is the
   service-role replacement and bypasses RLS entirely. sb_publishable_… is safe
   by design, but a reader who finds one in a bug report cannot tell which kind
   it is - the same reasoning `apikey` is in DROP_HEADERS. */
const SB_KEY = /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g;

/* The browser's session storage key, `sb-<project-ref>-auth-token`. The NAME is
   not a credential, but it carries the project ref, and its VALUE is a JSON
   blob holding the tokens above - so a message quoting the key is usually a
   message about to quote the value. */
const SB_STORAGE_KEY = /\bsb-[a-z0-9-]{4,}-auth-token\b/gi;

/**
 * Credentials first, then identifiers.
 *
 * Order is load-bearing: a token can contain a UUID-shaped substring, and if
 * UUID ran first it would rewrite part of the token to `:id` and leave the rest
 * - producing something that no longer matches JWT and survives as a partial
 * credential. Most specific to least, always.
 */
function scrubSecrets(text: string): string {
  return text
    .replace(JWT, ':jwt')
    .replace(BEARER, 'Bearer :token')
    .replace(SB_KEY, ':supabase-key')
    .replace(SB_STORAGE_KEY, ':supabase-token-key');
}

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

  /* THE FRAGMENT GOES FIRST, and it is the reason this function was wrong.
   *
   * This app uses Supabase's IMPLICIT OAuth flow deliberately - PKCE was tried
   * and reverted on 2026-07-20 because it broke real mobile Google logins. The
   * implicit flow returns the session in the URL FRAGMENT:
   *
   *   /auth/callback#access_token=eyJ…&refresh_token=…
   *
   * A fragment is never sent to a server, so nothing on the API side could ever
   * see it. But the browser SDK reports `window.location.href`, which has it -
   * and this function split on `?` only, so a live access token passed through
   * untouched. Verified before the fix by running the real function against a
   * real-shaped callback URL.
   *
   * Dropped whole rather than scrubbed. A fragment on this app's URLs carries
   * auth material or nothing worth keeping. */
  const [beforeHash, hash] = url.split('#');
  const hadFragment = hash !== undefined && hash.length > 0;

  const [path, query] = beforeHash.split('?');
  const cleanPath = scrubSecrets(path).replace(UUID, ':id').replace(EMAIL, ':email')
    + (hadFragment ? '#<redacted>' : '');
  // The query string goes entirely. Nothing in this app puts anything in a query
  // parameter that is worth the risk of keeping - and "keep the safe ones" needs
  // an allowlist that some future route will forget to update.
  return query ? `${cleanPath}?<redacted>` : cleanPath;
}

/** Redact credentials and identifiers in free text - error messages, breadcrumbs. */
export function scrubText(text: string): string {
  return scrubSecrets(text).replace(UUID, ':id').replace(EMAIL, ':email');
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
    // Undefined outside production - see monitoringDsn. Sentry.init treats an
    // absent DSN as "off", which is the documented behaviour .env.example:95
    // already relies on, so nothing else needs a branch.
    dsn: monitoringDsn(),
    environment: monitoringEnvironment(),
    release: monitoringRelease(),
    // See the file header - this is a quota decision, not an oversight.
    tracesSampleRate: 0,
    /* THE SAME QUOTA DECISION, and the one that was actually spending it.
       `tracesSampleRate: 0` stopped transactions. Sessions were never in scope,
       so Release Health quietly became the entire consumption.

       Measured on production 2026-08-08, six routes, signed out, no interaction:
       14 envelopes across 6 pageviews and ZERO of them an error. Every single
       item was `type=session`. At ~2.3 envelopes per pageview a 1,000-event
       month is gone in roughly 430 pageviews - ordinary browsing, not a bug
       firing in a loop.

       That is why hunting for a noisy error never found the source (issue #73):
       there was no noisy error. Error reporting was not merely degraded, it was
       DEAD - every error envelope came back 429 because sessions had already
       spent the month.

       WHY AN INTEGRATION FILTER AND NOT `autoSessionTracking: false`. That
       option was removed in SDK v10; this project is on 10.67.0. Setting it does
       NOTHING - and nothing complains, because these options are passed to
       Sentry.init() as a plain object literal, so TypeScript's excess-property
       check never runs on them. The first attempt at this fix set that option,
       shipped green, and changed no behaviour whatsoever. Sessions come from the
       `BrowserSession` integration, which IS in getDefaultIntegrations().

       Harmless on server and edge, where BrowserSession is not in the defaults
       and the filter simply matches nothing.

       What is given up: crash-free-session rate. Not a real loss today - the
       metric was being rejected at the door with everything else, so nobody
       could read it either. If the tier is ever paid for, drop this filter
       deliberately rather than by accident. */
    integrations: (defaults: { name: string }[]) =>
      defaults.filter(i => i.name !== 'BrowserSession'),
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
