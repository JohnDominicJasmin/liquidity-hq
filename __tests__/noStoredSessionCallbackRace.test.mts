import test from 'node:test';
import assert from 'node:assert/strict';

/* PR #2578 - FINDING TEST: the sign-in callback window.
 *
 * app/(main)/auth/callback/page.tsx, on an implicit-flow return (magic link, Google), starts supabase-js (which reads the tokens from the hash) and
 * IMMEDIATELY calls router.push(dest). supabase-js then makes a network call (GET /auth/v1/user) BEFORE it writes the session key to localStorage.
 * Once the router has changed the URL the hash is gone, and until that call answers there is NO key and NO callback in the address bar:
 * noStoredSession() is true for a user who is, a moment later, signed in.
 *
 * What it uses: the REAL supabase-js client (via getSupabase()), a stub window/localStorage/location and a stub fetch whose /auth/v1/user answer
 * is held by a gate. NO network. The page code's router.push is modelled by clearing location.hash, which is all it does to the URL.
 *
 * EXPECTED (the behaviour before the PR, and what a signed-in user needs): getAuthToken() called in that window returns the real access token,
 * because it queues behind supabase-js's own initialisation. ON THE PR it returns undefined at once. */

const store = new Map<string, string>();
const loc = { hash: '#access_token=AT-REAL&refresh_token=RT-REAL&expires_in=3600&token_type=bearer&type=magiclink', search: '?next=%2Farena', pathname: '/auth/callback' } as {
  hash: string; search: string; pathname: string; href?: string;
};
Object.defineProperty(loc, 'href', { get() { return `https://app.test${loc.pathname}${loc.search}${loc.hash}`; } });
const ls = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
const g = globalThis as Record<string, unknown>;
g.window = { location: loc, localStorage: ls, document: {}, addEventListener() {}, removeEventListener() {}, history: { state: null, replaceState() {} } };
g.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
Object.defineProperty(g, 'localStorage', { value: ls, configurable: true });
Object.defineProperty(g, 'BroadcastChannel', { value: undefined, configurable: true });

let releaseUser!: () => void;
const userGate = new Promise<void>(r => { releaseUser = r; });
const calls: string[] = [];
const USER = { id: 'u1', aud: 'authenticated', email: 'a@b.c', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
g.fetch = async (input: RequestInfo | URL) => {
  const u = String(input instanceof Request ? input.url : input);
  calls.push(u);
  if (u.includes('/auth/v1/user')) { await userGate; return new Response(JSON.stringify(USER), { status: 200, headers: { 'content-type': 'application/json' } }); }
  return new Response('{}', { status: 404 });
};

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'qa-stub-anon-key';
const mod = await import('../lib/supabase.ts') as { getSupabase: () => { auth: { getSession: () => Promise<{ data: { session: { access_token: string } | null } }>; stopAutoRefresh: () => Promise<void> } } | null; getAuthToken: () => Promise<string | undefined>; noStoredSession?: () => boolean };

test('callback window: while supabase-js is still validating the hash tokens and the URL has lost its hash, getAuthToken() must still return the real token', async (t) => {
  const sb = mod.getSupabase()!;
  t.after(() => { void sb.auth.stopAutoRefresh(); });
  await new Promise(r => setTimeout(r, 20));                       // let _initialize parse the hash and start GET /auth/v1/user
  assert.ok(calls.some(c => c.includes('/auth/v1/user')), 'harness check: supabase-js did not start validating the hash tokens - the callback was not detected');
  assert.equal(store.size, 0, 'harness check: the session must not be stored yet (the user call is held)');

  loc.hash = '';                                                    // router.push('/arena'): the new URL has no hash

  if (typeof mod.noStoredSession === 'function') {
    t.diagnostic('in the window noStoredSession() = ' + mod.noStoredSession() + ' (true = reads signed out with no key and no callback in the URL)');
  }
  const pending = mod.getAuthToken();
  const early = await Promise.race([pending, new Promise<'still waiting'>(r => setTimeout(() => r('still waiting'), 50))]);
  releaseUser();
  const finalToken = await Promise.race([pending, new Promise<string>(r => setTimeout(() => r('TIMEOUT'), 2000))]);

  const session = await sb.auth.getSession();
  assert.equal(session.data.session?.access_token, 'AT-REAL', 'harness check: the real client DID sign this user in once the user call answered');
  assert.ok([...store.keys()].some(k => k === 'sb-abcdefgh-auth-token'), 'harness check: the session is now stored under the key noStoredSession() reads');

  assert.equal(finalToken, 'AT-REAL',
    `getAuthToken() called during the callback returned ${JSON.stringify(early)} (then ${JSON.stringify(finalToken)}) for a user who was signed in ${'<'}1 s later - a token-gated read sent in that window goes out anonymous`);
});
