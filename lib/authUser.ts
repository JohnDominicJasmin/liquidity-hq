/* Who does this bearer token belong to? Verified HERE, not by asking Supabase Auth on every request (#1397).
 *
 * THE LOAD THIS REMOVES. Every authenticated API route called `supabase.auth.getUser()`, which is a network round trip to Auth's /user
 * endpoint, often several times per page load (the proxy and the market routes even did it just to attribute a request in the log). Measured by
 * PM on the dev project during QA's run: 1,583 /user calls from our server in 95 minutes (p95 9.2 s, 69 5xx) and /token at p95 10.3 s with 23
 * timeouts. Supabase was green; the load was ours.
 *
 * HOW IT IS VERIFIED. Both Supabase projects sign access tokens with an asymmetric key (ES256) and publish the public half at
 * /auth/v1/.well-known/jwks.json. The signature, issuer, audience, role and expiry are checked locally with WebCrypto against that key (fetched
 * once, cached 10 minutes, re-fetched at most once a minute for an unknown key id). A verified token is cached until it expires (bounded LRU).
 * No network call per request.
 *
 * WHEN AUTH IS STILL ASKED (`getUser()` over the network, the old behaviour): a token this file cannot verify locally - not a well-formed
 * ES256 JWT, or the key set cannot be fetched. A well-formed ES256 token that FAILS verification is rejected here, not passed to Auth.
 *
 * WHAT A LOCAL CHECK CANNOT KNOW: a token stays valid until it expires (at most an hour) even if the account signed out, was banned or was
 * deleted after it was issued, and the token carries no "email confirmed" flag. Routes that need either keep calling Auth directly - see
 * `fetchAuthUser`: payments claim, admin, welcome email, Telegram status, and every route that WRITES with the service role on the strength
 * of the token alone (push subscribe/test, Telegram link code, the alert-prefs save, Lemon Squeezy cancel). Routes whose reads and writes go
 * through the user's own token are no weaker: PostgREST accepts that same token until it expires. */
import { userClient } from '@/lib/supabase-user';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { T } from '@/lib/tables';

export interface TokenUser {
  id: string;
  email: string | null;
  /** Seconds since epoch (the token's exp). */
  exp: number;
}

const JWKS_TTL_MS = 10 * 60_000;
const JWKS_REFETCH_FLOOR_MS = 60_000;
const CACHE_MAX = 5000;

type Keyset = { keys: Map<string, CryptoKey>; fetchedAt: number };
const state = ((globalThis as { __lhqAuthUser?: { jwks: Keyset | null; lastFetch: number; verified: Map<string, TokenUser> } }).__lhqAuthUser ??= {
  jwks: null, lastFetch: 0, verified: new Map(),
});

const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
  const out = new Uint8Array(new ArrayBuffer(buf.length));
  out.set(buf);
  return out;
};
const b64urlJson = (s: string): Record<string, unknown> | null => {
  try { return JSON.parse(Buffer.from(b64urlToBytes(s)).toString('utf8')); } catch { return null; }
};

function supabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
}

async function loadKeys(force: boolean): Promise<Keyset | null> {
  const now = Date.now();
  if (!force && state.jwks && now - state.jwks.fetchedAt < JWKS_TTL_MS) return state.jwks;
  if (now - state.lastFetch < JWKS_REFETCH_FLOOR_MS && state.jwks) return state.jwks;
  state.lastFetch = now;
  try {
    const r = await fetch(`${supabaseUrl()}/auth/v1/.well-known/jwks.json`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!r.ok) return state.jwks;
    const body = await r.json() as { keys?: Array<JsonWebKey & { kid?: string; alg?: string }> };
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid || jwk.alg !== 'ES256' || jwk.kty !== 'EC' || jwk.crv !== 'P-256') continue;
      keys.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
    }
    state.jwks = { keys, fetchedAt: now };
    return state.jwks;
  } catch {
    return state.jwks;
  }
}

type LocalResult = { kind: 'ok'; user: TokenUser } | { kind: 'invalid' } | { kind: 'unsupported' };

/** Verifies a Supabase access token locally. Exported for tests (pure apart from the key fetch). */
export async function verifyAccessToken(token: string, nowMs: number = Date.now()): Promise<LocalResult> {
  /* Anything that is not a well-formed ES256 token is NOT judged here: it goes to Auth, exactly as before (Auth rejects garbage itself). Only a
     real ES256 token that fails a check below is rejected locally. That keeps every existing caller and test that relies on Auth's answer. */
  const parts = token.split('.');
  if (parts.length !== 3) return { kind: 'unsupported' };
  const header = b64urlJson(parts[0]); const payload = b64urlJson(parts[1]);
  if (!header || !payload) return { kind: 'unsupported' };
  if (header.alg !== 'ES256' || typeof header.kid !== 'string') return { kind: 'unsupported' };

  let keys = await loadKeys(false);
  let key = keys?.keys.get(header.kid);
  let fresh = false;
  if (!key) { const before = state.lastFetch; keys = await loadKeys(true); fresh = state.lastFetch !== before; key = keys?.keys.get(header.kid); }
  if (!keys) return { kind: 'unsupported' };          // the key set could not be fetched at all: let Auth decide
  // A key id we do not have: if the set was just re-fetched it is not ours (invalid); if the re-fetch was skipped (at most once a minute),
  // the key may be newly rotated, so let Auth decide rather than reject a possibly valid token.
  if (!key) return fresh ? { kind: 'invalid' } : { kind: 'unsupported' };

  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return { kind: 'invalid' };

  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const aud = payload.aud; const audOk = aud === 'authenticated' || (Array.isArray(aud) && aud.includes('authenticated'));
  if (exp * 1000 <= nowMs) return { kind: 'invalid' };
  if (payload.iss !== `${supabaseUrl()}/auth/v1`) return { kind: 'invalid' };
  if (!audOk || payload.role !== 'authenticated') return { kind: 'invalid' };
  if (typeof payload.sub !== 'string' || !payload.sub) return { kind: 'invalid' };
  return { kind: 'ok', user: { id: payload.sub, email: typeof payload.email === 'string' && payload.email ? payload.email : null, exp } };
}

function remember(token: string, user: TokenUser): void {
  state.verified.delete(token);
  state.verified.set(token, user);
  while (state.verified.size > CACHE_MAX) {
    const oldest = state.verified.keys().next();
    if (oldest.done) break;
    state.verified.delete(oldest.value);
  }
}

/** Auth's own answer for a token (one network call). Use it where the token alone is not enough (see the header). */
export async function fetchAuthUser(token: string) {
  const sb = userClient(token);
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

/** The user a bearer token belongs to, or null. Verified locally and cached until the token expires; Auth is asked only for a token that
 *  cannot be verified locally (see the header). */
export async function userFromToken(token: string | null | undefined): Promise<TokenUser | null> {
  if (!token) return null;
  const now = Date.now();
  const hit = state.verified.get(token);
  if (hit) {
    if (hit.exp * 1000 > now) { remember(token, hit); return hit; }
    state.verified.delete(token);
  }
  const local = await verifyAccessToken(token, now);
  if (local.kind === 'ok') { remember(token, local.user); return local.user; }
  if (local.kind === 'invalid') return null;
  // unsupported: ask Auth (the old path), and cache a yes for at most a minute (or until the token expires, if sooner)
  const u = await fetchAuthUser(token);
  if (!u) return null;
  const payload = b64urlJson(token.split('.')[1] ?? '');
  const exp = Math.min(typeof payload?.exp === 'number' ? payload.exp : 0, Math.floor(now / 1000) + 60);
  const user: TokenUser = { id: u.id, email: u.email ?? null, exp };
  if (exp * 1000 > now) remember(token, user);
  return user;
}

/** The token from an `Authorization: Bearer ...` header. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!h) return null;
  const t = h.replace(/^Bearer\s+/i, '').trim();
  return t || null;
}

/** Counts for lib/memWatch-style diagnostics and tests. */
export function _authUserStats(): { cached: number; keys: number } {
  return { cached: state.verified.size, keys: state.jwks?.keys.size ?? 0 };
}

/** Drop-in for `supabase.auth.getUser()` at the call sites that only read the user's id or email: the same `{ data: { user } }` shape, from
 *  userFromToken (local verification, no network call for a normal token). NOT for code that needs Auth's fresh view of the account
 *  (email_confirmed_at, a ban that happened after the token was issued) - use fetchAuthUser there. */
/* A union, like supabase-js's own return type, so `if (!data.user) return` narrows `data` for the rest of the function (closures included). */
export type CompatUserResult =
  | { data: { user: { id: string; email: string | null } }; error: null }
  | { data: { user: null }; error: null };
export async function getUserCompat(token: string | null | undefined): Promise<CompatUserResult> {
  const u = await userFromToken(token);
  return u ? { data: { user: { id: u.id, email: u.email } }, error: null } : { data: { user: null }, error: null };
}

/** Whether the account is banned NOW, from the app's own ban flag: lhq_user_status.banned, which the database trigger lhq_user_status_sync
 *  sets whenever auth.users.banned_until changes (supabase/migrations/20260916_capture_user_status_ban_sync.sql; the same row AuthProvider
 *  listens to for its push sign-out). One indexed read, no Auth call. A failed read answers false: a database hiccup must not switch off
 *  every paid feature, and a banned account is still stopped at its token's expiry and by AuthProvider's sign-out. */
export async function isAccountBanned(userId: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin().from(T.user_status).select('banned').eq('user_id', userId).maybeSingle();
    if (error) return false;
    return (data as { banned?: boolean } | null)?.banned === true;
  } catch {
    return false;
  }
}

/** getUserCompat for the routes that SPEND money on the caller (every xAI call, #1397 review F2, PM's decision): a locally verified token
 *  stays valid until it expires even after a ban, so these also check the ban flag and answer "no user" for a banned account, which each
 *  route already turns into its 401. */
export async function getUserCompatForBilledCall(token: string | null | undefined): Promise<CompatUserResult> {
  const r = await getUserCompat(token);
  if (r.data.user && (await isAccountBanned(r.data.user.id))) return { data: { user: null }, error: null };
  return r;
}
