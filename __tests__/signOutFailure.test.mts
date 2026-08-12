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

/* Which of the two failure modes actually happens, measured (QA's #318 point).
 *
 * QA's spec drives two: a 500 from the server, and an aborted request. They
 * reasoned the abort would REJECT, which would slip past a handler that only
 * inspects a resolved `{ error }`. That would have been a real gap, so it is
 * worth pinning rather than reasoning about - both resolve.
 */
test('#304: network failure and abort both RESOLVE with an error, they do not reject', async () => {
  for (const thrown of [
    new TypeError('Failed to fetch'),
    Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }),
  ]) {
    const { sb, storage, key } = seededClient();
    const realFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/logout')) throw thrown;
      return realFetch(input, init);
    }) as typeof fetch;

    try {
      const settled = await sb.auth.signOut().then(
        r => ({ rejected: false as const, error: r.error }),
        e => ({ rejected: true as const, error: e }),
      );
      assert.equal(settled.rejected, false, `${thrown.name} rejected instead of resolving`);
      assert.ok(settled.error, `${thrown.name} resolved with no error`);
      assert.equal((settled.error as Error).constructor.name, 'AuthRetryableFetchError');
      assert.ok(storage.store.has(key), `${thrown.name}: session should have survived`);
    } finally {
      global.fetch = realFetch;
    }
  }
});

test('#304: a 500 from the logout endpoint also leaves the session behind', async () => {
  // The other half of QA's spec. 401/403/404 are treated as "already gone" and
  // DO clear; 500 is not in that list, so it takes the early return.
  const { sb, storage, key } = seededClient();
  const realFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/logout')) {
      return new Response(JSON.stringify({ message: 'boom' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    const { error } = await sb.auth.signOut();
    assert.ok(error, '500 must surface as an error');
    assert.ok(storage.store.has(key), '500: session should have survived');
  } finally {
    global.fetch = realFetch;
  }
});

/* ── the follow-up QA caught: every OTHER caller had the same defect ────────
 *
 * The first fix changed AuthProvider.signOut and nothing else. Three sites
 * still called sb.auth.signOut() directly - the ops console, the >7-day
 * inactivity expiry, and ban enforcement. All three kept the original bug.
 *
 * "Sweep the whole area, not the one symptom" is the rule I missed, so this
 * pins the sweep rather than trusting the next edit to remember it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { forceSignOut, clearStoredSession } from '../lib/authSession.ts';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}

test('lib/authSession.ts is the only place that calls auth.signOut() directly', () => {
  const offenders = ['app', 'components', 'lib']
    .flatMap(d => sourceFiles(d))
    .filter(f => !f.endsWith(join('lib', 'authSession.ts')))
    .filter(f => /\bauth\s*\.\s*signOut\s*\(/.test(
      // Strip comments first - several files DISCUSS auth.signOut in prose.
      readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
    ));
  assert.deepEqual(offenders, [],
    'these bypass forceSignOut and will not clear the session when logout fails');
});

test('forceSignOut clears the stored session when the call fails', async () => {
  const removed: string[] = [];
  const keys = ['sb-abcdefghijklmnop-auth-token', 'theme'];
  (globalThis as { localStorage?: unknown }).localStorage = {
    removeItem: (k: string) => { removed.push(k); },
    ...Object.fromEntries(keys.map((k, i) => [i, k])),
    length: keys.length,
  };
  Object.defineProperty(globalThis.localStorage, 'length', { value: keys.length });
  Object.keys = ((o: object) => (o === globalThis.localStorage ? keys : Reflect.ownKeys(o))) as typeof Object.keys;

  const err = await forceSignOut({ auth: { signOut: async () => ({ error: new Error('offline') }) } });
  assert.ok(err, 'the error is returned, not swallowed');
  assert.deepEqual(removed, ['sb-abcdefghijklmnop-auth-token'], 'only the session key');
});

test('forceSignOut leaves storage alone when the call succeeds', async () => {
  const removed: string[] = [];
  (globalThis as { localStorage?: unknown }).localStorage = {
    removeItem: (k: string) => { removed.push(k); },
  };
  const err = await forceSignOut({ auth: { signOut: async () => ({ error: null }) } });
  assert.equal(err, null);
  assert.deepEqual(removed, [], 'a healthy sign-out needs no local surgery');
});

test('forceSignOut turns a REJECTION into the same cleanup, not an escape', async () => {
  let cleared = false;
  (globalThis as { localStorage?: unknown }).localStorage = {
    removeItem: () => { cleared = true; },
  };
  Object.keys = ((o: object) => (o === globalThis.localStorage ? ['sb-x-auth-token'] : Reflect.ownKeys(o))) as typeof Object.keys;
  const err = await forceSignOut({ auth: { signOut: async () => { throw new Error('boom'); } } });
  assert.ok(err instanceof Error);
  assert.equal(cleared, true, 'a rejection must not skip the cleanup or the caller navigation');
});

test('forceSignOut tolerates a null client', async () => {
  assert.equal(await forceSignOut(null), null);
  assert.equal(await forceSignOut(undefined), null);
});

test('clearStoredSession never throws, even when storage does', () => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    removeItem: () => { throw new Error('quota'); },
  };
  Object.keys = ((o: object) => (o === globalThis.localStorage ? ['sb-x-auth-token'] : Reflect.ownKeys(o))) as typeof Object.keys;
  assert.doesNotThrow(() => clearStoredSession());
});
