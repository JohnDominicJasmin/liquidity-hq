import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorld, installFakeFetch, loadModule } from '../telegramWorld.mjs';

/* #2335 (S7 + S10): the REAL /api/ops/users/[id] PATCH and /api/ops/config PATCH in-process against the fake network of qa/telegramWorld.mjs (no real account is touched).
 * S7: staff cannot ban or unban an admin (an ACTIVE admin_users row, or an ADMIN_EMAILS bootstrap owner); an owner can; staff can still ban an ordinary account; a failed admin lookup fails CLOSED.
 * S10: the audit insert's error is checked: the action still answers 200 but with auditLogged:false, the failure is reported by ACTION NAME and never with the row's content; before-state is in the detail.
 * Fake Auth answers /auth/v1/user for the opaque tokens below and the admin API (GET/PUT /auth/v1/admin/users/<id>); the ban is a PUT with ban_duration, recorded.
 * NOT covered: the real database (RLS, the audit table's columns), the team routes' own cells (one source guard covers them), and a real ban email (no BREVO key in the harness). */

const USERS: Record<string, { id: string; email: string }> = {
  'tok-owner': { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.test' }, 'tok-staff': { id: '00000000-0000-4000-8000-000000000002', email: 'staff@example.test' },
  'tok-boot': { id: '00000000-0000-4000-8000-000000000005', email: 'boot@example.test' }, 'tok-staff2': { id: '00000000-0000-4000-8000-000000000003', email: 'staff2@example.test' },
};
const EMAILS: Record<string, string> = { '00000000-0000-4000-8000-000000000001': 'owner@example.test', '00000000-0000-4000-8000-000000000002': 'staff@example.test', '00000000-0000-4000-8000-000000000003': 'staff2@example.test', '00000000-0000-4000-8000-000000000004': 'gone@example.test', '00000000-0000-4000-8000-000000000005': 'boot@example.test', '00000000-0000-4000-8000-000000000006': 'user@example.test', '00000000-0000-4000-8000-000000000007': 'banned@example.test' };
const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

async function scenario(o: { auditFails?: boolean; targetLookupFails?: string; app?: unknown[] } = {}) {
  process.env.ADMIN_EMAILS = 'boot@example.test';
  const w = makeWorld({ tables: {
    lhq_admin_users: [
      { user_id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.test', role: 'owner', active: true }, { user_id: '00000000-0000-4000-8000-000000000002', email: 'staff@example.test', role: 'staff', active: true },
      { user_id: '00000000-0000-4000-8000-000000000003', email: 'staff2@example.test', role: 'staff', active: true }, { user_id: '00000000-0000-4000-8000-000000000004', email: 'gone@example.test', role: 'staff', active: false },
    ],
    lhq_user_subscriptions: [{ user_id: '00000000-0000-4000-8000-000000000006', role: 'free', ban_reason: null, billing_provider: null }, { user_id: '00000000-0000-4000-8000-000000000007', role: 'free', ban_reason: 'abuse of the AI limits', billing_provider: null }, { user_id: '00000000-0000-4000-8000-000000000001', role: 'pro', ban_reason: null, billing_provider: 'whop' }],
    lhq_app_config: o.app ?? [], lhq_admin_audit_log: [],
  } }) as ReturnType<typeof makeWorld> & { bans: Array<{ id: string; ban_duration: string }> };
  w.bans = [];
  installFakeFetch(w);
  const inner = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const u = new URL(String(input?.url ?? input)); const method = (init?.method ?? 'GET').toUpperCase();
    if (u.host === 'stub.supabase.test') {
      if (u.pathname === '/auth/v1/user') {
        const tok = String(init?.headers?.Authorization ?? init?.headers?.authorization ?? new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer\s+/i, '');
        const usr = USERS[tok]; return usr ? j({ ...usr, aud: 'authenticated', role: 'authenticated' }) : j({ message: 'invalid JWT' }, 401);
      }
      const m = /^\/auth\/v1\/admin\/users\/([^/]+)$/.exec(u.pathname);
      if (m) {
        if (method === 'PUT') { w.bans.push({ id: m[1], ban_duration: JSON.parse(init.body).ban_duration }); return j({ id: m[1], email: EMAILS[m[1]] ?? null }); }
        return EMAILS[m[1]] ? j({ id: m[1], email: EMAILS[m[1]], aud: 'authenticated' }) : j({ message: 'User not found' }, 404);
      }
      if (u.pathname === '/rest/v1/lhq_admin_audit_log' && method === 'POST' && o.auditFails) return j({ message: 'audit insert refused' }, 500);
      if (o.targetLookupFails && u.pathname === '/rest/v1/lhq_admin_users' && u.search.includes(`user_id=eq.${o.targetLookupFails}`)) return j({ message: 'lookup failed' }, 500);
    }
    return inner(input, init);
  };
  const users = await loadModule('app/api/ops/users/[id]/route.ts');
  const config = await loadModule('app/api/ops/config/route.ts');
  const patch = async (token: string, id: string, body: unknown) => {
    const res = await users.PATCH(new Request(`http://localhost/api/ops/users/${id}`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const saveConfig = async (token: string, body: unknown) => {
    const res = await config.PATCH(new Request('http://localhost/api/ops/config', { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const audit = () => w.tables.lhq_admin_audit_log as Array<{ action: string; actor_email: string; target_user_id: string | null; detail: Record<string, unknown> }>;
  return { w, patch, saveConfig, audit };
}

test('B1. STAFF cannot ban or unban an owner, another staff or a bootstrap owner: 403, no ban call, no audit row', async () => {
  const { w, patch, audit } = await scenario();
  for (const target of ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005']) for (const action of ['ban', 'unban']) {
    const r = await patch('tok-staff', target, { action, reason: 'x' });
    assert.equal(r.status, 403, `${action} ${target}`); assert.match(r.body.error, /Only an owner/);
  }
  assert.deepEqual(w.bans, [], 'a ban call went out'); assert.deepEqual(audit(), [], 'an audit row was written for a refused action');
});

test('B2. an OWNER can ban and unban an owner, a staff and a bootstrap owner; the ban call carries the duration', async () => {
  const { w, patch, audit } = await scenario();
  for (const target of ['00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005']) { assert.equal((await patch('tok-owner', target, { action: 'ban', reason: 'r' })).status, 200, `ban ${target}`); assert.equal((await patch('tok-owner', target, { action: 'unban' })).status, 200, `unban ${target}`); }
  assert.deepEqual(w.bans.map((b) => `${b.id}:${b.ban_duration}`), ['00000000-0000-4000-8000-000000000003:876000h', '00000000-0000-4000-8000-000000000003:none', '00000000-0000-4000-8000-000000000005:876000h', '00000000-0000-4000-8000-000000000005:none']);
  assert.equal(audit().filter((a) => a.action === 'user_ban' || a.action === 'user_unban').length, 4);
});

test('B3. staff can still ban and unban an ORDINARY account, and an admin row that is INACTIVE is not protected', async () => {
  const { w, patch } = await scenario();
  assert.equal((await patch('tok-staff', '00000000-0000-4000-8000-000000000006', { action: 'ban', reason: 'spam' })).status, 200);
  assert.equal((await patch('tok-staff', '00000000-0000-4000-8000-000000000007', { action: 'unban' })).status, 200);
  assert.equal((await patch('tok-staff', '00000000-0000-4000-8000-000000000004', { action: 'ban', reason: 'x' })).status, 200, 'an inactive admin row is treated as an ordinary account');
  assert.deepEqual(w.bans.map((b) => b.id), ['00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000004']);
});

test('B4. FAILS CLOSED: when the admin lookup for the target fails, staff is refused (403) and nothing is banned', async () => {
  const { w, patch } = await scenario({ targetLookupFails: '00000000-0000-4000-8000-000000000006' });
  assert.equal((await patch('tok-staff', '00000000-0000-4000-8000-000000000006', { action: 'ban', reason: 'x' })).status, 403);
  assert.deepEqual(w.bans, []);
});

test('B5. what did NOT change: self-ban is 400, an unknown action 400, and a non-ban action on an admin by staff is still allowed (the guard is ban/unban only)', async () => {
  const { patch } = await scenario();
  assert.equal((await patch('tok-owner', '00000000-0000-4000-8000-000000000001', { action: 'ban' })).status, 400);
  assert.equal((await patch('tok-staff', '00000000-0000-4000-8000-000000000006', { action: 'nope' })).status, 400);
  assert.equal((await patch('tok-staff', '00000000-0000-4000-8000-000000000001', { action: 'reset_ai_limit' })).status, 200, 'reset_ai_limit on an owner by staff (unchanged by this PR)');
});

test('B6. S10 before-state: a ban row records reason and previous state; an unban row records cleared_reason with the reason it removed', async () => {
  const { patch, audit } = await scenario();
  assert.equal((await patch('tok-staff', '00000000-0000-4000-8000-000000000006', { action: 'ban', reason: 'spam in chat' })).body.auditLogged, true);
  assert.equal((await patch('tok-staff', '00000000-0000-4000-8000-000000000007', { action: 'unban' })).body.auditLogged, true);
  const ban = audit().find((a) => a.action === 'user_ban')!; const unban = audit().find((a) => a.action === 'user_unban')!;
  assert.equal(ban.actor_email, 'staff@example.test'); assert.equal(ban.target_user_id, '00000000-0000-4000-8000-000000000006');
  assert.equal(ban.detail.reason, 'spam in chat'); assert.equal(ban.detail.previous_role, 'free'); assert.equal(ban.detail.previous_ban_reason, null); assert.equal(ban.detail.emailSent, false);
  assert.equal(unban.detail.cleared_reason, 'abuse of the AI limits'); assert.equal(unban.detail.previous_ban_reason, 'abuse of the AI limits');
});

test('B7. S10 checked audit: when the audit insert FAILS the ban still happens, the answer is 200 with auditLogged:false, and the report names the action but never the row content', async (t) => {
  const { w, patch } = await scenario({ auditFails: true });
  const logged: string[] = []; t.mock.method(console, 'error', (...a: unknown[]) => { logged.push(a.map(String).join(' ')); });
  const r = await patch('tok-staff', '00000000-0000-4000-8000-000000000006', { action: 'ban', reason: 'SECRET-REASON-123' });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.auditLogged, false); assert.equal(w.bans.length, 1, 'the ban itself was made');
  const line = logged.find((l) => l.includes('ops/audit-log')); assert.ok(line, `no failure was reported: ${logged.join(' | ')}`); assert.match(line!, /user_ban/);
  assert.equal(logged.join(' ').includes('SECRET-REASON-123'), false, 'the row content leaked into the failure report');
});

test('B8. S10 on config: a save records previous (the stored value, or null on a first save) and says auditLogged; a failed audit insert is false, not hidden', async () => {
  const first = await scenario();
  const a = await first.saveConfig('tok-owner', { key: 'announcement_banner', value: { text: 'one', link: null, expiresAt: null } });
  assert.equal(a.status, 200); assert.equal(a.body.auditLogged, true); assert.equal(first.audit()[0].detail.previous, null);
  const second = await scenario({ app: [{ key: 'announcement_banner', value: { text: 'old' } }] });
  await second.saveConfig('tok-owner', { key: 'announcement_banner', value: { text: 'new', link: null, expiresAt: null } });
  assert.deepEqual(second.audit()[0].detail.previous, { text: 'old' }); assert.equal(second.audit()[0].action, 'config_announcement_banner');
  const failing = await scenario({ auditFails: true }); const f = await failing.saveConfig('tok-owner', { key: 'maintenance_mode', value: { enabled: false } });
  assert.equal(f.status, 200); assert.equal(f.body.auditLogged, false);
  assert.equal((await failing.saveConfig('tok-staff', { key: 'maintenance_mode', value: { enabled: true } })).status, 403, 'config stays owner-only');
});

test('B9. source guard: no admin_audit_log insert in app/api/ops bypasses writeAdminAudit (the team and honeypot writers included)', () => {
  const bad: string[] = [];
  const walk = (dir: string) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(n)) { const s = readFileSync(p, 'utf8'); if (/admin_audit_log\)\s*\.insert|admin_audit_log\)\.insert/.test(s)) bad.push(p.split('\\').join('/')); } } };
  walk('app/api/ops');
  assert.deepEqual(bad, [], 'a route still inserts into the audit log without checking the result');
  for (const f of ['app/api/ops/users/[id]/route.ts', 'app/api/ops/config/route.ts', 'app/api/ops/team/route.ts', 'app/api/ops/team/[id]/route.ts']) assert.ok(readFileSync(f, 'utf8').includes('writeAdminAudit('), `${f} does not call writeAdminAudit`);
});
