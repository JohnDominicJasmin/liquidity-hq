/* #2414 (draft, HELD): the signed-in plan read started before hydration. The generated inline script is RUN in a node:vm sandbox with a stub window / localStorage / fetch, and takePlanPrefetch is the REAL function against that same window.
 *   X1  a live stored token starts exactly ONE read: the user's own id in the query, Bearer token + anon key, GET, nothing written; a clean 200 is taken
 *   X2  nothing starts when it must not: token with < 60 s left, expired, no token, no user id, a chunk key (-auth-token.0), a key not starting with sb-, malformed JSON in storage, localStorage that throws
 *   X3  only a clean 200 counts: 401, 500, a thrown fetch, a non-array body and a never-settling fetch are "no prefetch" ({ ok: false }), NEVER a row and never an entitlement
 *   X4  a clean 200 with NO row is { ok: true, row: null } (free, as maybeSingle reports today); a row comes back as is
 *   X5  used ONCE and for the SAME user: another user's id is refused, and the stash is cleared either way so a second take is { ok: false }
 *   X6  the script is injection-safe: a quote, backslash or </script> in the URL / key / table name cannot break out (the script still compiles and the values arrive intact)
 *   X7  wiring: the script is only rendered when the public URL and anon key exist; AuthProvider asks ONCE, only on the first attempt of a load, and a failed take falls through to the normal read
 * WHAT IT CANNOT PROVE: the gain (it removes the read's own 0.16-0.4 s, not hydration: that is QA's measurement after the release, per the PR), or behaviour in real Safari/WebViews. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { planPrefetchScript, takePlanPrefetch, PLAN_PREFETCH_GLOBAL, PLAN_PREFETCH_MIN_TOKEN_LIFE_MS, PLAN_PREFETCH_TIMEOUT_MS } from '../lib/planPrefetch.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const URL_ = 'https://abc.supabase.co/', KEY = 'anon-public-key', TABLE = 'user_subscriptions';
const NOW = Date.now(); const session = (over: Record<string, unknown> = {}) => JSON.stringify({ access_token: 'tok123', expires_at: Math.floor(NOW / 1000) + 3600, user: { id: 'user-1' }, ...over });
type Call = { url: string; init: { method?: string; headers: Record<string, string>; body?: unknown } };

function run(store: Record<string, string>, fetchImpl: (url: string, init: Call['init']) => Promise<unknown>, script = planPrefetchScript(URL_, KEY, TABLE)) {
  const calls: Call[] = []; const keys = Object.keys(store);
  const win: Record<string, unknown> = { localStorage: { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => store[k] ?? null } };
  const ctx: Record<string, unknown> = { window: win, fetch: (u: string, i: Call['init']) => { calls.push({ url: u, init: i }); return fetchImpl(u, i); }, AbortController, setTimeout, clearTimeout, JSON, Number, Array, encodeURIComponent, Date };
  ctx.globalThis = ctx; vm.runInNewContext(script, ctx); return { win, calls };
}
const okJson = (body: unknown, status = 200) => Promise.resolve({ status, json: () => Promise.resolve(body) });
/* results cross the vm realm: compare as JSON so a different Object.prototype is not a difference */
const asWindow = async <T,>(win: Record<string, unknown>, f: () => Promise<T>) => { const g = globalThis as unknown as { window?: unknown }; const prev = g.window; g.window = win; try { return JSON.parse(JSON.stringify(await f())) as T; } finally { g.window = prev; } };

test('X1. a live token starts ONE read with the user\'s own id, Bearer token and anon key; a clean 200 is taken', async () => {
  const { win, calls } = run({ 'sb-abc-auth-token': session() }, () => okJson([{ role: 'pro', trial_ends_at: null, current_period_end: '2027-01-01' }]));
  assert.equal(calls.length, 1, 'the read was not started exactly once'); assert.equal(calls[0].url, 'https://abc.supabase.co/rest/v1/user_subscriptions?select=role,trial_ends_at,current_period_end&limit=1&user_id=eq.user-1');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok123'); assert.equal(calls[0].init.headers.apikey, KEY); assert.equal(calls[0].init.method, undefined, 'only a GET'); assert.equal(calls[0].init.body, undefined, 'something is written');
  assert.equal((win[PLAN_PREFETCH_GLOBAL] as { uid: string }).uid, 'user-1');
  assert.deepEqual(await asWindow(win, () => takePlanPrefetch('user-1', 1000)), { ok: true, row: { role: 'pro', trial_ends_at: null, current_period_end: '2027-01-01' } });
});
test('X2. nothing starts for a short-lived, expired, missing, chunked, foreign or malformed session, or throwing storage', () => {
  const never = () => { throw new Error('fetch must not be called'); };
  const cases: [string, Record<string, string>][] = [
    ['< 60 s left', { 'sb-abc-auth-token': session({ expires_at: Math.floor(NOW / 1000) + 30 }) }], ['expired', { 'sb-abc-auth-token': session({ expires_at: Math.floor(NOW / 1000) - 10 }) }],
    ['no expiry', { 'sb-abc-auth-token': session({ expires_at: undefined }) }], ['no token', { 'sb-abc-auth-token': session({ access_token: '' }) }], ['no user id', { 'sb-abc-auth-token': session({ user: {} }) }],
    ['chunk key', { 'sb-abc-auth-token.0': session() }], ['not sb- key', { 'abc-auth-token': session() }], ['wrong suffix', { 'sb-abc-auth-token-code-verifier': session() }], ['malformed json', { 'sb-abc-auth-token': '{not json' }], ['empty storage', {}],
  ];
  for (const [name, store] of cases) { const { win, calls } = run(store, never as never); assert.equal(calls.length, 0, `${name}: a read was started`); assert.equal(win[PLAN_PREFETCH_GLOBAL], undefined, `${name}: a stash was set`); }
  assert.equal(PLAN_PREFETCH_MIN_TOKEN_LIFE_MS, 60_000);
  const throwing = { window: { get localStorage() { throw new Error('denied'); } }, fetch: never, AbortController, setTimeout, clearTimeout, JSON, Number, Array, encodeURIComponent, Date } as Record<string, unknown>; assert.doesNotThrow(() => vm.runInNewContext(planPrefetchScript(URL_, KEY, TABLE), throwing), 'blocked storage broke the page script');
});
test('X3. only a clean 200 counts: 401, 500, a thrown fetch, a non-array body and a never-settling fetch all give { ok: false }', async () => {
  const store = { 'sb-abc-auth-token': session() };
  for (const [name, impl] of [['401', () => okJson([{ role: 'pro' }], 401)], ['500', () => okJson([{ role: 'pro' }], 500)], ['thrown', () => Promise.reject(new Error('net'))], ['object body', () => okJson({ role: 'pro' })], ['null body', () => okJson(null)]] as const) {
    const { win } = run(store, impl as never); assert.deepEqual(await asWindow(win, () => takePlanPrefetch('user-1', 1000)), { ok: false }, `${name} became an answer`);
  }
  const { win } = run(store, () => new Promise(() => {})); const t0 = Date.now(); assert.deepEqual(await asWindow(win, () => takePlanPrefetch('user-1', 50)), { ok: false }, 'a never-settling read was waited for'); assert.ok(Date.now() - t0 < 1000, 'the budget was not honoured');
  assert.equal(PLAN_PREFETCH_TIMEOUT_MS, 8000);
});
test('X4. a clean 200 with no row is { ok: true, row: null } (free); a row is returned as is', async () => {
  const a = run({ 'sb-abc-auth-token': session() }, () => okJson([])); assert.deepEqual(await asWindow(a.win, () => takePlanPrefetch('user-1', 1000)), { ok: true, row: null });
  const b = run({ 'sb-abc-auth-token': session() }, () => okJson([{ role: 'trial', trial_ends_at: '2027-02-02' }])); assert.deepEqual(await asWindow(b.win, () => takePlanPrefetch('user-1', 1000)), { ok: true, row: { role: 'trial', trial_ends_at: '2027-02-02' } });
});
test('X5. used once and only for the same user; the stash is cleared either way', async () => {
  const { win } = run({ 'sb-abc-auth-token': session() }, () => okJson([{ role: 'pro' }]));
  assert.deepEqual(await asWindow(win, () => takePlanPrefetch('someone-else', 1000)), { ok: false }, 'another user was given this user\'s plan');
  assert.deepEqual(await asWindow(win, () => takePlanPrefetch('user-1', 1000)), { ok: false }, 'the stash survived a refused take: a later take could use it');
  const w2 = run({ 'sb-abc-auth-token': session() }, () => okJson([{ role: 'pro' }])).win; assert.equal((await asWindow(w2.constructor === Object ? w2 : w2, () => takePlanPrefetch('user-1', 1000))).ok, true);
  assert.deepEqual(await asWindow(w2, () => takePlanPrefetch('user-1', 1000)), { ok: false }, 'the same answer was used twice');
  assert.deepEqual(await asWindow({}, () => takePlanPrefetch('user-1', 1000)), { ok: false }, 'nothing stashed must be { ok: false }');
});
test('X6. the script cannot be broken by a quote, backslash or </script> in its inputs', () => {
  const nasty = 'a"b\'c\\d</script><x>'; const script = planPrefetchScript(`https://x.co/${nasty}`, nasty, `t${nasty}`);
  const { calls } = run({ 'sb-abc-auth-token': session() }, () => okJson([]), script); assert.equal(calls.length, 1, 'the script no longer compiles or runs with awkward inputs');
  assert.ok(calls[0].url.includes(nasty.replace(/\/+$/, '')) && calls[0].init.headers.apikey === nasty, 'the awkward values did not arrive intact');
  const { calls: c2 } = run({ 'sb-abc-auth-token': session({ user: { id: 'u&limit=5&x=y' }, }) }, () => okJson([])); assert.ok(c2[0].url.endsWith('user_id=eq.u%26limit%3D5%26x%3Dy'), 'the user id is not URL-encoded: it could add query parameters');
});
test('X7. wiring: rendered only with the public URL and key; AuthProvider asks once, on the first attempt, and falls through on a failed take', () => {
  const root = read('components/RootDocument.tsx'); assert.ok(root.includes('{process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && ('), 'the script renders without its URL/key'); assert.ok(root.includes('<Script id="plan-prefetch" strategy="beforeInteractive">'), 'the script is not beforeInteractive');
  assert.ok(root.includes('planPrefetchScript(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, T.user_subscriptions)'), 'the script is not built for the environment\'s subscriptions table');
  const a = read('components/AuthProvider.tsx'); assert.ok(a.includes('if (!prefetchTried && firstEntitlementsRef.current) {') && a.includes('prefetchTried = true;'), 'the prefetch is asked more than once or on retries');
  assert.ok(a.includes('if (pre.ok) return { data: pre.row, failed: false };'), 'a failed take does not fall through to the normal read'); assert.equal((a.match(/takePlanPrefetch\(/g) ?? []).length, 1, 'takePlanPrefetch is called from more than one place');
  assert.ok(read('lib/planPrefetch.ts').includes("if(r.status!==200)return{ok:false}"), 'a non-200 is no longer "no prefetch"');
});
