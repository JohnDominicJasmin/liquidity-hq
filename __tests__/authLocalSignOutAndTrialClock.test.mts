/* #2430: the 7-day inactivity expiry signs out THIS device only; the trial clock is taken fresh when the trial end changes.
 *   L1  forceSignOut passes scope through: {scope:'local'} -> signOut({scope:'local'}); omitted -> signOut(undefined), i.e. supabase-js's default GLOBAL (the ban path and the user's own sign-out keep that)
 *   L2  against the REAL supabase-js client: the logout request carries scope=local for the expiry, and the global call does NOT say local. This is what the PR actually changes on the wire
 *   A1  AuthProvider: the inactivity expiry passes 'local'; the ban and the manual sign-out do NOT (a ban must end every device)
 *   A2  the trial clock is set fresh in the trial-end effect, BEFORE the "already past" return (a provider mounted on /login kept an old clock and an ended trial read as active after sign-in)
 * The 2-browser scenario (profile A stale, profile B signed in stays signed in) is a browser run; L2 pins the request that decides it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { forceSignOut } from '../lib/authSession.ts';

test('L1. forceSignOut passes the scope through; omitted stays the default (global)', async () => {
  const calls: unknown[][] = [];
  const sb = { auth: { signOut: async (...a: unknown[]) => { calls.push(a); return { error: null }; } } };
  await forceSignOut(sb, { scope: 'local' });
  await forceSignOut(sb);
  await forceSignOut(sb, {});
  assert.deepEqual(calls[0], [{ scope: 'local' }], 'the inactivity expiry did not ask for a LOCAL sign-out');
  assert.deepEqual(calls[1], [undefined], 'an unscoped sign-out stopped being the default (global): a ban would no longer end every device');
  assert.deepEqual(calls[2], [undefined]);
});

const URL_ = 'https://abcdefghijklmnop.supabase.co';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp: number) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'user-1', exp })}.sig`;
function seeded() {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: jwt(future), refresh_token: 'r1', expires_at: future, expires_in: 3600, token_type: 'bearer', user: { id: 'user-1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' } };
  const map = new Map<string, string>([[`sb-${new URL(URL_).hostname.split('.')[0]}-auth-token`, JSON.stringify(session)]]);
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
  return createClient(URL_, 'anon', { auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
}
test('L2. on the wire: forceSignOut(sb, {scope:"local"}) sends /logout?scope=local; forceSignOut(sb) does not', async () => {
  const realFetch = globalThis.fetch; const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => { const u = String(input instanceof Request ? input.url : input); if (u.includes('/logout')) { urls.push(u); return new Response(null, { status: 204 }); } throw new Error('stray request ' + u); }) as typeof fetch;
  try {
    await forceSignOut(seeded(), { scope: 'local' });
    await forceSignOut(seeded());
  } finally { globalThis.fetch = realFetch; }
  assert.equal(urls.length, 2, 'CONTROL: both sign-outs must reach /logout: ' + JSON.stringify(urls));
  assert.match(urls[0], /scope=local/, 'the expiry revoked every device (no scope=local on the logout request)');
  assert.doesNotMatch(urls[1], /scope=local/, 'the default sign-out became local: a ban or the user\'s own sign-out would leave other devices signed in');
});

const AUTH = readFileSync(new URL('../components/AuthProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const stripped = AUTH.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
test('A1. only the inactivity expiry signs out locally; the ban and the manual sign-out stay global', () => {
  assert.equal(stripped.split("forceSignOut(sb, { scope: 'local' })").length - 1, 1, 'the expiry must be the one local sign-out');
  assert.ok(stripped.includes('void forceSignOut(sb);'), 'the ban path lost its global sign-out (it must end every device)');
  assert.ok(stripped.includes('if (await forceSignOut(sb)) {'), 'the manual sign-out is no longer global');
  const at = stripped.indexOf("forceSignOut(sb, { scope: 'local' })");
  assert.ok(/isSessionExpired|LAST_ACTIVE|expired/i.test(stripped.slice(Math.max(0, at - 900), at + 200)), 'the local sign-out is not in the inactivity-expiry path');
});
test('A2. the trial clock is set fresh in the trial-end effect, before the already-past return; the effect depends on trialEndsAt', () => {
  const at = stripped.indexOf('useEffect(() => {\n    if (trialEndsAt === null) return;');
  assert.ok(at > 0, 'CONTROL: the trial-end effect was not found');
  const eff = stripped.slice(at, stripped.indexOf('[trialEndsAt]);', at) + 15);
  assert.ok(eff.indexOf('setClock(Date.now());') > 0 && eff.indexOf('setClock(Date.now());') < eff.indexOf('if (ms <= 0) return;'), 'the clock is not refreshed before the already-past return: an ended trial keeps reading as active');
  assert.ok(eff.endsWith('[trialEndsAt]);'), 'the effect no longer re-runs when the trial end changes');
});
