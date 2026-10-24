/* #1653 (#1397): who a bearer token belongs to is decided in lib/authUser.ts by verifying its ES256 signature against the project's published key
 * set, instead of a network call to Supabase Auth on every request. Six handlers that WRITE with the service role still ask Auth.
 *
 * THE ORACLE IS INDEPENDENT: every token here is signed in this file with a P-256 key made by WebCrypto, and the stand-in key set publishes its public
 * half. Nothing is derived from lib/authUser.ts. The real routes run against an in-memory Supabase that counts every call to Auth's /user.
 *
 * WHAT THIS PINS: a good token verifies with NO call to Auth; a tampered payload, another key with the same kid, an expired token, a wrong issuer, an
 * audience other than "authenticated", role anon or service_role, and a missing sub are each REJECTED with no call to Auth; an unknown kid inside the
 * one-minute refetch floor goes to Auth, after the floor a key set that still lacks it rejects it, and a rotated key that is now published verifies;
 * a non-JWT and an HS256 token go to Auth, and an HS256 answer is cached for at most 60 s; a cached token is dropped at its exp; the cache holds at most
 * 5,000 tokens; a key-set refetch that FAILS sends a new kid to Auth instead of rejecting it (F1, fixed in #1656); settings GET asks Auth nothing,
 * push subscribe asks it exactly once and refuses a banned account at once, and both answer 401 with no token; exactly the expected routes call Auth
 * (after #1657 welcome-email and the Whop claim ask through fetchAuthUser, only when they have work); every route that spends on xAI checks the ban
 * flag (#1656, F2), the paid chat refuses a banned account with a still-valid token before any xAI call, and a failed flag read lets the call through.
 *
 * WHAT IT CANNOT PROVE: Supabase's real key set and token shape (checked live on #1653: one ES256 P-256 key per project; a real dev token is ES256 with
 * that kid, aud and role "authenticated"), Auth's real answer for a banned account (the stand-in answers 403 as Auth documents it), or that the database
 * trigger keeps the ban flag in step with Auth (checked by read-only SQL on #1656). No real credentials: the Supabase URL is a `.invalid` host. */
import test, { after, beforeEach } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { NextRequest } from 'next/server';

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
const UID = '77777777-7777-4777-8777-777777777777'; const EMAIL = 'qa@example.test';
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/* ---- keys and tokens, made here ---- */
const b64u = (b: ArrayBuffer | string) => Buffer.from(typeof b === 'string' ? b : new Uint8Array(b)).toString('base64url');
const newKey = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
const K1 = await newKey(); const K2 = await newKey();
const publicJwk = async (k: CryptoKeyPair, kid: string) => ({ ...(await crypto.subtle.exportKey('jwk', k.publicKey)), kid, alg: 'ES256', use: 'sig' });
const nowS = () => Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({ sub: UID, email: EMAIL, aud: 'authenticated', role: 'authenticated', iss: `${SUPABASE}/auth/v1`, iat: nowS(), exp: nowS() + 600, ...over });
async function sign(payload: Record<string, unknown>, key: CryptoKeyPair = K1, kid = 'kid-1') {
  const h = b64u(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' })); const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;
}
const hs256 = (payload: Record<string, unknown>) => `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64u(JSON.stringify(payload))}.${b64u('not-checked-here')}`;

/* ---- the stand-in Supabase: key set, Auth /user (counted), PostgREST ---- */
const calls = { jwks: 0, user: 0, rest: [] as { m: string; p: string; body?: unknown }[], stray: [] as string[] };
let JWKS: { keys: unknown[] } = { keys: [await publicJwk(K1, 'kid-1')] };
let jwksDown = false;
const AUTH_KNOWS = new Map<string, { id: string; email: string }>(); const BANNED = new Set<string>();
/* the app's own ban flag (lhq_user_status.banned, #1656): user ids flagged banned, and whether that read fails */
const FLAGGED = new Set<string>(); let statusReadFails = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url); if (url.origin !== SUPABASE) { calls.stray.push(url.host); throw new Error(`stray request ${req.method} ${req.url}`); }
  if (url.pathname.endsWith('user_status')) {
    calls.rest.push({ m: req.method, p: url.pathname });
    if (statusReadFails) return json(500, { code: 'XX000', message: 'status read failed (stand-in)' });
    const id = (url.searchParams.get('user_id') ?? '').replace(/^eq\./, ''); const row = { banned: FLAGGED.has(id) };
    return (req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, [row]);
  }
  if (url.pathname === '/auth/v1/.well-known/jwks.json') { calls.jwks++; return jwksDown ? new Response('down', { status: 503 }) : json(200, JWKS); }
  if (url.pathname === '/auth/v1/user') {
    calls.user++; const tok = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    if (BANNED.has(tok)) return json(403, { code: 'user_banned', message: 'User is banned' });
    const u = AUTH_KNOWS.get(tok); return u ? json(200, { ...u, aud: 'authenticated', role: 'authenticated' }) : json(401, { code: 'bad_jwt', message: 'invalid JWT' });
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const body = req.method === 'GET' ? undefined : JSON.parse((await req.text()) || 'null'); calls.rest.push({ m: req.method, p: url.pathname, body });
    if (req.method === 'GET') { const row = { user_id: UID, account_size: 10000 }; return (req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, [row]); }
    return new Response(null, { status: 201 });
  }
  throw new Error(`stand-in does not know ${req.method} ${req.url}`);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

/* #1683: THE STAND-IN MUST STILL BE INSTALLED WHEN A TEST RUNS. The after() above restores the real fetch, and a top-level
   `await import` SUSPENDS this module - so if any test group has not registered by then, the runner thinks the file is done,
   fires after(), and every later test silently talks to the real internet. That happened in aiFeedsUnknownNotEmpty: one test
   took 26 seconds, called sosovalue for real, got a 403 in the container, and the route correctly answered null - which read as
   a product defect. This guard makes the recurrence name itself instead of presenting as a wrong value. */
const standInFetch = globalThis.fetch;
beforeEach(() => {
  assert.equal(globalThis.fetch, standInFetch,
    'the fetch stand-in is not installed: this run would reach the real network, so it measures nothing about the code under test - see #1683');
});

const { userFromToken, getUserCompat, _authUserStats } = await import('../lib/authUser.ts');
type AuthState = { jwks: unknown; lastFetch: number; verified: Map<string, unknown> };
const state = () => (globalThis as unknown as { __lhqAuthUser: AuthState }).__lhqAuthUser;
const realNow = Date.now;
beforeEach(async () => {
  Date.now = realNow; jwksDown = false; JWKS = { keys: [await publicJwk(K1, 'kid-1')] }; AUTH_KNOWS.clear(); BANNED.clear(); FLAGGED.clear(); statusReadFails = false; calls.stray = [];
  const s = state(); if (s) { s.jwks = null; s.lastFetch = 0; s.verified.clear(); }
  calls.jwks = 0; calls.user = 0; calls.rest = [];
});
after(() => { Date.now = realNow; });

test('V1. a good ES256 token verifies locally: the user comes back with no call to Auth, in getUser\'s shape', async () => {
  const c = claims(); const tok = await sign(c);
  assert.deepEqual(await userFromToken(tok), { id: UID, email: EMAIL, exp: c.exp });
  assert.deepEqual(await getUserCompat(tok), { data: { user: { id: UID, email: EMAIL } }, error: null });
  assert.equal(calls.user, 0, 'Auth was asked for a token that verifies locally');
  assert.equal(calls.jwks, 1, 'the key set should be fetched once and then reused');
});

test('V2-V8. every forged or wrong token is REJECTED locally, with no call to Auth', async () => {
  const good = await sign(claims()); const [h, , s] = good.split('.');
  const cases: [string, string][] = [
    ['tampered payload (another user, same signature)', `${h}.${b64u(JSON.stringify(claims({ sub: '88888888-8888-4888-8888-888888888888' })))}.${s}`],
    ['another key with the same kid', await sign(claims(), K2, 'kid-1')],
    ['expired', await sign(claims({ exp: nowS() - 1 }))],
    ['wrong issuer', await sign(claims({ iss: 'http://evil.invalid/auth/v1' }))],
    ['audience other than authenticated', await sign(claims({ aud: 'anon' }))],
    ['role anon', await sign(claims({ role: 'anon' }))],
    ['role service_role', await sign(claims({ role: 'service_role' }))],
    ['no sub', await sign(claims({ sub: undefined }))],
  ];
  for (const [what, tok] of cases) assert.equal(await userFromToken(tok), null, `${what}: accepted`);
  assert.equal(calls.user, 0, 'a forged token was passed to Auth instead of being rejected here');
  assert.ok(await userFromToken(await sign(claims({ aud: ['authenticated', 'other'] }))), 'an audience list that includes "authenticated" should verify');
});

test('V9. an unknown kid inside the one-minute refetch floor goes to Auth (it may be a key rotated a moment ago), not rejected', async () => {
  assert.ok(await userFromToken(await sign(claims())));                       // loads the key set now
  const rotated = await sign(claims(), K2, 'kid-2'); AUTH_KNOWS.set(rotated, { id: UID, email: EMAIL });
  assert.equal((await userFromToken(rotated))?.id, UID);
  assert.equal(calls.user, 1, 'Auth should decide a kid the cached key set does not have yet');
  assert.equal(calls.jwks, 1, 'the key set was re-fetched inside the one-minute floor');
});

test('V10-V11. after the floor the key set is re-fetched: a kid it still lacks is rejected locally; a rotated key it now publishes verifies', async () => {
  assert.ok(await userFromToken(await sign(claims())));
  state().lastFetch -= 61_000;
  assert.equal(await userFromToken(await sign(claims(), K2, 'kid-9')), null, 'a kid the fresh key set does not have was accepted');
  assert.equal(calls.user, 0); assert.equal(calls.jwks, 2);
  JWKS = { keys: [await publicJwk(K1, 'kid-1'), await publicJwk(K2, 'kid-2')] }; state().lastFetch -= 61_000;
  assert.equal((await userFromToken(await sign(claims(), K2, 'kid-2')))?.id, UID, 'a published rotated key did not verify');
  assert.equal(calls.user, 0, 'Auth was asked for a token the new key set can verify');
});

test('V12. a token that is not a JWT goes to Auth, and Auth\'s answer decides', async () => {
  assert.equal(await userFromToken('not-a-jwt'), null);
  AUTH_KNOWS.set('opaque-but-known', { id: UID, email: EMAIL });
  assert.equal((await userFromToken('opaque-but-known'))?.id, UID);
  assert.equal(calls.user, 2);
});

test('V13. an HS256 token goes to Auth once, is cached, and is asked again after 60 s even though it expires in an hour', async () => {
  const tok = hs256(claims({ exp: nowS() + 3600 })); AUTH_KNOWS.set(tok, { id: UID, email: EMAIL });
  assert.equal((await userFromToken(tok))?.id, UID); assert.equal((await userFromToken(tok))?.id, UID);
  assert.equal(calls.user, 1, 'the HS256 answer was not cached');
  const t0 = realNow(); Date.now = () => t0 + 61_000;
  assert.equal((await userFromToken(tok))?.id, UID);
  assert.equal(calls.user, 2, 'the HS256 answer was cached for longer than 60 s');
});

test('V14. a cached token is dropped at its exp: after it, the same token is refused (no call to Auth)', async () => {
  const tok = await sign(claims({ exp: nowS() + 2 }));
  assert.ok(await userFromToken(tok)); assert.equal(_authUserStats().cached, 1);
  const t0 = realNow(); Date.now = () => t0 + 3_000;
  assert.equal(await userFromToken(tok), null, 'an expired token was served from the cache');
  assert.equal(calls.user, 0);
});

test('V15. the cache holds at most 5,000 tokens', async () => {
  for (let i = 0; i < 5050; i++) assert.ok(await userFromToken(await sign(claims({ jti: `t${i}` }))));
  assert.equal(_authUserStats().cached, 5000);
  assert.equal(calls.user, 0);
});

test('F1. a key-set refetch that FAILS while a new kid appears sends the token to Auth instead of rejecting it (fixed in #1656)', async () => {
  const t0 = realNow(); Date.now = () => t0;
  assert.ok(await userFromToken(await sign(claims())));
  // move the clock, not lastFetch: rewinding lastFetch alone let a refetch in the same millisecond as the first fetch read as a success
  Date.now = () => t0 + 61_000; jwksDown = true;
  const rotated = await sign(claims(), K2, 'kid-2'); AUTH_KNOWS.set(rotated, { id: UID, email: EMAIL });
  assert.equal((await userFromToken(rotated))?.id, UID, 'a valid token with a newly rotated kid was rejected because the key set could not be fetched');
  assert.equal(calls.jwks, 2, 'the key set was not re-fetched, so the failed-refetch path was never taken');
  assert.equal(calls.user, 1);
});

test('B1. the ban flag (#1656): flagged reads banned, unflagged and no row read not banned, and a FAILED read lets the call through', async () => {
  const { isAccountBanned, getUserCompatForBilledCall } = await import('../lib/authUser.ts');
  assert.equal(await isAccountBanned(UID), false);
  FLAGGED.add(UID); assert.equal(await isAccountBanned(UID), true);
  const tok = await sign(claims());
  assert.deepEqual(await getUserCompatForBilledCall(tok), { data: { user: null }, error: null }, 'a flagged account was answered as a user for a billed call');
  assert.equal((await getUserCompat(tok)).data.user?.id, UID, 'the plain check must not read the flag (free reads stay one-step)');
  statusReadFails = true;
  assert.equal(await isAccountBanned(UID), false, 'a failed read must not switch off paid features');
  assert.equal(calls.user, 0, 'the ban check asked Auth');
});

/* ---- the real routes ---- */
process.env.GROK_API_KEY = 'placeholder-xai';
const settingsRoute = await import('../app/api/settings/route.ts');
const pushRoute = await import('../app/api/push/subscribe/route.ts');
const chatRoute = await import('../app/api/grok-chat/route.ts');
const get = (path: string, token?: string) => new NextRequest(`http://localhost${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const post = (path: string, body: unknown, token?: string) => new NextRequest(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

test('R1. settings GET with a good token answers from the database with no call to Auth; with no token it is 401 and calls nothing', async () => {
  const tok = await sign(claims());
  const r = await settingsRoute.GET(get('/api/settings', tok)); assert.equal(r.status, 200);
  assert.equal(calls.user, 0, 'settings GET asked Auth');
  assert.ok(calls.rest.some((c) => c.m === 'GET' && c.p.endsWith('user_settings')));
  calls.rest = [];
  assert.equal((await settingsRoute.GET(get('/api/settings'))).status, 401);
  assert.equal(calls.user, 0); assert.equal(calls.rest.length, 0);
});

test('R2. push subscribe (a service-role write) asks Auth exactly once and writes for that user; a banned account is refused at once; no token is 401 with no call', async () => {
  const tok = await sign(claims()); AUTH_KNOWS.set(tok, { id: UID, email: EMAIL });
  const sub = { endpoint: 'https://push.example.test/e1', keys: { p256dh: 'p', auth: 'a' } };
  const ok = await pushRoute.POST(post('/api/push/subscribe', sub, tok)); assert.equal(ok.status, 200);
  assert.equal(calls.user, 1, 'push subscribe must ask Auth once (it writes with the service role)');
  assert.equal((calls.rest.find((c) => c.m === 'POST')?.body as { user_id?: string })?.user_id, UID);
  calls.user = 0; calls.rest = []; BANNED.add(tok);
  assert.equal((await pushRoute.POST(post('/api/push/subscribe', sub, tok))).status, 401, 'a banned account with a still-valid token was let through');
  assert.equal(calls.rest.length, 0, 'a banned account reached the write');
  calls.user = 0;
  assert.equal((await pushRoute.POST(post('/api/push/subscribe', sub))).status, 401); assert.equal(calls.user, 0);
});

test('R3. the paid chat (#1656, F2) refuses a banned account with a still-valid token, with no xAI call; with no token it is 401 as well', async () => {
  const tok = await sign(claims()); FLAGGED.add(UID);
  const r = await chatRoute.POST(post('/api/grok-chat', { messages: [{ role: 'user', content: 'qa' }] }, tok));
  assert.equal(r.status, 401, 'a banned account reached the paid chat');
  assert.deepEqual(calls.stray, [], `the chat called out (${calls.stray.join(', ')}) for a banned account`);
  assert.ok(calls.rest.some((c) => c.p.endsWith('user_status')), 'the ban flag was not read');
  assert.equal((await chatRoute.POST(post('/api/grok-chat', { messages: [] }))).status, 401);
  assert.equal(calls.user, 0);
});

const routeFiles = () => {
  const files: string[] = [];
  const walk = (dir: string) => { for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
  walk('app/api'); return files;
};
const count = (f: string, re: RegExp) => (stripTsComments(read(f)).match(re) ?? []).length;

test('P1. who asks Auth: telegram/status and admin-auth on auth.getUser(); the write handlers, welcome-email and the Whop claim through fetchAuthUser(); nothing else under app/api', () => {
  const files = routeFiles();
  const getUserCallers = files.filter((f) => count(f, /\.auth\.getUser\(/g) > 0).sort();
  const fetchAuthCallers = files.filter((f) => count(f, /\bfetchAuthUser\(/g) > 0).sort();
  assert.deepEqual(getUserCallers, ['app/api/telegram/status/route.ts']);
  assert.ok(count('lib/admin-auth.ts', /\.auth\.getUser\(/g) > 0, 'lib/admin-auth.ts no longer asks Auth');
  // #1657: welcome-email and the claim check the token locally and ask Auth only when they have work (an unsent email, a waiting claim)
  assert.deepEqual(fetchAuthCallers, ['app/api/alert-prefs/route.ts', 'app/api/auth/welcome-email/route.ts', 'app/api/lemonsqueezy/cancel/route.ts', 'app/api/push/subscribe/route.ts',
    'app/api/push/test/route.ts', 'app/api/telegram/link-code/route.ts', 'app/api/whop/claim/route.ts']);
  assert.equal(count('app/api/telegram/link-code/route.ts', /\bfetchAuthUser\(/g), 2, 'link-code create and unlink should both ask Auth');
});

test('P2. every route that spends on xAI checks the ban flag (getUserCompatForBilledCall), ops routes aside', () => {
  const xai = routeFiles().filter((f) => !f.startsWith('app/api/ops/') && /GROK_API_KEY|api\.x\.ai/.test(read(f)));
  assert.ok(xai.length >= 10, `precondition: only ${xai.length} xAI routes found`);
  const unchecked = xai.filter((f) => count(f, /\bgetUserCompatForBilledCall\(/g) === 0);
  assert.deepEqual(unchecked, [], 'a route that spends on xAI does not check the ban flag');
});
