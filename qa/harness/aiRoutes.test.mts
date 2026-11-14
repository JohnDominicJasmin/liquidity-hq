import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import path from 'node:path';
import { NextRequest } from 'next/server.js';

/* QA's cells for the paid AI tool routes (#2322, PM hold): an over-long or malformed body must be answered 400 BEFORE the usage counter is charged, so a bad request costs the account nothing and a retry
 * is not double-counted. The REAL route handlers run in-process with the usage, auth and xAI calls stood in (qa/harness/aiRouteStubs.mjs); the stand-in counts every incrementToolUsage call. A valid body in the
 * same file proves the counter does move (so "unchanged" is the validation, not a dead counter). Nothing is sent anywhere. */
process.env.GROK_API_KEY = 'qa-harness-not-a-key';
const root = path.resolve('.'); const stubs = path.join(root, 'qa/harness/aiRouteStubs.mjs');
const jiti = createJiti(import.meta.url, { alias: { '@/lib/aiUsage': stubs, '@/lib/entitlements': stubs, '@/lib/authUser': stubs, '@/lib/supabase-user': stubs, '@/lib/aiCallLog': stubs, '@/lib/apiError': stubs, '@/lib/xai': stubs, '@': root }, interopDefault: true, moduleCache: false });
const hh = () => ((globalThis as unknown as { __aiHarness: { increments: unknown[]; xai: number } }).__aiHarness ??= { increments: [], xai: 0 });
const call = async (routePath: string, body: unknown) => {
  const mod = await jiti.import(path.join(root, routePath)); hh().increments.length = 0; hh().xai = 0;
  const req = new NextRequest('http://localhost/api/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', Authorization: 'Bearer t' } });
  const res = await (mod as { POST: (r: NextRequest) => Promise<Response> }).POST(req);
  return { status: res.status, increments: hh().increments.length, xai: hh().xai };
};
const big = (n: number) => 'a'.repeat(n);
const ROUTES = [
  { name: 'thesis-check', path: 'app/api/thesis-check/route.ts', ok: { symbol: 'BTC', direction: 'long', thesisText: 'a thesis', assumptions: ['one'] },
    bad: [['a 4001-character thesis', { symbol: 'BTC', direction: 'long', thesisText: big(4001), assumptions: ['one'] }], ['21 assumptions', { symbol: 'BTC', direction: 'long', thesisText: 't', assumptions: Array.from({ length: 21 }, () => 'a') }], ['a 501-character assumption', { symbol: 'BTC', direction: 'long', thesisText: 't', assumptions: [big(501)] }], ['a number as the symbol', { symbol: 5, direction: 'long', thesisText: 't', assumptions: ['one'] }], ['a body that is not JSON', 'not json at all']] },
  { name: 'strategy-research', path: 'app/api/strategy-research/route.ts', ok: { description: 'buy dips on btc' },
    bad: [['a 4001-character description', { description: big(4001) }], ['a non-string description', { description: 42 }], ['a body that is not JSON', 'not json at all']] },
  { name: 'pine-script', path: 'app/api/pine-script/route.ts', ok: { description: 'ema cross', analysisText: 'analysis' },
    bad: [['a 4001-character description', { description: big(4001), analysisText: 'x' }], ['a 20001-character analysis', { description: 'd', analysisText: big(20001) }], ['a non-string analysis', { description: 'd', analysisText: 7 }], ['a body that is not JSON', 'not json at all']] },
] as const;

for (const r of ROUTES) {
  test(`${r.name}: CONTROL: a valid body is accepted and the usage counter moves exactly once`, async () => {
    const out = await call(r.path, r.ok); assert.notEqual(out.status, 400, `a valid body was refused: ${out.status}`); assert.equal(out.increments, 1, 'the usage counter did not move for a valid request (a dead counter would make the cells below meaningless)');
  });
  for (const [label, body] of r.bad) test(`${r.name}: ${label} is answered 400 and the usage counter is UNCHANGED`, async () => {
    const out = await call(r.path, body); assert.equal(out.status, 400, `status ${out.status}`); assert.equal(out.increments, 0, `the account was charged ${out.increments} use(s) for a request that was refused`); assert.equal(out.xai, 0, 'xAI was called for a refused request');
  });
}
