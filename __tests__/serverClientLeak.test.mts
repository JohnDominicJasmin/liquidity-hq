/* #1653 (#1397, the qa and production out-of-memory crashes): a Supabase client made on the server for one request must not outlive it.
 *
 * THE CAUSE, MEASURED HERE WITH A CONTROL: outside a browser, supabase-js starts a 30 s auto-refresh timer in every client unless autoRefreshToken is
 * false, nothing stops it, and the timer keeps the client reachable. So the control (a plain createClient, the way 33 call sites made them) must keep
 * every client alive after a forced GC; if it does not, this file proves nothing and says so.
 *
 * WHAT THIS PINS: 500 clients from userClient() and 200 from anonServerClient() are (nearly) all collected after a forced GC, while 500 plain clients
 * are all kept; SERVER_AUTH_OPTIONS turns off autoRefreshToken and persistSession; the service-role client sets both too; and `createClient(` appears in
 * app/ and lib/ only in lib/supabase.ts (the browser's one client), lib/supabase-admin.ts and lib/supabase-user.ts, so the hole cannot come back with
 * the next route.
 *
 * WHAT IT CANNOT PROVE: the heap curve of the real server under load (QA reads the [mem] lines on qa during the signed-in passes, #1653 step 3). No
 * network: the Supabase URL is a `.invalid` host and initialising a client makes no request. */
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
const { userClient, anonServerClient, SERVER_AUTH_OPTIONS } = await import('../lib/supabase-user.ts');
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const settle = () => new Promise((r) => setTimeout(r, 50));
/* Makes n clients, lets each finish initialising (that is where the timer starts), drops every strong reference, forces GC, counts the survivors. */
async function survivors(n: number, make: (i: number) => { auth: { initialize: () => Promise<unknown> } }): Promise<number> {
  const refs: WeakRef<object>[] = [];
  for (let i = 0; i < n; i++) { const c = make(i); await c.auth.initialize(); refs.push(new WeakRef(c)); }
  await settle(); await settle();
  for (let i = 0; i < 4; i++) { gc(); await settle(); }
  return refs.filter((r) => r.deref() !== undefined).length;
}

test('L1. control first: 500 plain server clients all stay alive after a forced GC (the leak), and 500 from userClient() are collected', async () => {
  const kept = await survivors(500, (i) => createClient('http://supabase.invalid', 'placeholder-anon', { global: { headers: { Authorization: `Bearer token-${i}` } } }));
  assert.ok(kept >= 490, `precondition failed: the control kept only ${kept} of 500, so this check cannot tell a fixed client from a leaking one`);
  const fixed = await survivors(500, (i) => userClient(`token-${i}`));
  assert.ok(fixed <= 5, `${fixed} of 500 userClient() clients were still reachable after a forced GC`);
});

test('L2. anonServerClient() clients are collected too', async () => {
  const fixed = await survivors(200, () => anonServerClient());
  assert.ok(fixed <= 5, `${fixed} of 200 anonServerClient() clients were still reachable after a forced GC`);
});

test('L3. the server options turn off the refresh timer and session storage, and the service-role client sets both', () => {
  assert.equal(SERVER_AUTH_OPTIONS.autoRefreshToken, false);
  assert.equal(SERVER_AUTH_OPTIONS.persistSession, false);
  const admin = stripTsComments(read('lib/supabase-admin.ts'));
  assert.ok(/autoRefreshToken:\s*false/.test(admin) && /persistSession:\s*false/.test(admin), 'lib/supabase-admin.ts no longer sets both options');
});

test('L4. `createClient(` appears in app/ and lib/ only in the three client modules', () => {
  const files: string[] = [];
  const walk = (dir: string) => { for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) files.push(p); } };
  for (const d of ['app', 'lib']) walk(d);
  assert.ok(files.length > 100, `precondition: only ${files.length} files found`);
  const makers = files.filter((f) => /\bcreateClient\(/.test(stripTsComments(read(f)))).sort();
  assert.deepEqual(makers, ['lib/supabase-admin.ts', 'lib/supabase-user.ts', 'lib/supabase.ts'], 'a new place makes its own Supabase client: use lib/supabase-user.ts on the server');
});
