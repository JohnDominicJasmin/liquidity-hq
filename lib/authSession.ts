/* Locating the stored Supabase session, so a failed sign-out can still drop it.
 *
 * We never pass a custom `storageKey` to createClient (lib/supabase.ts), so
 * supabase-js uses its default: `sb-<project-ref>-auth-token`. The project ref
 * differs per environment - dev, qa and prod are three different Supabase
 * projects - so the name cannot be hardcoded, and matching by shape is what is
 * left. Chunked sessions (`...-auth-token.0`, `.1`) match too, which is the
 * reason for `includes` rather than `endsWith`.
 *
 * Why this exists at all: see the note on signOut() in AuthProvider (#304).
 * GoTrueClient only clears the session once its POST /logout returns, so a
 * network failure leaves the user signed in with no error surfaced.
 */
export function authTokenKeys(keys: readonly string[]): string[] {
  return keys.filter(k => k.startsWith('sb-') && k.includes('-auth-token'));
}

/* One sign-out that survives a failed logout call, for EVERY caller (#304).
 *
 * The first pass at #304 fixed AuthProvider.signOut and nothing else, which QA
 * caught. Three other places called `sb.auth.signOut()` directly and kept the
 * original defect:
 *
 *   app/ops/layout.tsx     the ops console sign-out (two buttons)
 *   AuthProvider           the >7-day inactivity expiry
 *   AuthProvider           BAN ENFORCEMENT
 *
 * The last one is why this is a shared function rather than three copies of a
 * try/catch. Ban enforcement is a security control: a banned user whose logout
 * request happens to fail stays signed in, and nothing reports it. The failure
 * is silent by construction, so it would not have surfaced until someone
 * noticed a banned account still using the app.
 *
 * Not exported as "clear the session" - exported as the ONLY way to sign out,
 * so a future call site cannot reintroduce this by doing the obvious thing.
 */

type SignOutCapable = {
  auth: { signOut: () => Promise<{ error: unknown }> };
};

/** Drop any Supabase session this origin has stored. Never throws. */
export function clearStoredSession(): void {
  try {
    authTokenKeys(Object.keys(localStorage)).forEach(k => localStorage.removeItem(k));
  } catch {
    // Storage can throw (private mode, quota). Callers navigate regardless -
    // do not let this abort whatever cleanup follows.
  }
}

/* How long the network signOut() call may take before this gives up and
 * clears locally anyway (#1149). qa/e2e/signout-resilience.spec.ts already
 * covered a FAILED request (500, aborted connection) - both reject quickly,
 * so the try/catch below always caught them and this function always
 * settled. What it never covered, because Playwright's route interception
 * has no way to express it, is a request that neither resolves nor rejects
 * at all: the owner's report ("clicked Sign Out, nothing happened") turned
 * out to be exactly that - not dead, just outstanding for minutes with the
 * page giving no indication anything was in flight. An unbounded `await`
 * here waits on that promise forever; the button, the drawer, and the hard
 * navigation after it all never run.
 *
 * Same reasoning and the same value as AuthProvider's SESSION_RESOLVE_MS:
 * generous enough that a slow-but-working network still gets the real
 * server-side sign-out, short enough that a hang does not look like a
 * broken button. A ceiling on a failure, not a target - the normal path
 * settles in well under this. */
const SIGN_OUT_TIMEOUT_MS = 8000;

/**
 * Sign out, and guarantee the local session is gone even if the server call
 * fails, rejects, or never answers at all.
 *
 * Returns the error rather than swallowing it, so a caller that wants to report
 * or log the failure can - but the local cleanup has already happened either
 * way, because that is the part that must not be optional. A timeout is
 * reported the same way a real error is: the caller's contract is already
 * "truthy return means clean up locally", and a hang is exactly the case
 * that contract exists for.
 *
 * Still calls the server first, deliberately. Clearing locally without asking
 * would leave a live refresh token on the server on every sign-out, which is
 * strictly worse than the bug being fixed - and is precisely the shortcut QA's
 * healthy-path control in qa/e2e/signout-resilience.spec.ts exists to catch.
 * A hung request is not abandoned either - only this function stops waiting
 * on it; whatever eventually happens on the wire happens regardless.
 */
export async function forceSignOut(sb: SignOutCapable | null | undefined): Promise<unknown> {
  if (!sb) return null;
  let error: unknown = null;
  // The timeout timer is never cleared when signOut() itself resolves first,
  // which keeps a plain `node --test` process alive until it fires (QA
  // found this the same way as lib/rateLimit.ts's sweep interval). Clearing
  // it here is a no-op if it already fired, and harmless if it never does.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      sb.auth.signOut(),
      new Promise<{ error: unknown }>(resolve => {
        timer = setTimeout(() => resolve({ error: new Error('signOut timed out') }), SIGN_OUT_TIMEOUT_MS);
      }),
    ]);
    error = result.error;
  } catch (e) {
    error = e ?? new Error('signOut rejected');
  } finally {
    clearTimeout(timer);
  }
  if (error) clearStoredSession();
  return error;
}
