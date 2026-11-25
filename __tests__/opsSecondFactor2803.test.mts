/* QA: PR #2803 (#1632 owner item 2), every /ops admin route needs a second factor (a session at assurance level aal2). The REAL requireAdmin / withAdmin / withOwner run; only Supabase is a stand-in (Auth /user and the admin table).
 *   S1 an admin or owner on a password-only session (aal1): 403 with code MFA_REQUIRED, and the wrapped handler never runs
 *   S2 the same on an aal2 session: let in
 *   S3 a token whose level cannot be read (no claim, not JSON, wrong type) is not aal2
 *   S4 a caller who is not an admin gets the plain Forbidden at either level: the code tells them nothing
 *   S5 a token Auth refuses is 401 even when it claims aal2
 *   S6 only OPS_SECOND_FACTOR_OFF=1 turns the requirement off
 *   S7 the emergency bootstrap owner needs it too
 *   S8 every route under app/api/ops is behind withAdmin or withOwner, except the cron route, which checks the cron secret
 *   S9 the console shows the code screen on MFA_REQUIRED
 * WHAT IT CANNOT PROVE: enrolling and verifying a real authenticator (the browser step on qa), or that TOTP is switched on in the Supabase project. */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
delete process.env.ADMIN_EMAILS; delete process.env.OPS_SECOND_FACTOR_OFF;
const UID = '77777777-7777-4777-8777-777777777777', EMAIL = 'qa-admin@example.test';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const world = { role: 'owner' as 'owner' | 'staff' | null, authRefuses: false };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.origin !== SUPABASE) throw new Error(`stray request ${req.url}`);
  if (url.pathname === '/auth/v1/user') return world.authRefuses ? json(401, { code: 'bad_jwt', message: 'invalid JWT' }) : json(200, { id: UID, email: EMAIL, email_confirmed_at: '2026-01-01T00:00:00Z', aud: 'authenticated', role: 'authenticated' });
  if (url.pathname.endsWith('admin_users')) {
    if (req.method !== 'GET') return new Response(null, { status: 201 });
    const rows = world.role ? [{ role: world.role, active: true }] : [];
    if (!(req.headers.get('accept') ?? '').includes('vnd.pgrst.object')) return json(200, rows);
    return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', details: 'Results contain 0 rows', message: 'no rows' });
  }
  return json(200, []);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });
beforeEach(() => { world.role = 'owner'; world.authRefuses = false; delete process.env.OPS_SECOND_FACTOR_OFF; delete process.env.ADMIN_EMAILS; });

const gate = await import('../lib/admin-auth.ts');
const part = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const token = (payload: unknown) => `${part({ alg: 'ES256' })}.${part(payload)}.sig`;
const req = (tok: string) => new Request('http://localhost/api/ops/me', { headers: { Authorization: `Bearer ${tok}` } });
async function through(wrap: 'withAdmin' | 'withOwner', tok: string) {
  let ran = 0;
  const handler = gate[wrap](async () => { ran++; return new Response('{}', { status: 200 }); });
  const r = await handler(req(tok));
  return { status: r.status, body: await r.json() as { code?: string; error?: string }, ran };
}
const AAL1 = token({ sub: UID, aal: 'aal1' }), AAL2 = token({ sub: UID, aal: 'aal2' });

test('S1. a password-only session is refused with MFA_REQUIRED on admin and owner routes, and the handler never runs', async () => {
  for (const role of ['owner', 'staff'] as const) for (const wrap of ['withAdmin', 'withOwner'] as const) {
    world.role = role; const r = await through(wrap, AAL1);
    assert.equal(r.status, 403, `${role} ${wrap}`); assert.equal(r.body.code, 'MFA_REQUIRED'); assert.equal(r.ran, 0);
  }
});

test('S2. a session with a second factor is let in; staff still cannot use an owner route', async () => {
  assert.deepEqual(await through('withAdmin', AAL2), { status: 200, body: {}, ran: 1 });
  assert.deepEqual(await through('withOwner', AAL2), { status: 200, body: {}, ran: 1 });
  world.role = 'staff';
  assert.equal((await through('withAdmin', AAL2)).status, 200);
  const r = await through('withOwner', AAL2); assert.equal(r.status, 403); assert.equal(r.body.code, undefined); assert.equal(r.ran, 0);
});

test('S3. a level that cannot be read is not aal2', async () => {
  for (const tok of [token({ sub: UID }), token('not json'), token({ aal: 2 }), token({ aal: ['aal2'] }), token({ aal: 'AAL2' }), 'opaque-token']) {
    const r = await through('withAdmin', tok);
    assert.equal(r.status, 403, tok); assert.equal(r.body.code, 'MFA_REQUIRED'); assert.equal(r.ran, 0);
  }
});

test('S4. a caller who is not an admin gets plain Forbidden at either level', async () => {
  world.role = null;
  for (const tok of [AAL1, AAL2]) { const r = await through('withAdmin', tok); assert.equal(r.status, 403); assert.deepEqual(r.body, { error: 'Forbidden' }); assert.equal(r.ran, 0); }
});

test('S5. a token Auth refuses is 401 whatever it claims', async () => {
  world.authRefuses = true; const r = await through('withAdmin', AAL2); assert.equal(r.status, 401); assert.equal(r.ran, 0);
});

test('S6. only OPS_SECOND_FACTOR_OFF=1 turns the requirement off', async () => {
  for (const v of ['', '0', 'true', 'yes', ' 1']) { process.env.OPS_SECOND_FACTOR_OFF = v; assert.equal((await through('withAdmin', AAL1)).status, 403, JSON.stringify(v)); }
  process.env.OPS_SECOND_FACTOR_OFF = '1'; assert.equal((await through('withAdmin', AAL1)).status, 200);
  world.role = null; assert.equal((await through('withAdmin', AAL1)).status, 403, 'the switch let a non-admin in');
});

test('S7. the emergency bootstrap owner needs the second factor as well', async () => {
  process.env.ADMIN_EMAILS = EMAIL; world.role = null;
  assert.equal((await through('withOwner', AAL1)).body.code, 'MFA_REQUIRED');
  assert.equal((await through('withOwner', AAL2)).status, 200, 'CONTROL: the same bootstrap owner is let in with the factor');
});

test('S8. every ops route goes through the gate; the one cron route checks the cron secret', () => {
  const files: string[] = [];
  const walk = (dir: string) => { for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p); else if (e.name === 'route.ts') files.push(p); } };
  walk('app/api/ops');
  assert.ok(files.length >= 14, `CONTROL: only ${files.length} ops routes found`);
  for (const f of files) {
    const s = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    if (f === 'app/api/ops/spike-alert/route.ts') { assert.match(s, /if \(!checkCronAuth\(req\)\) return/); continue; }
    const handlers = [...s.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b([^\n]*)/g)];
    assert.ok(handlers.length > 0, `${f}: no handler found`);
    for (const h of handlers) assert.match(h[2], /^\s*=\s*with(Admin|Owner)\b/, `${f} ${h[1]} is not wrapped by the admin gate`);
  }
});

test('S9. the console shows the code screen when the answer is MFA_REQUIRED', () => {
  const s = readFileSync(new URL('../app/(main)/ops/_gate.tsx', import.meta.url), 'utf8');
  assert.match(s, /setState\(body\?\.code === 'MFA_REQUIRED' \? 'secondFactor' : 'denied'\)/);
  assert.match(s, /state === 'secondFactor'[\s\S]{0,200}<OpsSecondFactor onVerified=/);
});
