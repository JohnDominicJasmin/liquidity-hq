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
