import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { logHoneypotHit } from '../lib/honeypot.ts';
import * as adminApi from '../app/api/admin/[[...path]]/route.ts';

/* #2339 (S9): the admin decoy no longer writes to the database. QA's cells.
 *
 * WHAT THIS PINS: logHoneypotHit writes ONE console.warn line per hit, JSON with method (8), path (120), ip (64), ua (120), control characters replaced by spaces, behind a global cap of 120 lines
 * a minute (the 121st is dropped, and the window then reopens); the /api/admin catch-all answers 404 with the same body for every method, writes nothing to any network or database, and logs
 * one bounded line; neither the route nor the /admin page imports the audit table or the service-role client any more.
 *
 * WHAT IT CANNOT PROVE: the /admin PAGE's rendered 404 (it needs a request context; the source guard and a live check on qa cover it), and what the Render log looks like live. */

const warnLines = (t: { mock: typeof mock }) => { const lines: string[] = []; t.mock.method(console, 'warn', (...a: unknown[]) => { lines.push(a.map(String).join(' ')); }); return lines; };
const parse = (line: string) => { const m = /^\[honeypot\] (admin_api|admin_page) (\{.*\})$/.exec(line); assert.ok(m, `not a one-line honeypot record: ${line}`); return { kind: m![1], f: JSON.parse(m![2]) as { method: string; path: string; ip: string; ua: string } }; };
const advance = (t: { mock: typeof mock }) => { t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); };

test('H1. one line per hit, JSON, with every field bounded: method 8, path 120, ip 64, ua 120', (t) => {
  const lines = warnLines(t);
  logHoneypotHit('admin_api', { method: 'M'.repeat(50), path: '/' + 'p'.repeat(10_000), ip: '1'.repeat(500), ua: 'u'.repeat(9_000) });
  assert.equal(lines.length, 1); const { kind, f } = parse(lines[0]);
  assert.equal(kind, 'admin_api'); assert.equal(f.method.length, 8); assert.equal(f.path.length, 120); assert.equal(f.ip.length, 64); assert.equal(f.ua.length, 120);
  assert.ok(lines[0].length < 600, `the line is ${lines[0].length} characters`);
});

test('H2. control characters in any field become spaces, so one hit can never make a second log line', (t) => {
  const lines = warnLines(t);
  logHoneypotHit('admin_page', { method: 'GE\nT', path: '/a\r\n[honeypot] admin_api {"fake":1}\u0000\u001b[31m\u007f', ip: '1.2.3.4\n5', ua: 'x\ty\n\rz' });
  assert.equal(lines.length, 1); assert.equal(/[\u0000-\u001f\u007f]/.test(lines[0]), false, 'a control character is in the log line'); assert.equal(lines[0].split('\n').length, 1);
  const { f } = parse(lines[0]); assert.equal(f.method, 'GE T'); assert.equal(f.ip, '1.2.3.4 5'); assert.equal(f.ua, 'x y  z');
});

test('H3. missing fields log as empty strings, and null/undefined never throw', (t) => {
  const lines = warnLines(t);
  logHoneypotHit('admin_page', {}); logHoneypotHit('admin_page', { ip: null, ua: null });
  assert.equal(lines.length, 2); assert.deepEqual(parse(lines[0]).f, { method: '', path: '', ip: '', ua: '' });
});

test('H4. the global cap: 200 hits in one minute log exactly 120 lines; a minute later it logs again', (t) => {
  advance(t); const lines = warnLines(t);
  t.mock.timers.setTime(1_900_000_000_000);
  for (let i = 0; i < 200; i++) logHoneypotHit('admin_api', { method: 'GET', path: `/api/admin/${i}`, ip: '9.9.9.9', ua: 'scanner' });
  assert.equal(lines.length, 120, 'the cap is 120 a minute'); assert.equal(parse(lines[0]).f.path, '/api/admin/0'); assert.equal(parse(lines[119]).f.path, '/api/admin/119');
  t.mock.timers.setTime(1_900_000_000_000 + 61_000);
  logHoneypotHit('admin_api', { method: 'GET', path: '/again', ip: '9.9.9.9', ua: 'scanner' }); assert.equal(lines.length, 121, 'the window did not reopen');
});

test('H5. the cap is GLOBAL, not per IP: 200 different IPs still log 120 lines', (t) => {
  advance(t); const lines = warnLines(t);
  t.mock.timers.setTime(1_910_000_000_000);
  for (let i = 0; i < 200; i++) logHoneypotHit('admin_api', { method: 'GET', path: '/x', ip: `203.0.113.${i}`, ua: 'a' });
  assert.equal(lines.length, 120);
});

test('H6. /api/admin/* answers 404 with the SAME body for every method and any path length, writes nothing to any network, and logs one bounded line', async (t) => {
  advance(t); const lines = warnLines(t);
  t.mock.timers.setTime(1_920_000_000_000);
  const calls: string[] = []; t.mock.method(globalThis, 'fetch', async (u: unknown) => { calls.push(String(u)); throw new Error('no network is allowed'); });
  const long = 'http://localhost/api/admin/' + 'a'.repeat(10_000);
  const bodies = new Set<string>();
  for (const [name, h] of Object.entries({ GET: adminApi.GET, POST: adminApi.POST, PUT: adminApi.PUT, PATCH: adminApi.PATCH, DELETE: adminApi.DELETE })) {
    const res = await h(new Request(long, { method: name, headers: { 'user-agent': 'sqlmap/1.7', 'x-forwarded-for': '203.0.113.9' } }));
    assert.equal(res.status, 404, name); bodies.add(await res.text());
  }
  assert.equal(bodies.size, 1, 'the answer differs between methods'); assert.deepEqual(JSON.parse([...bodies][0]), { error: 'Not found' });
  const bare = await adminApi.GET(new Request('http://localhost/api/admin')); assert.equal(bare.status, 404);
  assert.deepEqual(calls, [], 'the decoy made a network or database call');
  assert.equal(lines.length, 6); for (const l of lines) { const { kind, f } = parse(l); assert.equal(kind, 'admin_api'); assert.ok(f.path.length <= 120); }
  assert.equal(parse(lines[0]).f.ip, '203.0.113.9'); assert.equal(parse(lines[0]).f.ua, 'sqlmap/1.7');
});

test('H7. source guard: neither the catch-all route nor the /admin page (nor lib/honeypot.ts) can reach the audit table or the service-role client', () => {
  const files = ['app/api/admin/[[...path]]/route.ts', 'app/(main)/admin/page.tsx', 'lib/honeypot.ts'];
  for (const f of files) { const s = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); for (const bad of ['admin_audit_log', 'getSupabaseAdmin', 'supabase-admin', 'adminAudit', '.insert(']) assert.equal(s.includes(bad), false, `${f} names ${bad}`); }
  assert.ok(readFileSync(new URL('../app/(main)/admin/page.tsx', import.meta.url), 'utf8').includes('notFound()'), 'the page no longer 404s');
  assert.ok(readFileSync(new URL('../app/(main)/admin/page.tsx', import.meta.url), 'utf8').includes("logHoneypotHit('admin_page'"), 'the page does not log through the bounded helper');
});
