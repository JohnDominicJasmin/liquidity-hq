/* QA: PR #2833 (owner item 17). The three public data routes write nothing about the caller. The real routes run; every upstream is a stand-in that fails.
 *   Q1 signed in or signed out, no log line from proxy, cmc or econ-calendar carries the caller's address, token or account id, and no sign-in lookup is made
 *   Q2 the request type is still logged for proxy and cmc, and the econ-calendar per-request line is gone */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { NextRequest } from 'next/server';

/* Node's strip-only mode refuses the cmc route's parameter property: this hook compiles exactly that file with the repo's TypeScript (as routeLastGood2740 does). */
register('data:text/javascript,' + encodeURIComponent(
  `import { createRequire } from 'node:module'; import { readFileSync } from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
  const ts = createRequire(pathToFileURL(process.cwd() + '/package.json').href)('typescript');
  export async function load(url, context, next) {
    if (url.endsWith('/app/api/cmc/route.ts')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
    return next(url, context);
  }`));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
process.env.CMC_API_KEY = 'placeholder-cmc';
const IP = '203.0.113.77', UID = '99999999-9999-4999-8999-999999999999';
const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${part({ alg: 'ES256' })}.${part({ sub: UID })}.qasignature`;
const asked: string[] = [], lines: string[] = [];
const realFetch = globalThis.fetch, real = { log: console.log, warn: console.warn, error: console.error, info: console.info };
globalThis.fetch = (async (input: RequestInfo | URL) => { asked.push(String(input instanceof Request ? input.url : input)); return new Response('stand-in: down', { status: 500 }); }) as typeof fetch;
for (const k of ['log', 'warn', 'error', 'info'] as const) console[k] = (...a: unknown[]) => { lines.push(a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
after(() => { globalThis.fetch = realFetch; Object.assign(console, real); });

const ROUTES = [
  { mod: '../app/api/proxy/route', path: '/api/proxy?type=llama-stables', line: '[proxy] type=llama-stables' },
  { mod: '../app/api/cmc/route', path: '/api/cmc?type=global', line: '[cmc] type=global' },
  { mod: '../app/api/econ-calendar/route', path: '/api/econ-calendar', line: null },
] as const;

for (const r of ROUTES) {
  test(`Q1 Q2. ${r.path}: nothing about the caller is logged or looked up`, async () => {
    const { GET } = await import(r.mod) as { GET: (q: NextRequest) => Promise<Response> };
    for (const signedIn of [false, true]) {
      lines.length = 0; asked.length = 0;
      const headers: Record<string, string> = { 'x-forwarded-for': IP, 'cf-connecting-ip': IP, 'x-real-ip': IP, ...(signedIn ? { authorization: `Bearer ${TOKEN}` } : {}) };
      const res = await GET(new NextRequest(`http://localhost${r.path}`, { headers }));
      assert.ok(res.status > 0);
      const all = lines.join('\n');
      for (const secret of [IP, UID, TOKEN, 'qasignature', 'user=', 'ip=']) assert.equal(all.includes(secret), false, `${signedIn ? 'signed in' : 'signed out'}: a log line carries ${secret.slice(0, 20)}`);
      assert.equal(asked.some((u) => u.includes('supabase.invalid/auth')), false, 'a sign-in lookup was made');
      if (r.line) assert.ok(lines.includes(r.line), `the request type line is missing: ${all.slice(0, 200)}`);
      else assert.equal(/^\[econ-calendar\] ip/m.test(all), false);
    }
  });
}
