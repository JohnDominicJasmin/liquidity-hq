import fs from 'node:fs';
import path from 'node:path';
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

function mintSession(email: string, password: string): Promise<CachedSession> {
  return (async () => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      // Remove the failed attempt so a transient failure doesn't poison every
      // later call for this email with a permanently-rejected cache entry.
      sessionCache.delete(email);
      throw new Error(
        `sign-in failed for ${email}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}. ` +
        `If this is 500 "Database error querying schema", the auth.users row has NULL ` +
        `token columns - GoTrue scans them into non-nullable Go strings. See the ` +
        `seeded-accounts issue for the coalesce fix.`,
      );
    }
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
  who: 'a' | 'b' | 'c' = 'a',
  opts: { viewport?: { width: number; height: number } } = {},
) {
  const email = who === 'a' ? FIXTURES.aEmail : who === 'b' ? FIXTURES.bEmail : FIXTURES.cEmail;
  const password = who === 'a' ? FIXTURES.aPassword : who === 'b' ? FIXTURES.bPassword : FIXTURES.cPassword;

  const session = await getOrMintSession(email, password);

  // supabase-js v2 reads sb-<projectRef>-auth-token from localStorage.
  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 } });
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
