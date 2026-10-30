import fs from 'node:fs';
import path from 'node:path';
/* The only runtime import from Playwright in this file, and it is here so an environment outage can be
   reported as a SKIP rather than 67 failures - see the outage block above mintSession. Safe because every
   importer of this module is a spec or a spec helper, checked 2026-10-30. */
import { test } from '@playwright/test';
import { gotoGuarded } from './_shared';

/**
 * Credentials + token minting for the authenticated specs.
 *
 * Two accounts, both on the DEV Supabase project only. A is seeded with one row
 * in each table under test; B is deliberately empty, because the BOLA test is
 * "B asks for A's rows by id and must be refused" - giving B its own data would
 * only obscure that.
 *
 * Passwords rather than tokens on purpose: a Supabase access token expires in
 * about an hour, so a pasted token passes once and then fails CI the next day.
 * Minting per run is the only version that keeps working unattended.
 */

/** Reads KEY=value files without adding a dotenv dependency. CI has no files, only env. */
function loadEnvFile(file: string): void {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;           // real env always wins over a file
    process.env[k] = raw.trim().replace(/^["']|["']$/g, '');
  }
}
loadEnvFile('.env.e2e.local');
loadEnvFile('.env.local');

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const FIXTURES = {
  aEmail: process.env.E2E_USER_A_EMAIL ?? '',
  aPassword: process.env.E2E_USER_A_PASSWORD ?? '',
  aId: process.env.E2E_USER_A_ID ?? '',
  bEmail: process.env.E2E_USER_B_EMAIL ?? '',
  bPassword: process.env.E2E_USER_B_PASSWORD ?? '',
  bId: process.env.E2E_USER_B_ID ?? '',
  /** A's row ids. The test must request these explicitly - guessing ids is how
   *  this test ends up asserting nothing. */
  tradeId: process.env.E2E_A_TRADE_ID ?? '',
  hypothesisId: process.env.E2E_A_HYPOTHESIS_ID ?? '',
  priceAlertId: process.env.E2E_A_PRICE_ALERT_ID ?? '',
  /** B's own price alert, seeded 2026-08-08 so a PRO caller has something it
   *  does not own to attempt. Before it existed the whole table held one row,
   *  A's - which is also why E2E_A_PRICE_ALERT_ID was `1` and redacted every
   *  digit `1` from CI logs (#107). */
  bPriceAlertId: process.env.E2E_B_PRICE_ALERT_ID ?? '',

  /** Account C - the sacrificial fixture for #243's real-purchase run
   *  (#239). Referenced by nothing else, deliberately: it exists to be the
   *  one account a real LemonSqueezy purchase is allowed to mutate, without
   *  touching A or B's pinned entitlement states that entitlements.spec.ts
   *  depends on. */
  cEmail: process.env.E2E_USER_C_EMAIL ?? '',
  cPassword: process.env.E2E_USER_C_PASSWORD ?? '',

  /* T AND ADMIN, added 2026-10-23 for the state matrix the owner commissioned: "account signed in, account is free,
   * account is pro, login, logout, or a free trial ... Just have multiple accounts."
   *
   * They are NOT in REQUIRED_FIXTURES below, deliberately. AUTH_READY gates ~20 specs that only need A and B; adding
   * these would make all of them skip on an environment that has what they actually need. The matrix checks its own
   * two accounts and says which state it could not reach, which is the shape every other gate here already uses. */
  tEmail: process.env.E2E_USER_T_EMAIL ?? '',
  tPassword: process.env.E2E_USER_T_PASSWORD ?? '',
  tId: process.env.E2E_USER_T_ID ?? '',
  /** The trial's end date, so a spec can say "active" or "expired" from the fixture rather than from the rendered page. */
  tTrialEnds: process.env.E2E_USER_T_TRIAL_ENDS ?? '',
  adminEmail: process.env.E2E_USER_ADMIN_EMAIL ?? '',
  adminPassword: process.env.E2E_USER_ADMIN_PASSWORD ?? '',
  adminId: process.env.E2E_USER_ADMIN_ID ?? '',
  cId: process.env.E2E_USER_C_ID ?? '',
} as const;


/* Everything the authenticated specs need, or they must skip rather than pass.
 *
 * NAMED INDIVIDUALLY so the skip message can say WHICH one is missing. The
 * previous version was a single boolean and a message listing every variable as
 * a glob (`E2E_USER_A_* / E2E_USER_B_* / E2E_A_*_ID / ...`), which is accurate
 * and useless: it cannot distinguish "no fixtures at all" from "nine of ten".
 *
 * That cost real time on 2026-08-10. `E2E_B_PRICE_ALERT_ID` alone was absent
 * from `.env.e2e.local` - CI supplies it as a GitHub *variable* rather than a
 * secret, so it never made it into the local file - and its absence silently
 * skipped ALL TWENTY authenticated tests, including the entire BOLA/IDOR
 * security suite. Combined with the browser suite not running in CI at the time
 * (#207), the authenticated surface was covered by nothing anywhere, and the
 * only symptom was `20 skipped` scrolling past.
 *
 * A skip that does not name its cause is a silent gap with extra steps. */
const REQUIRED_FIXTURES: ReadonlyArray<readonly [name: string, value: string]> = [
  ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', SUPABASE_ANON],
  ['E2E_USER_A_EMAIL', FIXTURES.aEmail],
  ['E2E_USER_A_PASSWORD', FIXTURES.aPassword],
  ['E2E_USER_B_EMAIL', FIXTURES.bEmail],
  ['E2E_USER_B_PASSWORD', FIXTURES.bPassword],
  ['E2E_A_TRADE_ID', FIXTURES.tradeId],
  ['E2E_A_HYPOTHESIS_ID', FIXTURES.hypothesisId],
  ['E2E_A_PRICE_ALERT_ID', FIXTURES.priceAlertId],
  ['E2E_B_PRICE_ALERT_ID', FIXTURES.bPriceAlertId],
];

const MISSING_FIXTURES = REQUIRED_FIXTURES.filter(([, v]) => !v).map(([n]) => n);

export const AUTH_READY = MISSING_FIXTURES.length === 0;

export const AUTH_SKIP_REASON =
  `authenticated fixtures absent - MISSING: ${MISSING_FIXTURES.join(', ')}. ` +
  'Set them in `.env.e2e.local` (gitignored) or as env vars. Note that CI supplies ' +
  'E2E_A_PRICE_ALERT_ID and E2E_B_PRICE_ALERT_ID as GitHub VARIABLES rather than secrets - ' +
  'they are row ids in the dev database, not credentials - so they are easy to miss when ' +
  'copying a local file from the secret list. See the issue "QA unblocked: two seeded test ' +
  'accounts".\n\n' +
  'Skipping rather than passing: a BOLA test that runs without fixtures proves nothing. ' +
  'But a skip is NOT a pass either - if you are seeing this, the authenticated surface ' +
  'is being verified by nothing at all in this run.';

/* #1348/#1347 item 1: a spec that fires real, billed xAI calls (QUICK/DEEP
 * against /api/grok) must not run as part of the ordinary suite - CI's
 * `test:e2e` job runs unscoped on every push to a release PR (staging ->
 * main), and because a release PR's head IS its base branch, every push to
 * `staging` while one is open re-fires it via `synchronize`. AUTH_READY
 * alone does not gate this: CI supplies the E2E_USER_* fixtures as real
 * secrets, so an authenticated-only gate is satisfied there too - a
 * SEPARATE, explicit opt-in is required, defaulting to skip, the same way
 * a skip is loud and stated rather than silent.
 *
 * Deliberately not tied to AUTH_READY or NODE_ENV=test - both are true in
 * CI, which is exactly the environment this must default OFF in. A human
 * (or a deliberately configured job) sets E2E_ALLOW_BILLED_CALLS=1 to opt
 * in; nothing else does. */
export const BILLED_CALLS_READY = process.env.E2E_ALLOW_BILLED_CALLS === '1';

export const BILLED_CALLS_SKIP_REASON =
  'this spec fires real, billed xAI API calls (QUICK/DEEP via /api/grok) and does not run by ' +
  'default - set E2E_ALLOW_BILLED_CALLS=1 to opt in deliberately. Not gated on AUTH_READY: CI ' +
  'supplies real E2E_USER_* secrets, so an auth-only gate would let this fire on every push to ' +
  'a release PR (staging -> main re-runs the whole suite via `synchronize` on every push while ' +
  'one is open). Skipping rather than passing: this is not a pass on the mechanism it checks - ' +
  'it is verifying nothing this run, deliberately, to avoid an unplanned recurring cost.';

/* ENTITLEMENT FIXTURES ARE A AND B, PINNED.
 *
 *   A -> role='pro',  trial_ends_at NULL
 *   B -> role='free', trial_ends_at NULL
 *
 * No third account, and no dates. Both were previously `free` with a trial
 * running to 2026-08-19, which meant BOTH got Pro features - so B as a "free"
 * fixture would have proven nothing about the free boundary while the trial ran,
 * then started proving it silently on the 20th, mid-launch-week.
 *
 * `trial_ends_at` is NULL rather than a past date on purpose. A past date is
 * something that can be renewed by accident; NULL is a state.
 *
 * `entitlements.spec.ts` FAILS if either has drifted from the above rather than
 * adapting to what it finds - the previous version derived its expectation from
 * whatever the account happened to be, which is how a spec ends up meaning one
 * thing in July and the opposite in August while reporting green throughout.
 */
export const ENTITLEMENT_READY = AUTH_READY;

export const ENTITLEMENT_SKIP_REASON =
  'entitlement fixtures absent - ' + AUTH_SKIP_REASON;

/* ACCOUNT C, SEPARATELY GATED FROM A/B (#243).
 *
 * C's password is not in this checkout as of 2026-09-06 - the issue that
 * created this fixture says so explicitly and asks whoever has it to rotate
 * it first rather than hand over the value that already sits in a session
 * transcript. So this is its own readiness flag rather than folded into
 * AUTH_READY: A/B's 20 existing authenticated tests must keep running
 * whether or not C's password ever arrives, and C's absence must not read as
 * "the authenticated surface is uncovered" when it already is, by A and B. */
const REQUIRED_ACCOUNT_C: ReadonlyArray<readonly [name: string, value: string]> = [
  ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', SUPABASE_ANON],
  ['E2E_USER_C_EMAIL', FIXTURES.cEmail],
  ['E2E_USER_C_PASSWORD', FIXTURES.cPassword],
  ['E2E_USER_C_ID', FIXTURES.cId],
];

const MISSING_ACCOUNT_C = REQUIRED_ACCOUNT_C.filter(([, v]) => !v).map(([n]) => n);

export const ACCOUNT_C_READY = MISSING_ACCOUNT_C.length === 0;

export const ACCOUNT_C_SKIP_REASON =
  `account C fixtures absent - MISSING: ${MISSING_ACCOUNT_C.join(', ')}. ` +
  'E2E_USER_C_PASSWORD in particular is not yet set anywhere QA has access to - ' +
  'see #239/#243. Skipping rather than failing: the LemonSqueezy real-purchase ' +
  'harness cannot run without it, and that is a fixture gap, not a product defect.';

/**
 * #949/#1025: every call used to be its own `/auth/v1/token?grant_type=password`
 * POST - a real GoTrue password-grant, bcrypt verification and session-row
 * write included, against a database that was sitting at 91% of its Disk IO
 * budget. 34 call sites across the suite, most for account A, each minting a
 * session nobody was going to use for more than a few minutes. Session reuse
 * within a run costs nothing correctness-wise - the comment on `signIn`
 * already established that a stale token across CI RUNS is the failure mode
 * to avoid, not a stale token within one.
 *
 * Cached by email so `signIn()` and `signedInContext()` share one mint per
 * account per worker process, and the admin/account-C paths that go through
 * `signIn()` directly benefit too, not just the fixture letters.
 *
 * The cache holds a PROMISE, not the resolved session, so two calls for the
 * same email that land before the first mint resolves share the one in-flight
 * request instead of racing two mints - the concurrent-test-functions case in
 * files that don't serialise their signed-in setups.
 */
interface CachedSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: unknown;
  mintedAtMs: number;
}

const sessionCache = new Map<string, Promise<CachedSession>>();

// Refresh this many seconds before actual expiry, so a test that runs long
// never hands the app a token that dies mid-request instead of getting a
// fresh one up front.
const EXPIRY_SAFETY_MARGIN_SECONDS = 120;

/* ── AN OUTAGE IS NOT A TEST FAILURE, BUT IT MUST NOT BE A GREEN GATE EITHER ────────────────────────────────
   `AUTH_READY` above asks only whether the credentials are SET. On 2026-10-29 all ten were set and the dev
   Supabase edge was answering 522 - 64 of those plus 3x 504 - so 67 specs failed hard, the gate burned its
   full 120 minutes, and a release shipped with the browser suite unrun.

   WHY THIS DOES NOT SIMPLY SKIP, which is what I wrote first and had to be corrected on: a Playwright run
   whose specs SKIP exits 0, there is no --forbid-skip, and `ci.yml` asserts `needs.e2e.result == success`
   over an aggregate that is "success only if every leg succeeded" - its own words, line 485. An all-skip run
   would therefore PASS the release gate having never exercised authentication once, which is strictly worse
   than 2026-10-29's 67 reds. Those were ugly and they were TRUE. It compounds with #1812's
   `continue-on-error: ${{ matrix.project == 'mobile' }}` at line 780: a mobile leg could skip everything and
   be excused as well. Caught by PM/DevOps on review.

   SO THE FIRST FEW OUTAGE-SHAPED ANSWERS FAIL, AND ONLY THEN DO THE REST SKIP. The gate still goes red, the
   log stops repeating itself 67 times, and the run stops re-probing a dead endpoint.

   The discrimination is deliberately NARROW, because a skip that swallows a real auth regression is worse
   than a red one:

     fetch rejects outright, or the body is not JSON   the edge answered, not GoTrue    count as OUTAGE
     502 503 504 520 521 522 523 524                   gateway statuses                 count as OUTAGE
     408 429                                           throttled, not refused           count as THROTTLE
     500 WITH a JSON body                              GoTrue itself answered           always a FAILURE
     any other 4xx, wrong password included            the product refused us           always a FAILURE

   408 and 429 are 4xx, but neither is a credentials regression: this suite mints a session per spec, so a
   rate limit floods precisely the uninformative red this block exists to remove. They carry their own
   wording so they stay distinguishable from a gateway outage AND from a real defect. The 500-with-a-body
   case stays a hard failure on purpose - the NULL-token-columns bug is a real defect in our own data and
   skipping past it would hide something we should fix. */
const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);
const THROTTLE_STATUSES = new Set([408, 429]);

/* TWO CONSECUTIVE BEFORE LATCHING, NOT ONE. A single transient blip on whichever spec happens to run first
   would otherwise turn a would-be-green run into a non-run, and under the rule above into a red release. A
   successful mint or a genuine product failure resets the count, so "consecutive" means consecutive.

   THE LATCH IS PER WORKER, NOT PER RUN, and that is stated rather than left implied: module state does not
   cross Playwright's worker processes, so each worker latches on its own evidence. With W workers a dark
   environment shows up to 2xW failures before the skips begin - 4 at the configured 2 workers, against 67.
   Each worker needing its own evidence is the safer side of that trade. */
const OUTAGE_FAILURES_BEFORE_LATCHING = 2;
let consecutiveOutages = 0;
let latchedReason: string | null = null;

function skipBecauseLatched(reason: string): never {
  try {
    test.info();                    // throws when there is no test running
  } catch {
    throw new Error(reason);        // tools and global setup still fail loudly rather than vanish
  }
  test.skip(true, reason);          // Playwright does not run the test past this call
  throw new Error(reason);          // unreachable; keeps the `never` return honest
}

/* Counts the outage, latches on the second consecutive one, and ALWAYS throws. The throw is what keeps the
   release gate honest; the latch is only what keeps the log and the clock short. */
function failAndMaybeLatch(reason: string): never {
  consecutiveOutages += 1;
  if (consecutiveOutages >= OUTAGE_FAILURES_BEFORE_LATCHING) latchedReason = reason;
  throw new Error(
    `${reason} [occurrence ${consecutiveOutages} in this worker - ` +
    (latchedReason
      ? 'everything needing a signed-in session is SKIPPED from here, and a run whose auth skipped is NOT a verified run]'
      : 'one more consecutive answer like this and the remainder will be skipped]'),
  );
}

function mintSession(email: string, password: string): Promise<CachedSession> {
  return (async () => {
    if (latchedReason) {
      sessionCache.delete(email);
      skipBecauseLatched(latchedReason);
    }
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).catch((cause: unknown) => {
      sessionCache.delete(email);
      return failAndMaybeLatch(
        `the Supabase auth endpoint did not answer at all: ${String(cause)}. ` +
        `${SUPABASE_URL} is unreachable from this runner, so this is the environment and not the product.`,
      );
    });
    let bodyWasNotJson = false;
    const body = await res.json().catch(() => { bodyWasNotJson = true; return {}; });
    if (!res.ok || !body.access_token) {
      // Remove the failed attempt so a transient failure doesn't poison every
      // later call for this email with a permanently-rejected cache entry.
      sessionCache.delete(email);
      const detail = bodyWasNotJson
        ? `HTTP ${res.status}, and the body was not JSON`
        : `HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`;

      /* STATUS IS CLASSIFIED BEFORE BODY SHAPE, AND THE WORDING KEYS OFF THE BODY RATHER THAN THE STATUS.
         Both corrections come from PM/DevOps reading this file rather than my summary of it, and both were
         mislabels rather than defects - the two-failure rule reddens the gate either way:

           - a 429 served as an HTML rate-limit page used to match `bodyWasNotJson` first and report
             "refused", losing the exact distinction 429 was given its own path for;
           - a GoTrue-issued 503 WITH a real JSON body used to report "the edge is down", which inverts the
             500-with-a-body carve-out. Something plainly answered, so the edge was not down.

         Throttling is therefore tested first, and the outage message now states whether anything spoke JSON
         instead of asserting where in the chain the failure was. Classifying on a status alone cannot tell
         an absent service from an unavailable one; the body can. */
      if (THROTTLE_STATUSES.has(res.status)) {
        failAndMaybeLatch(
          `the auth endpoint is rate limiting us rather than refusing our credentials: sign-in for ${email} ` +
          `got ${detail}. This suite mints a session per spec, so read this as throughput and not as a defect.`,
        );
      }

      if (GATEWAY_STATUSES.has(res.status) || bodyWasNotJson) {
        failAndMaybeLatch(
          bodyWasNotJson
            ? `nothing in front of GoTrue spoke JSON - the environment, not the product: sign-in for ` +
              `${email} got ${detail}, so the request did not reach the auth service and no product code is ` +
              `in the path.`
            : `the auth service reports itself unavailable - the environment, not the product: sign-in for ` +
              `${email} got ${detail}. It answered with a body, so this is unavailability rather than a ` +
              `refusal of our credentials.`,
        );
      }

      // A genuine product failure breaks the run of outage-shaped answers.
      consecutiveOutages = 0;

      /* THE HINT IS NOW GATED ON ITS OWN CONDITION, which is the whole point. It used to read "If this is
         500 ..." and print on every sign-in failure, so a teammate reading 67 of them out of a CI log
         reported the schema bug as the cause - while the `{}` in the very same line disproved it, because
         an empty body means res.json() threw and GoTrue never answered. Advice that prints when its
         condition is false is indistinguishable from a diagnosis. */
      const looksLikeSchemaBug =
        res.status === 500 && /Database error querying schema/i.test(JSON.stringify(body));

      throw new Error(
        `sign-in failed for ${email}: ${detail}.` +
        (looksLikeSchemaBug
          ? ` The auth.users row has NULL token columns - GoTrue scans them into non-nullable Go strings.` +
            ` See the seeded-accounts issue for the coalesce fix.`
          : ''),
      );
    }
    consecutiveOutages = 0;         // a session minted is the run of outages broken
    return {
      access_token: body.access_token as string,
      refresh_token: body.refresh_token as string,
      expires_in: body.expires_in as number,
      user: body.user,
      mintedAtMs: Date.now(),
    };
  })();
}

async function getOrMintSession(email: string, password: string): Promise<CachedSession> {
  const cached = sessionCache.get(email);
  if (cached) {
    const session = await cached;
    const ageSeconds = (Date.now() - session.mintedAtMs) / 1000;
    if (ageSeconds < session.expires_in - EXPIRY_SAFETY_MARGIN_SECONDS) return session;
  }
  const fresh = mintSession(email, password);
  sessionCache.set(email, fresh);
  return fresh;
}

/** Password grant against the dev project, reused across calls for the same
 *  email within this worker process (see #949/#1025 above). Throws loudly -
 *  a silent auth failure would make every cross-account assertion trivially
 *  "pass". */
export async function signIn(email: string, password: string): Promise<string> {
  const session = await getOrMintSession(email, password);
  return session.access_token;
}

/**
 * Sign a Playwright context in as one of the seeded accounts.
 *
 * Everything automated in this suite before 2026-08-06 tested the SIGNED-OUT
 * surface. Settings, TradeJournal, Alerts and the chat panel had been reached
 * exactly once, by hand. This helper is what makes them reachable from a spec.
 *
 * Two things make it less obvious than "log in through the form":
 *
 * 1. It seeds the session into localStorage rather than driving /login. The
 *    login form renders a Cloudflare Turnstile widget, and a spec that tries to
 *    solve it either fails or teaches someone to bypass a bot check. Minting a
 *    token and installing it is the same end state without touching Turnstile.
 *
 * 2. OnboardingGate blocks EVERY route - not just /dashboard - for a signed-in
 *    user whose profile_complete is false, so a seeded session alone still lands
 *    on the 5-step wizard and no app content renders. Both accounts now have
 *    profile_complete and tour_seen set on the dev project, but this asserts the
 *    app actually rendered rather than trusting that, because the failure looks
 *    exactly like a broken page.
 */
export async function signedInContext(
  browser: import('@playwright/test').Browser,
  who: 'a' | 'b' | 'c' | 't' | 'admin' = 'a',
  opts: { viewport?: { width: number; height: number }; theme?: 'dark' | 'light' } = {},
) {
  const creds: Record<string, [string, string]> = {
    a: [FIXTURES.aEmail, FIXTURES.aPassword],
    b: [FIXTURES.bEmail, FIXTURES.bPassword],
    c: [FIXTURES.cEmail, FIXTURES.cPassword],
    t: [FIXTURES.tEmail, FIXTURES.tPassword],
    admin: [FIXTURES.adminEmail, FIXTURES.adminPassword],
  };
  const [email, password] = creds[who];
  if (!email || !password) {
    throw new Error(
      `no credentials for account '${who}' - set E2E_USER_${who.toUpperCase()}_EMAIL and _PASSWORD. `
      + 'Throwing rather than signing in as someone else: a matrix cell that silently measured a different account would '
      + 'report a state it never reached.',
    );
  }

  const session = await getOrMintSession(email, password);

  // supabase-js v2 reads sb-<projectRef>-auth-token from localStorage.
  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 } });
  /* THEME SEEDED BEFORE THE FIRST FRAME, not clicked after it. `app/layout.tsx` runs an inline script that reads
     localStorage before hydration and stamps `data-theme`, so seeding the key means the page never renders a frame of
     the theme we are not measuring - and there is no race with a toggle. Same approach as contrast.spec.ts. */
  if (opts.theme) {
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* private mode */ } }, opts.theme);
  }
  await ctx.addInitScript(
    ([ref, s]: [string, CachedSession]) => {
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_in: s.expires_in,
        // Derived from when the session was actually MINTED, not from now -
        // a reused session from the cache is already partway through its
        // life, and computing "now + expires_in" here would tell the client
        // it has longer left than it really does.
        expires_at: Math.floor(s.mintedAtMs / 1000) + s.expires_in,
        token_type: 'bearer',
        user: s.user,
      }));
    },
    [projectRef, session] as [string, CachedSession],
  );
  return ctx;
}

/**
 * Navigate a signed-in page and assert app content actually rendered.
 *
 * Throws rather than returning a bad page. A spec that measures the onboarding
 * wizard, or Render's cold-start placeholder, reports confident numbers about
 * the wrong document - the failure mode `settle()` exists to prevent for the
 * signed-out suite, and the reason a whole audit run once reported 3,315
 * sub-24px tap targets against an unstyled page.
 */
export async function gotoSignedIn(
  page: import('@playwright/test').Page,
  path: string,
): Promise<void> {
  await gotoGuarded(page, path);
  await page.waitForTimeout(4000);

  /* WAIT OUT THE ONBOARDING *LOADING* SCREEN BEFORE JUDGING ANYTHING (2026-09-23).
   *
   * OnboardingFlow returns early on `!loaded` - a different subtree from the wizard,
   * showing "Setting up your account...". The wizard check below cannot see it, because
   * that matches the wizard's step text and this branch never renders the wizard at all.
   * On a slow dev database it outlasts the 4s above, so every signed-in spec in this
   * suite could measure that screen and report confident numbers about it: an Arena probe
   * did exactly that for twelve seconds and read "0 canvases" off a page that had not
   * reached the chart.
   *
   * MATCHED ON STRUCTURE, NOT COPY. The text is `ONBOARDING_FLOW_PREPARING_TITLE`, a
   * database-backed label translated into five locales, so a string match breaks the first
   * time a spec runs with a non-English preference. `.obw-loading` is the discriminator:
   * the wizard's own root is `.obw-root` WITHOUT it. (Dev Team is adding a data-testid;
   * switch to it when it lands.) */
  const LOADING = '.obw-root.obw-loading';
  await page.waitForFunction(
    (sel) => !document.querySelector(sel),
    LOADING,
    { timeout: 90_000 },
  ).catch(() => {
    throw new Error(
      `${path} is still on the onboarding LOADING screen ("Setting up your account...") after 90s. ` +
      `The user_onboarding read has not resolved - usually the dev database being slow. ` +
      `Nothing measured here would be about ${path}; re-run when it answers.`,
    );
  });

  const state = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
      onboarding: /step\s*0?1\s*\/\s*0?5|set up your\s*profile/i.test(text),
      signedOut: /sign in to your account/i.test(text),
      placeholder: /start building on render/i.test(text),
      styled: document.styleSheets.length > 0,
      controls: document.querySelectorAll('a[href],button,input,select,textarea').length,
    };
  });

  if (state.onboarding) {
    throw new Error(
      `${path} rendered the ONBOARDING WIZARD, not the page. The account's ` +
      `profile_complete is false, so OnboardingGate is blocking every route. ` +
      `Set it on the dev project before measuring anything here.`,
    );
  }
  if (state.signedOut) throw new Error(`${path} rendered signed-out - the seeded session did not take.`);
  if (state.placeholder) throw new Error(`${path} returned Render's cold-start placeholder, not the app.`);
  if (!state.styled || state.controls < 4) {
    throw new Error(`${path} rendered without styles or controls (${state.controls}) - measurements would be meaningless.`);
  }
}
