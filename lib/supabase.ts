import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  // REVERTED 2026-07-20: tried flowType: 'pkce' to keep OAuth tokens out of the
  // URL/browser history. Broke real mobile logins in prod within hours:
  // "PKCE code verifier not found in storage" - the code_verifier PKCE stashes
  // in localStorage doesn't survive if the OAuth hop lands in a different
  // browser/storage context than it started in (PWA-installed shortcut vs.
  // regular tab, Brave routing the Google step through a different profile,
  // etc.) - a known, fairly common PKCE-on-mobile failure mode, not a fluke.
  // This app has no server session (see lib/admin-auth.ts), so the textbook
  // fix (@supabase/ssr, cookie-backed verifier) would mean a much bigger
  // auth-architecture change, not a config flag. Back to the default implicit
  // flow, which has zero storage-continuity requirement across the OAuth hop -
  // reliability over the token-in-URL hardening for now. If PKCE is revisited,
  // it needs real multi-browser mobile testing before going anywhere near prod
  // again, not just a local dev-machine smoke test.
  if (!_client) _client = createClient(url, key);
  return _client;
}

/* How long getSession() may take before this gives up and reports "no
 * token" (#1165). Same value and reasoning as AuthProvider's
 * SESSION_RESOLVE_MS / lib/authSession.ts's SIGN_OUT_TIMEOUT_MS: generous
 * enough that a slow-but-working auth backend still returns the real
 * token, short enough that a hang does not stall whatever called this.
 *
 * getSession() can hang rather than reject when the backend it talks to
 * degrades - AuthProvider's own comment on #727 documents supabase-js
 * trying to refresh an expired token on read and never settling either
 * way. That bound only ever protected AuthProvider's own call; every
 * caller of THIS function had none, three separate times (see below).
 *
 * Falling back to "no token" on timeout is not a new failure mode - this
 * function's whole contract is already optional (its own doc comment
 * above), and every caller already handles a missing token by omitting
 * the Authorization header. A slow answer and a missing session look
 * identical to the caller either way; this just guarantees an answer
 * arrives. */
const AUTH_TOKEN_TIMEOUT_MS = 8000;

// Current session's access token, if any - for attaching an optional
// Authorization header to unauthenticated-allowed routes (cmc, econ-calendar)
// so a signed-in caller is attributable, without requiring auth to use them.
//
// The ONE place this reads getSession() - app/alerts/page.tsx and
// components/GrokChat.tsx each carried their own copy of this exact
// function until #1165, the same "one caller gets a fix, the others keep
// the defect" shape lib/authSession.ts's forceSignOut doc comment already
// describes for sign-out. Both now import this one instead.
export async function getAuthToken(): Promise<string | undefined> {
  const sb = getSupabase();
  if (!sb) return undefined;
  // The timeout timer is never cleared when getSession() itself resolves
  // first, which keeps a plain `node --test` process alive until it fires
  // (same shape as lib/rateLimit.ts's sweep interval and
  // lib/authSession.ts's forceSignOut, both QA found the same way).
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { data } = await Promise.race([
      sb.auth.getSession(),
      new Promise<{ data: { session: null }; error: null }>(resolve => {
        timer = setTimeout(() => resolve({ data: { session: null }, error: null }), AUTH_TOKEN_TIMEOUT_MS);
      }),
    ]);
    return data.session?.access_token;
  } finally {
    clearTimeout(timer);
  }
}

export interface Signal {
  id?: number;
  coin: string;
  signal: string;
  confidence: number;
  entry_zone: string;
  reasoning: string;
  session: string;
  result?: string;   // 'win' | 'loss' | 'pending' | undefined
  created_at?: string;
}
