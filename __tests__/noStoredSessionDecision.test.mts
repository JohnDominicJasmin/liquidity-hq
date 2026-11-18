import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

/* PR #2578 - THE SIGN-IN SHORTCUT: noStoredSession() in lib/supabase.ts, used by AuthProvider (loading=false at mount) and getAuthToken().
 *
 * WHAT THIS PROVES: the decision function, as a table, on every input that decides it (storage key, sign-in callback in the hash or the query,
 * storage that throws, no window, bad env), AND that the key it looks for is the one the real supabase-js client uses for several URL shapes.
 * WHAT IT DOES NOT PROVE: that no signed-in user ever hits the shortcut in a browser (see noStoredSessionCallbackRace.test.mts for the one window found). */

const URL_ENV = 'https://abcdefgh.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_ENV;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'qa-stub-anon-key';
const mod = await import('../lib/supabase.ts');
const noStoredSession = (mod as { noStoredSession?: () => boolean }).noStoredSession;
const KEY = 'sb-abcdefgh-auth-token';

type Env = { store?: Record<string, string>; hash?: string; search?: string; throwGet?: boolean; throwWindowStorage?: boolean; noWindow?: boolean };
function run(e: Env, url = URL_ENV): boolean {
  const g = globalThis as Record<string, unknown>;
  const prevWin = g.window; const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    if (url === '') delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    if (e.noWindow) delete g.window;
    else {
      const store = e.store ?? {};
      const ls = { getItem: (k: string) => { if (e.throwGet) throw new Error('SecurityError'); return k in store ? store[k] : null; } };
      const win: Record<string, unknown> = { location: { hash: e.hash ?? '', search: e.search ?? '' } };
      if (e.throwWindowStorage) Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError: denied'); } });
      else win.localStorage = ls;
      g.window = win;
    }
    return noStoredSession!();
  } finally {
    if (prevWin === undefined) delete g.window; else g.window = prevWin;
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  }
}

test('noStoredSession is exported', () => { assert.equal(typeof noStoredSession, 'function'); });

/* [case, env, expected]. true = "signed out at once"; false = "take the normal path (ask the auth client)". */
const SESSION = { [KEY]: '{"access_token":"a","refresh_token":"r","expires_at":1}' };
const TABLE: Array<[string, Env, boolean]> = [
  ['no key, clean URL = signed out at once', {}, true],
  ['no key, an unrelated query and hash = signed out at once', { search: '?next=/arena&utm=x', hash: '#top' }, true],
  ['the usual key present = normal check', { store: SESSION }, false],
  ['the usual key present, EXPIRED access token (refresh token valid) = normal check (a stored session is a stored session)', { store: { [KEY]: '{"access_token":"a","refresh_token":"r","expires_at":1}' } }, false],
  ['key present but EMPTY string = normal check (only null counts as absent)', { store: { [KEY]: '' } }, false],
  ['implicit callback: hash access_token = normal check', { hash: '#access_token=a&refresh_token=r&expires_in=3600&token_type=bearer' }, false],
  ['implicit callback type=recovery = normal check', { hash: '#access_token=a&refresh_token=r&type=recovery' }, false],
  ['implicit callback type=signup = normal check', { hash: '#access_token=a&refresh_token=r&type=signup' }, false],
  ['implicit callback type=magiclink = normal check', { hash: '#access_token=a&refresh_token=r&type=magiclink' }, false],
  ['implicit callback type=invite = normal check', { hash: '#access_token=a&refresh_token=r&type=invite' }, false],
  ['hash refresh_token only = normal check', { hash: '#refresh_token=r' }, false],
  ['hash error (denied OAuth) = normal check', { hash: '#error=access_denied&error_code=bad&error_description=x' }, false],
  ['hash error_description only = normal check', { hash: '#error_description=x' }, false],
  ['PKCE callback ?code= = normal check', { search: '?code=abc' }, false],
  ['PKCE callback with other params first = normal check', { search: '?next=/arena&code=abc' }, false],
  ['query ?error= = normal check', { search: '?error=access_denied' }, false],
  ['key present AND callback = normal check', { store: SESSION, hash: '#access_token=a' }, false],
  ['storage getItem throws = normal check (uncertain answers false)', { throwGet: true }, false],
  ['window.localStorage getter throws (blocked site data) = normal check', { throwWindowStorage: true }, false],
  ['no window (server) = normal check', { noWindow: true }, false],
];
for (const [name, env, want] of TABLE) {
  test(`decision: ${name}`, () => { assert.equal(run(env), want); });
}
test('decision: env URL missing = normal check', () => { assert.equal(run({}, ''), false); });
test('decision: env URL not parsable = normal check (the try/catch answers false)', () => { assert.equal(run({}, 'not a url'), false); });

/* The key must be the one the REAL client uses. Compare against supabase-js's own storageKey, for the URL shapes this app can be built with. */
const SHAPES = [
  'https://abcdefgh.supabase.co', 'https://abcdefgh.supabase.co/', 'https://ABCDEFGH.supabase.co', 'https://abcdefgh.supabase.co:443',
  'https://auth.example.com', 'http://127.0.0.1:54321', 'http://localhost:54321', 'https://wdtjhrilakoitfcezxpx.supabase.co',
];
for (const url of SHAPES) {
  test(`key matches the real supabase-js client for ${url}`, () => {
    const real = createClient(url, 'qa-stub-anon-key', { auth: { persistSession: false, autoRefreshToken: false } });
    const realKey = (real.auth as unknown as { storageKey: string }).storageKey;
    assert.match(realKey, /^sb-.+-auth-token$/);
    assert.equal(run({ store: { [realKey]: '{}' } }, url), false, `a session stored under the real client's key ${realKey} was NOT seen by noStoredSession`);
    assert.equal(run({ store: { 'sb-other-auth-token': '{}' } }, url), true, 'a different key must not count');
  });
}

/* Source pins: the shortcut is only sound while the app's client keeps supabase-js's default storage. */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
test('PIN: getSupabase() passes no storageKey / storage / persistSession / flowType (the shortcut reads the DEFAULT key from localStorage)', () => {
  const src = read('lib/supabase.ts');
  const m = /createClient\(url, key, (\{[^;]*\})\)/.exec(src);
  assert.ok(m, 'the createClient(url, key, {...}) call was not found');
  assert.ok(!/storageKey|storage\s*:|persistSession|flowType|detectSessionInUrl|auth\s*:/.test(m[1]), `createClient options now carry an auth option: ${m[1]} - noStoredSession() must be re-derived`);
});
test('PIN: AuthProvider only flips `loading`, never sets a user or entitlements, from the shortcut, and the normal read still follows', () => {
  const src = read('components/AuthProvider.tsx');
  const calls = src.match(/noStoredSession\(\)/g) ?? [];
  assert.equal(calls.length, 1, 'noStoredSession() should be called exactly once in AuthProvider');
  assert.match(src, /if \(noStoredSession\(\)\) setLoading\(false\);/);
  const at = src.indexOf('if (noStoredSession()) setLoading(false);');
  const after = src.slice(at);
  assert.ok(after.indexOf('sb.auth.getSession()') > 0, 'the normal getSession() read must still run after the shortcut');
  assert.ok(after.indexOf('sb.auth.onAuthStateChange') > 0, 'onAuthStateChange must still be subscribed');
  assert.match(after, /\.finally\(\(\) => setLoading\(false\)\)/);
});
