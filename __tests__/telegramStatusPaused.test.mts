/* #2481: Settings > Telegram says "Paused · Pro needed" for a linked chat whose Pro lapsed. THE REAL /api/telegram/status ROUTE runs with a stand-in network (auth user, the settings row, the subscription row).
 *   P1  a LAPSED Pro (role pro, paid period over, no trial) with a linked chat: { configured: true, paused: true }
 *   P2  an active Pro: { configured: true } and NO paused key; an active TRIAL on a free row: the same
 *   P3  a plain Free account with a linked chat is paused too (alerts are Pro only; nothing is sent)
 *   P4  the plan read FAILS (500): { configured: true } and no paused - we say nothing we do not know
 *   P5  no chat linked: { configured: false }, and the subscription is not even read
 *   P6  the page maps paused -> the paused label and keeps the Manage link (source pin)
 * WHAT IT CANNOT PROVE: the rendered Settings row, or that the DB label row exists (a migration, applied by PM). */
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
process.env.TELEGRAM_BOT_TOKEN = 'qa-bot-token';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const UID = '11111111-1111-4111-8111-111111111111';
const day = 86_400_000;
const db = { chat: '555' as string | null, sub: null as null | { role: string; trial_ends_at: string | null; current_period_end: string | null }, subFails: false, subReads: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url); const p = url.pathname;
  if (url.origin !== SUPABASE) throw new Error(`stray request ${req.url}`);
  if (p === '/auth/v1/user') return json(200, { id: UID, email: 'qa@example.test', aud: 'authenticated', role: 'authenticated' });
  const obj = (row: unknown) => ((req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? (row == null ? json(406, { code: 'PGRST116', message: 'no rows', details: '', hint: '' }) : json(200, row)) : json(200, row == null ? [] : [row]));
  if (p.endsWith('user_settings')) return obj(db.chat === null ? null : { telegram_chat_id: db.chat });
  if (p.endsWith('user_subscriptions')) { db.subReads++; if (db.subFails) return json(500, { code: 'XX000', message: 'boom', details: '', hint: '' }); return obj(db.sub); }
  return json(200, []);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });
const { GET } = await import('../app/api/telegram/status/route.ts');
const status = async () => { const r = await GET(new NextRequest('http://localhost/api/telegram/status', { headers: { Authorization: 'Bearer qa-user-token' } })); return { code: r.status, body: await r.json() as Record<string, unknown> }; };
beforeEach(() => { db.chat = '555'; db.sub = null; db.subFails = false; db.subReads = 0; });

test('P1. a lapsed Pro with a linked chat is paused', async () => {
  db.sub = { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() - 3 * day).toISOString() };
  const r = await status(); assert.equal(r.code, 200); assert.deepEqual(r.body, { configured: true, paused: true });
});

test('P2. an active Pro, and an active trial, are NOT paused (the key is absent, not false)', async () => {
  db.sub = { role: 'pro', trial_ends_at: null, current_period_end: new Date(Date.now() + 20 * day).toISOString() };
  assert.deepEqual((await status()).body, { configured: true });
  db.sub = { role: 'free', trial_ends_at: new Date(Date.now() + 2 * day).toISOString(), current_period_end: null };
  assert.deepEqual((await status()).body, { configured: true });
});

test('P3. a plain Free account with a linked chat is paused', async () => {
  db.sub = { role: 'free', trial_ends_at: null, current_period_end: null };
  assert.deepEqual((await status()).body, { configured: true, paused: true });
});

test('P4. an unreadable plan says nothing about pausing', async () => {
  db.subFails = true;
  const r = await status(); assert.equal(r.code, 200); assert.deepEqual(r.body, { configured: true }, 'a failed plan read must not be reported as paused');
});

test('P5. no chat linked: not configured, and the plan is never read', async () => {
  db.chat = null; db.sub = { role: 'free', trial_ends_at: null, current_period_end: null };
  const r = await status(); assert.deepEqual(r.body, { configured: false }); assert.equal(db.subReads, 0, 'the subscription was read for an account with nothing linked');
});

test('P6. the Settings page turns paused into the paused label and still offers Manage', () => {
  const src = readFileSync(new URL('../app/(main)/settings/page.tsx', import.meta.url), 'utf8');
  assert.match(src, /d\.configured \? \(d\.paused === true \? 'paused' : 'configured'\) : 'not_configured'/, 'only paused === true may pause (anything else is configured)');
  assert.match(src, /tgStatus === 'paused'\s*\? t\('SETTINGS_TG_PAUSED_PRO'\)/);
  assert.match(src, /tgStatus === 'configured' \|\| tgStatus === 'paused' \? t\('SETTINGS_TG_MANAGE_LINK'\)/, 'a paused account must still reach Manage alerts (to upgrade)');
});
