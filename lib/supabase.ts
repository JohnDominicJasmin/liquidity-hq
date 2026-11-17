import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/* Longest any one request to Supabase may take before it is abandoned and the
 * caller sees an ordinary network error (no stuck-forever loading, OWNER-RULES
 * 21). supabase-js has no timeout of its own, so every browser read of a table
 * could wait until the browser gave up. Generous enough for a slow but working
 * database; shorter than the 22 s entitlements budget so a retry still fits. */
export const SUPABASE_FETCH_TIMEOUT_MS = 15000;
/** The most a read may take from start to the last byte of its body (the 15 s above only covers the answer starting). */
export const SUPABASE_BODY_TIMEOUT_MS = 60000;

/** fetch with a deadline that still honours the caller's own abort signal.
 *  ONLY READS (GET/HEAD) are abandoned: a write that reaches the database but is slow to answer must not be aborted client-side, or the UI would report a failure for a row that exists and a retry would duplicate it (a journal trade, a settings save). Writes, storage uploads and auth calls keep the platform's own behaviour. */
export function fetchWithDeadline(input: RequestInfo | URL, init?: RequestInit, ms = SUPABASE_FETCH_TIMEOUT_MS): Promise<Response> {
  const method = (init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return fetch(input, init);
  /* THE 15 s IS FOR THE ANSWER TO START, NOT FOR THE WHOLE BODY. AbortSignal.timeout(ms) also cuts a body that is still arriving, so a big read (a long history, a large list) on a slow phone failed with a false error
   * while data was flowing. Now: no response headers within `ms` aborts as before (the owner rule: nothing waits forever); once they arrive the body gets until SUPABASE_BODY_TIMEOUT_MS from the start, still finite. */
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
  const own = init?.signal;
  if (own) {
    if (own.aborted) ctl.abort(own.reason);
    else own.addEventListener('abort', () => ctl.abort(own.reason), { once: true });
  }
  const startedAt = Date.now();
  return fetch(input, { ...init, signal: ctl.signal }).then(res => {
    clearTimeout(timer);
    const left = Math.max(0, SUPABASE_BODY_TIMEOUT_MS - (Date.now() - startedAt));
    const bodyTimer = setTimeout(() => ctl.abort(new DOMException('The operation timed out.', 'TimeoutError')), left);
    /* Aborting after the body has finished is a no-op, so the timer needs no completion tracking; it only cuts a body that is still arriving at the cap. */
    ctl.signal.addEventListener('abort', () => clearTimeout(bodyTimer), { once: true });
    return res;
  }, e => { clearTimeout(timer); throw e; });
}

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
  if (!_client) _client = createClient(url, key, { global: { fetch: fetchWithDeadline } });
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
