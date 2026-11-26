/* QA: PR #2835 (owner item 51), tighter limits on the ban-reason lookup. The real route runs; the auth service is a stand-in.
 *   B1 five tries for one address in 15 minutes, whatever the network address and the letter case; the sixth is 429 with a null reason and no sign-in is tried
 *   B2 the Turnstile token reaches the sign-in check; without one (or with a non-string) none is sent
 *   B3 one network address still gets five a minute
 *   B4 the login page asks only with a fresh token and gets the form a new one after using it */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
const tries: Array<{ email: string; captcha: unknown }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  if (!req.url.includes('/auth/v1/token')) throw new Error(`stray request ${req.url}`);
  const body = await req.json() as { email: string; gotrue_meta_security?: { captcha_token?: unknown } };
  tries.push({ email: body.email, captcha: body.gotrue_meta_security?.captcha_token });
  return new Response(JSON.stringify({ code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' }), { status: 400, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

const { POST } = await import('../app/api/auth/ban-reason/route') as { POST: (r: NextRequest) => Promise<Response> };
const ask = async (ip: string, body: Record<string, unknown>) => {
  const r = await POST(new NextRequest('http://localhost/api/auth/ban-reason', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, 'x-forwarded-for': ip, 'x-real-ip': ip }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() as { reason: string | null } };
};

test('B1. the per-address limit holds across network addresses and letter case', async () => {
  const spellings = ['qa-ban@example.test', 'QA-Ban@Example.Test', ' qa-ban@example.test ', 'QA-BAN@EXAMPLE.TEST', 'qa-ban@example.test'];
  for (const [i, email] of spellings.entries()) assert.equal((await ask(`198.51.100.${i + 1}`, { email, password: 'x' })).status, 200, `try ${i + 1}`);
  const before = tries.length;
  const sixth = await ask('198.51.100.99', { email: 'Qa-ban@example.test', password: 'x' });
  assert.deepEqual([sixth.status, sixth.body, tries.length - before], [429, { reason: null }, 0]);
  assert.equal((await ask('198.51.100.100', { email: 'qa-other@example.test', password: 'x' })).status, 200, 'another address is not limited');
});

test('B2. the token reaches the sign-in only when there is one', async () => {
  tries.length = 0;
  await ask('203.0.113.1', { email: 'qa-t1@example.test', password: 'x', captchaToken: 'qa-token' });
  await ask('203.0.113.2', { email: 'qa-t2@example.test', password: 'x' });
  await ask('203.0.113.3', { email: 'qa-t3@example.test', password: 'x', captchaToken: '' });
  await ask('203.0.113.4', { email: 'qa-t4@example.test', password: 'x', captchaToken: { a: 1 } });
  assert.deepEqual(tries.map((t) => t.captcha), ['qa-token', undefined, undefined, undefined]);
});

test('B3. five a minute for one network address', async () => {
  const got: number[] = [];
  for (let i = 0; i < 6; i++) got.push((await ask('192.0.2.50', { email: `qa-net${i}@example.test`, password: 'x' })).status);
  assert.deepEqual(got, [200, 200, 200, 200, 200, 429]);
});

test('B4. the login page asks with a fresh token', () => {
  const page = readFileSync(new URL('../app/(main)/login/page.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(page.includes('if (!banAsk || (TURNSTILE_SITE_KEY && !pwCaptchaToken)) return;'));
  assert.ok(page.includes("if (token) { pwTurnstileRef.current?.reset(); setPwCaptchaToken(''); }"));
  const signIn = page.indexOf('const { error } = await sb.auth.signInWithPassword({');
  const spent = page.indexOf("setPwCaptchaToken('');", signIn), asked = page.indexOf('setBanAsk({ email: trimmed', signIn);
  assert.ok(signIn > 0 && spent > signIn && asked > spent, 'the spent sign-in token is cleared before the question is queued');
  assert.equal(page.split("fetch('/api/auth/ban-reason'").length - 1, 1);
});
