/* QA: PR #2701, a request's token is read ONLY from an `Authorization: Bearer ...` header (lib/bearerToken.ts).
 *
 * THE WRITTEN RULE (Dev's PR + QA finding on #2671): the HTTP site gate on dev / qa / staging makes the browser send `Authorization: Basic ...` on
 * every request, and /api/market/rsi, /api/grok, /api/proxy and /api/cmc took ANY Authorization value as the user's token, so the gate's credential
 * was checked as a session and the anonymous visitor got 401 TOKEN_EXPIRED (Arena Multi-timeframe "No data" on every gated host). Another scheme
 * is NOT a token: it reads as an anonymous visitor.
 *
 *   B1  the helper: Bearer (any case) -> the token; Basic, Digest, an empty header, "Bearer" alone, no header -> undefined
 *   B2  no route or lib file still reads the header with the old `.replace('Bearer ', '')` pattern (the control: the same scan finds it in the pre-fix source text)
 *   B3  the four optional-token routes (market/rsi, grok, proxy, cmc) read the token through the helper
 *   B4  the REAL /api/market/rsi handler, network stood in: a Basic header answers like no header (not 401); a Bearer token the auth server rejects still answers 401 TOKEN_EXPIRED (the control: the 401 path is alive)
 *   B5  the required-token routes still answer 401 on a Basic header (the 401 of /api/settings with Basic, real handler)
 * WHAT THIS CANNOT PROVE: the gated hosts themselves (the in-browser check is the Arena MTF card on staging after the promotion). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { bearerToken } from '../lib/bearerToken.ts';

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const h = (v?: string) => new Headers(v === undefined ? {} : { Authorization: v });

test('B1. the helper reads Bearer only', () => {
  assert.equal(bearerToken(h('Bearer abc.def.ghi')), 'abc.def.ghi');
  assert.equal(bearerToken(h('bearer abc')), 'abc');
  assert.equal(bearerToken(h('BEARER abc')), 'abc');
  assert.equal(bearerToken(h('Bearer   abc  ')), 'abc');
  for (const v of ['Basic dXNlcjpwYXNz', 'Basic QmVhcmVyIHg=', 'Digest username="a"', 'Bearer', 'Bearer ', 'abc.def.ghi', '']) {
    assert.equal(bearerToken(h(v)), undefined, `"${v}" must not be a token`);
  }
  assert.equal(bearerToken(h()), undefined, 'no header');
  console.log('[B1] Bearer/bearer/BEARER read; Basic, Digest, bare token, "Bearer", empty and no header all undefined');
});

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
    const rel = `${dir}/${n}`;
    const st = statSync(new URL(`../${rel}`, import.meta.url));
    if (st.isDirectory()) files(rel, out); else if (/\.tsx?$/.test(n)) out.push(rel);
  }
  return out;
}
const OLD = /\.get\(\s*['"][Aa]uthorization['"]\s*\)\s*\??\.replace\(\s*['"]Bearer ['"]/;

test('B2. no file reads the header with the old replace(\'Bearer \', \'\') pattern (the scan finds the pattern in the pre-fix text)', () => {
  assert.ok(OLD.test("const token = req.headers.get('Authorization')?.replace('Bearer ', '') || undefined;"), 'control: the scan does not see the pre-fix line');
  assert.ok(OLD.test("const token = request.headers.get(\"authorization\")?.replace(\"Bearer \", \"\");"), 'control: double-quoted variant');
  const left: string[] = [];
  for (const f of [...files('app'), ...files('lib')]) if (OLD.test(read(f))) left.push(f);
  assert.deepEqual(left, [], `still on the old pattern: ${left.join(', ')}`);
});

test('B3. the optional-token routes read the token through the helper', () => {
  // #2833: proxy and cmc no longer read the token at all (quietRequestLogs2833)
  for (const f of ['app/api/market/rsi/route.ts', 'app/api/grok/route.ts']) {
    const s = read(f);
    assert.match(s, /from '@\/lib\/bearerToken'/, `${f} does not import the helper`);
    assert.match(s, /bearerToken\(\s*(req|request)\.headers\s*\)/, `${f} does not call it on the request headers`);
  }
});

/* the network stand-in: klines answer, the auth server rejects every token */
const realFetch = globalThis.fetch;
const calls: string[] = [];
const kl = Array.from({ length: 300 }, (_, i) => [1_700_000_000_000 + i * 3_600_000, '100', '101', '99', String(100 + (i % 7)), '10', 1_700_000_000_000 + i * 3_600_000 + 3_599_999, '1000', 10, '5', '500', '0']);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
  calls.push(`${url.host}${url.pathname}`);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.origin === SUPABASE) {
    if (url.pathname.startsWith('/auth/v1/user')) return json(401, { msg: 'invalid JWT' });
    if (url.pathname.includes('jwks')) return json(200, { keys: [] });
    return json(200, []);
  }
  if (/binance|bybit/.test(url.host)) {
    if (url.pathname.includes('/v5/')) return json(200, { retCode: 0, result: { list: kl.map((k) => [String(k[0]), k[1], k[2], k[3], k[4], k[5]]).reverse() } });
    return json(200, kl);
  }
  void init;
  return json(404, {});
}) as typeof fetch;
test.after(() => { globalThis.fetch = realFetch; });

const rsiReq = (auth?: string) => new NextRequest('http://localhost/api/market/rsi', { headers: auth === undefined ? {} : { Authorization: auth } });

test('B4. real /api/market/rsi: Basic answers like no header; a rejected Bearer still answers 401', async () => {
  const { GET } = await import('../app/api/market/rsi/route.ts');
  const none = await GET(rsiReq());
  const basic = await GET(rsiReq('Basic dXNlcjpnYXRlLXBhc3N3b3Jk'));
  const bearer = await GET(rsiReq('Bearer not.a.realtoken'));
  console.log(`[B4] no header ${none.status}, Basic ${basic.status}, Bearer (auth server says invalid) ${bearer.status}; network hosts touched: ${[...new Set(calls.map((c) => c.split('/')[0]))].join(', ')}`);
  assert.notEqual(none.status, 401, 'the anonymous baseline must not be 401');
  assert.equal(bearer.status, 401, 'control: a rejected Bearer token still answers 401 (the path is alive)');
  assert.deepEqual(await bearer.json(), { error: 'TOKEN_EXPIRED' });
  assert.notEqual(basic.status, 401, 'the gate\'s Basic credential was read as a session');
  assert.equal(basic.status, none.status, 'Basic must behave exactly like no header');
});

test('B5. a required-token route still refuses a Basic header with 401', async () => {
  const { GET } = await import('../app/api/settings/route.ts');
  const res = await GET(new NextRequest('http://localhost/api/settings', { headers: { Authorization: 'Basic dXNlcjpwYXNz' } }));
  console.log(`[B5] /api/settings with Basic: ${res.status}`);
  assert.equal(res.status, 401);
});
