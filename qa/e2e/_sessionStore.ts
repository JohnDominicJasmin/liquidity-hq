/**
 * A SESSION CACHE THAT SURVIVES THE PROCESS.
 *
 * WHY. `_auth.ts` already caches a minted session per email, but the cache is a `Map` in one worker
 * process, so it dies with the worker. Playwright runs `workers: 2`, and a run is one process per
 * worker plus whatever a re-run costs - so a suite pays a real `/auth/v1/token?grant_type=password`
 * per account PER WORKER, every run, against a GoTrue instance that was returning nothing at all on
 * 2026-10-30. Five E2E jobs spent 605 minutes that night and produced no result: every one was
 * cancelled at the cap while ~85 sign-ins failed at ~70s each.
 *
 * **That is an availability problem, and this reduces exposure to it rather than removing it.** A
 * run still needs ONE healthy sign-in when nothing is stored, or zero when something is. It does
 * not make the suite able to start while auth is down.
 *
 * WHAT THIS IS NOT. It is not a way around the password grant and it mints nothing itself. There is
 * no route to a session that avoids GoTrue - `admin/generate_link` is the same service,
 * `grant_type=refresh_token` is the same path, and a hand-signed token is refused by
 * `lib/authUser.ts`, which requires ES256 with a `kid` present in Supabase's own JWKS and falls
 * back to `fetchAuthUser` (another GoTrue call) for anything else. Measured, not assumed.
 *
 * THE STORED FILE IS A CREDENTIAL. An access token is a bearer token: possession is sufficient, so
 * it is at least as sensitive as the password it saves. It is therefore written under
 * `node_modules/.cache`, which is gitignored and outside anything a PR can carry; never logged,
 * never printed, never put in an artifact; and **deliberately not shared through the GitHub Actions
 * cache**, which any workflow run in the repository can read. Trading an availability problem for a
 * credential problem is not a trade worth making, so in CI this shares a session between the
 * workers of one job and no further.
 *
 * THE STALENESS RULE, AND IT IS THE REASON THIS WAS NOT DONE SOONER. `signIn`'s own comment says a
 * stale token ACROSS RUNS is the failure mode to avoid, not a stale token within one - the opposite
 * of what persistence does by default. So reuse is bounded twice: by the token's own expiry with
 * the existing safety margin, AND by a short wall-clock cap (`QA_SESSION_MAX_AGE_SECONDS`, default
 * 30 minutes) that is independent of what the token claims. A session minted before a fixture's
 * plan or profile changed is the risk the cap exists to bound.
 *
 * Everything here is PURE except the two file functions, and every environment read lives in
 * `_auth.ts`, so the policy below can be unit-tested without a browser, a network or a credential.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: unknown;
  /** When the token was MINTED, not when it was stored. A reused session is already partway
   *  through its life and the client must be told the truth about that. */
  mintedAtMs: number;
}

export interface ReusePolicy {
  /** Refresh this many seconds before real expiry, so a long test never gets a token that dies
   *  mid-request. Mirrors `_auth.ts`'s in-memory margin. */
  marginSeconds: number;
  /** A wall-clock cap on reuse, independent of the token's own lifetime. */
  maxAgeSeconds: number;
}

/** Keyed by PROJECT and email. Switching `NEXT_PUBLIC_SUPABASE_URL` between the dev project and
 *  anything else must not reuse a token minted for the other one - it would be rejected, and the
 *  failure would look like a broken account rather than a wrong key. */
export function sessionKey(supabaseUrl: string, email: string): string {
  let ref = 'unknown';
  try { ref = new URL(supabaseUrl).hostname.split('.')[0]; } catch { /* keep 'unknown' */ }
  return `${ref}:${email.trim().toLowerCase()}`;
}

/** The default location: inside `node_modules/.cache`, which is gitignored, conventional for tool
 *  caches, and wiped by `npm ci` - so in CI it is scoped to one job by construction. */
export function defaultStorePath(cwd: string): string {
  return path.join(cwd, 'node_modules', '.cache', 'qa-e2e-sessions.json');
}

export function isReusable(s: StoredSession | undefined, nowMs: number, p: ReusePolicy): boolean {
  if (!s || typeof s.access_token !== 'string' || !s.access_token) return false;
  if (typeof s.mintedAtMs !== 'number' || !Number.isFinite(s.mintedAtMs)) return false;
  /* A clock that moved backwards, or a file written by a future run, is not reusable. Reading
     `mintedAtMs` in the future would make `age` negative and pass every bound below. */
  const age = (nowMs - s.mintedAtMs) / 1000;
  if (age < 0) return false;
  if (typeof s.expires_in !== 'number' || !Number.isFinite(s.expires_in)) return false;
  return age < s.expires_in - p.marginSeconds && age < p.maxAgeSeconds;
}

/** Never throws. A missing, unreadable or corrupt store is an empty store - the caller then mints,
 *  which is the behaviour this whole module is an optimisation over. */
export function readStore(file: string): Record<string, StoredSession> {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, StoredSession>;
  } catch {
    return {};
  }
}

/**
 * Never throws, and writes ATOMICALLY: two workers minting at once must not leave half a file
 * behind that the next read would discard. Last writer wins, which is correct here - both are
 * valid sessions for the same account.
 *
 * Mode 0o600 on the file. It is a bearer token; the directory may not be private.
 */
export function writeStore(file: string, data: Record<string, StoredSession>): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    /* A cache that cannot be written is not a failure - the run mints instead. */
  }
}

/** Merge one session in without dropping another worker's concurrent write for a DIFFERENT key. */
export function putSession(file: string, key: string, s: StoredSession): void {
  const store = readStore(file);
  store[key] = s;
  writeStore(file, store);
}

/** The stored session for this key if it is still safe to reuse, else null. */
export function getSession(file: string, key: string, nowMs: number, p: ReusePolicy): StoredSession | null {
  const s = readStore(file)[key];
  return isReusable(s, nowMs, p) ? s : null;
}

/** Drop one key - used when a stored session is REJECTED by the server, so a bad entry cannot
 *  poison every later run for that account. */
export function dropSession(file: string, key: string): void {
  const store = readStore(file);
  if (!(key in store)) return;
  delete store[key];
  writeStore(file, store);
}
