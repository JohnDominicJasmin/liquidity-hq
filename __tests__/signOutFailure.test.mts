/* #304 - "after sign out the UI still same".
 *
 * The owner reported this on liquidity-hq.com. Our sign-out handler is
 * byte-identical to the one verified working on qa, so the defect is not in
 * the click path - it is in what supabase-js does when the network misbehaves,
 * plus the fact that we threw away the error that said so.
 *
 * The first test is the load-bearing one: it drives the REAL GoTrueClient, not
 * a mock of it, so it fails if a future supabase-js bump changes the behaviour
 * this fix compensates for. That is the point - if upstream starts clearing
 * the session itself, we want to be told, not to keep carrying the workaround.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { authTokenKeys } from '../lib/authSession.ts';

const URL = 'https://abcdefghijklmnop.supabase.co';
const ANON = 'test-anon-key';

/** A structurally valid unsigned JWT - auth-js decodes the payload for expiry. */
function jwt(expSeconds: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'user-1', exp: expSeconds })}.sig`;
}

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    store: map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

function seededClient() {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const session = {
    access_token: jwt(future),
    refresh_token: 'refresh-1',
    expires_at: future,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'user-1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
  };
  // The default storageKey is derived from the project ref in the URL.
  const key = `sb-${new global.URL(URL).hostname.split('.')[0]}-auth-token`;
  const storage = memoryStorage({ [key]: JSON.stringify(session) });
  const sb = createClient(URL, ANON, {
    auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { sb, storage, key };
}

test('#304: a failed POST /logout leaves the session in storage and returns an error', async () => {
  const { sb, storage, key } = seededClient();
  const realFetch = global.fetch;
  // Exactly the condition a dropped connection produces: the logout call never
  // completes. Everything else is left alone.
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/logout')) throw new TypeError('Failed to fetch');
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    const { error } = await sb.auth.signOut();

    // Both halves of the defect, asserted separately so a partial upstream fix
    // is legible rather than silently flipping the whole test.
    assert.ok(error, 'signOut must report the failure - discarding this was the bug');
    assert.ok(
      storage.store.has(key),
      'session should still be in storage: GoTrueClient skips _removeSession() when the ' +
      'logout call fails with anything other than 401/403/404',
    );
  } finally {
    global.fetch = realFetch;
  }
});

test('#304: authTokenKeys finds the session key the fix has to clear', () => {
  const { storage, key } = seededClient();
  const found = authTokenKeys([...storage.store.keys()]);
  assert.deepEqual(found, [key]);
});

test('authTokenKeys matches any project ref, and chunked sessions, and nothing else', () => {
  const keys = [
    'sb-wdtjhrilakoitfcezxpx-auth-token',      // dev
    'sb-qdpwhnvmhqgzijuwopso-auth-token',      // prod - a different ref
    'sb-wdtjhrilakoitfcezxpx-auth-token.0',    // chunked
    'sb-wdtjhrilakoitfcezxpx-auth-token.1',
    'sb-wdtjhrilakoitfcezxpx-code-verifier',   // not the session
    'lhq_last_active',                          // ours
    'theme',
  ];
  assert.deepEqual(authTokenKeys(keys), [
    'sb-wdtjhrilakoitfcezxpx-auth-token',
    'sb-qdpwhnvmhqgzijuwopso-auth-token',
    'sb-wdtjhrilakoitfcezxpx-auth-token.0',
    'sb-wdtjhrilakoitfcezxpx-auth-token.1',
  ]);
});
