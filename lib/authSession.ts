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

/**
 * Sign out, and guarantee the local session is gone even if the server call
 * fails or rejects.
 *
 * Returns the error rather than swallowing it, so a caller that wants to report
 * or log the failure can - but the local cleanup has already happened either
 * way, because that is the part that must not be optional.
 *
 * Still calls the server first, deliberately. Clearing locally without asking
 * would leave a live refresh token on the server on every sign-out, which is
 * strictly worse than the bug being fixed - and is precisely the shortcut QA's
 * healthy-path control in qa/e2e/signout-resilience.spec.ts exists to catch.
 */
export async function forceSignOut(sb: SignOutCapable | null | undefined): Promise<unknown> {
  let error: unknown = null;
  try {
    ({ error } = (await sb?.auth.signOut()) ?? { error: null });
  } catch (e) {
    error = e ?? new Error('signOut rejected');
  }
  if (error) clearStoredSession();
  return error;
}
