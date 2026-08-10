import fs from 'node:fs';
import path from 'node:path';

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

/** Password grant against the dev project. Throws loudly - a silent auth failure
 *  would make every cross-account assertion trivially "pass". */
export async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(
      `sign-in failed for ${email}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}. ` +
      `If this is 500 "Database error querying schema", the auth.users row has NULL ` +
      `token columns - GoTrue scans them into non-nullable Go strings. See the ` +
      `seeded-accounts issue for the coalesce fix.`,
    );
  }
  return body.access_token as string;
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
  who: 'a' | 'b' = 'a',
  opts: { viewport?: { width: number; height: number } } = {},
) {
  const email = who === 'a' ? FIXTURES.aEmail : FIXTURES.bEmail;
  const password = who === 'a' ? FIXTURES.aPassword : FIXTURES.bPassword;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await res.json().catch(() => ({}));
  if (!session.access_token) {
    throw new Error(`signedInContext: sign-in failed for ${email}: HTTP ${res.status}`);
  }

  // supabase-js v2 reads sb-<projectRef>-auth-token from localStorage.
  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 } });
  await ctx.addInitScript(
    ([ref, s]: [string, Record<string, unknown>]) => {
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_in: s.expires_in,
        expires_at: Math.floor(Date.now() / 1000) + (s.expires_in as number),
        token_type: 'bearer',
        user: s.user,
      }));
    },
    [projectRef, session] as [string, Record<string, unknown>],
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
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

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
