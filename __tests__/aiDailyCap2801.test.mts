/* QA: PR #2801 (#1632 owner item 4), part of the daily AI call cap is kept for Pro and the owner is emailed when a site-wide AI cap refuses calls. The REAL incrementUsageColumn, spendCapBlock, alertAiCapTrip and mail
 * sender run; only the network is a stand-in (PostgREST and Brevo). Nothing leaves the machine and no AI is called.
 *   C1 the share: Pro keeps the whole cap, free and trial get 70% of it (at least 1), no cap stays no cap
 *   C2 the database reserve is sent that number as p_global_limit
 *   C3 a -1 answer (the global cap) emails: free_global wording for free and trial, whole-cap wording for Pro; the dollar fuse emails its own wording; the user answer is unchanged
 *   C4 once per cap per UTC day: the same day sends once, a mark already stored sends nothing, a failed send is retried only after 10 minutes
 *   C5 without the mail settings nothing is read and nothing is sent
 * WHAT IT CANNOT PROVE: the SQL rollback inside increment_ai_usage, or a real Brevo delivery. */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_APP_ENV = 'dev';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://stand-in.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_stand_in_key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_stand_in_key';
process.env.AI_GLOBAL_DAILY_MAX = '10';
process.env.BREVO_API_KEY = 'brevo_stand_in_key';
process.env.BREVO_SENDER_EMAIL = 'ops@stand-in.invalid';
process.env.SPIKE_ALERT_RECIPIENTS = 'recipient@stand-in.invalid';

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const world = { reserve: 1 as number | null, siteSpend: 0, state: null as null | Record<string, string>, brevoStatus: 201 };
const reserves: Array<Record<string, unknown>> = [];
const mails: Array<{ subject: string; htmlContent: string; to: Array<{ email: string }> }> = [];
let stateReads = 0;
const unexpected: string[] = [];

globalThis.fetch = (async (input: unknown, init: { method?: string; body?: unknown } = {}) => {
  const url = new URL(String((input as { url?: string })?.url ?? input));
  const method = (init.method ?? 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  if (url.host === 'api.brevo.com') { mails.push(body); return respond({}, world.brevoStatus); }
  const p = url.pathname;
  if (p.endsWith('/rpc/increment_ai_usage')) { reserves.push(body); return respond(world.reserve); }
  if (p.endsWith('/rpc/increment_global_ai_usage')) return respond(world.reserve);
  if (p.endsWith('/rpc/lhq_ai_spend_user_since')) return respond([{ cost: 0, null_search: 0, null_other: 0 }]);
  if (p.endsWith('/rpc/lhq_ai_spend_all_since')) return respond([{ cost: world.siteSpend, null_search: 0, null_other: 0 }]);
  if (p.endsWith('app_config')) {
    const key = url.searchParams.get('key');
    if (method !== 'GET') { if (body?.key === 'ai_cap_alert_state' || body?.[0]?.key === 'ai_cap_alert_state') world.state = (body.value ?? body[0].value) as Record<string, string>; return new Response(null, { status: 201 }); }
    if (key === 'eq.ai_cap_alert_state') { stateReads++; return respond(world.state ? [{ value: world.state }] : []); }
    return respond([{ value: { grok: true } }]);
  }
  if (p.includes('api_health')) return new Response(null, { status: 201 });
  unexpected.push(`${method} ${url.host}${p}`);
  return respond([]);
}) as typeof fetch;

const { globalCapFor, incrementUsageColumn, rateLimitMessage } = await import('../lib/aiUsage.ts');
const { alertAiCapTrip } = await import('../lib/aiCapAlert.ts');

const UID = '00000000-0000-4000-8000-0000000000a1';
const settle = async (want: number) => { for (let i = 0; i < 100 && mails.length < want; i++) await new Promise((r) => setTimeout(r, 20)); await new Promise((r) => setTimeout(r, 60)); };
const reserve = (tier: 'free' | 'trial' | 'pro') => incrementUsageColumn(UID, tier, 'grok_count', 100, null);
const today = new Date().toISOString().slice(0, 10);

test('C1. Pro keeps the whole daily cap; free and trial get 70% of it, at least 1; no cap stays no cap', () => {
  assert.deepEqual([globalCapFor('free', 10), globalCapFor('trial', 10), globalCapFor('pro', 10)], [7, 7, 10]);
  assert.deepEqual([globalCapFor('free', 1000), globalCapFor('free', 15), globalCapFor('free', 1)], [700, 10, 1]);
  assert.deepEqual([globalCapFor('free', null), globalCapFor('trial', null), globalCapFor('pro', null)], [null, null, null]);
});

test('C2. the reserve is sent the tier\'s share as p_global_limit', async () => {
  for (const [tier, want] of [['free', 7], ['trial', 7], ['pro', 10]] as const) {
    reserves.length = 0; world.reserve = 1;
    assert.deepEqual(await reserve(tier), { blocked: false, count: 1 });
    assert.equal(reserves[0]?.p_global_limit, want, tier);
  }
});

test('C3. a refused call emails the owner once with the matching words, and the caller\'s answer is unchanged', async () => {
  world.reserve = -1; mails.length = 0; world.state = null;
  assert.deepEqual(await reserve('free'), { blocked: true, reason: 'global', limit: 100 });
  await settle(1);
  assert.equal(mails.length, 1, 'free reaching its share sent no email');
  assert.match(mails[0].htmlContent, /reached their share of the daily call cap[^<]*Pro calls continue/);
  assert.deepEqual(mails[0].to, [{ email: 'recipient@stand-in.invalid' }]);
  await reserve('trial'); await settle(2);
  assert.equal(mails.length, 1, 'the same cap emailed twice in one day');
  assert.deepEqual(await reserve('pro'), { blocked: true, reason: 'global', limit: 100 });
  await settle(2);
  assert.equal(mails.length, 2); assert.match(mails[1].htmlContent, /All AI calls are now refused/);
  const stored = world.state as unknown as Record<string, string> | null;
  assert.equal(stored?.global_free, today); assert.equal(stored?.global, today, 'the second mark dropped or never stored');
  world.reserve = 1; world.siteSpend = 1_000;
  const got = await reserve('free');
  assert.equal((got as { reason?: string }).reason, 'fuse');
  await settle(3);
  assert.equal(mails.length, 3); assert.match(mails[2].htmlContent, /spend fuse tripped/);
  assert.ok(rateLimitMessage('fuse', 0, 'x').length > 0);
  world.siteSpend = 0;
});

test('C4. once per cap per UTC day: a stored mark sends nothing; a failed send is retried only after 10 minutes', async () => {
  const day = Date.UTC(2030, 0, 2, 12), MIN = 60_000;
  mails.length = 0; world.state = { global: '2030-01-02' };
  await alertAiCapTrip('global', day);
  assert.equal(mails.length, 0, 'a mark stored by another instance was ignored');
  world.state = null; world.brevoStatus = 500;
  await alertAiCapTrip('fuse', day); assert.equal(mails.length, 1);
  assert.equal(world.state, null, 'a failed send was marked as sent');
  await alertAiCapTrip('fuse', day + 10 * MIN - 1); assert.equal(mails.length, 1, 'retried inside the 10 minute wait');
  world.brevoStatus = 201;
  await alertAiCapTrip('fuse', day + 10 * MIN); assert.equal(mails.length, 2, 'not retried after the wait');
  await alertAiCapTrip('fuse', day + 60 * MIN); assert.equal(mails.length, 2, 'sent twice in a day');
  await alertAiCapTrip('fuse', day + 24 * 60 * MIN); assert.equal(mails.length, 3, 'the next UTC day is a new alert');
});

test('C5. without the mail settings nothing is read and nothing is sent', async () => {
  const key = process.env.BREVO_API_KEY; delete process.env.BREVO_API_KEY;
  try {
    const reads = stateReads; mails.length = 0;
    await alertAiCapTrip('global_free', Date.UTC(2031, 0, 1));
    assert.equal(stateReads, reads); assert.equal(mails.length, 0);
  } finally { process.env.BREVO_API_KEY = key; }
});

test('C6. CONTROL: the stand-in answered everything it was asked', () => { assert.deepEqual(unexpected, []); });
