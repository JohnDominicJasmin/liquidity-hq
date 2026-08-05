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
} as const;

/** Everything the authenticated specs need, or they must skip rather than pass. */
export const AUTH_READY =
  !!(SUPABASE_URL && SUPABASE_ANON &&
     FIXTURES.aEmail && FIXTURES.aPassword && FIXTURES.bEmail && FIXTURES.bPassword &&
     FIXTURES.tradeId && FIXTURES.hypothesisId && FIXTURES.priceAlertId);

export const AUTH_SKIP_REASON =
  'authenticated fixtures absent - set E2E_USER_A_* / E2E_USER_B_* / E2E_A_*_ID ' +
  '(see the issue "QA unblocked: two seeded test accounts"). Skipping rather than ' +
  'passing: a BOLA test that runs without fixtures proves nothing.';

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
