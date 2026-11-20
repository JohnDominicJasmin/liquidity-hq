/* QA: PR #2740 (#1651), the SAME rule on the server's own kill-switch read. NOT FIXED BY THE PR (the PR changes /api/config only), so this file is RED on the PR head and is a FINDING for Dev, not a pin to merge as it stands.
 *
 * THE WRITTEN RULE (PM priority): a kill switch must never turn itself off because a read failed. /api/config now answers the last known state on a DB error. lib/featureFlags.ts is the read the SERVER ROUTES themselves enforce the switches with (POST /api/grok and /api/grok-chat answer 503 FEATURE_DISABLED from `isFeatureEnabled('grok')`; telegram, signups and structure_alerts read it too): it destructures `{ data: row }` and never looks at `error`, so a failed read is `row` null, and every flag falls to DEFAULTS (grok ON) for 15 s. The page would show the AI switched OFF (config route: last known) while the server answers the paid AI route as ENABLED.
 *   FF1  a good read with grok OFF, then a failed read (HTTP 500 and a network error): isFeatureEnabled('grok') must stay false (the last known), not the default true
 *   FF2  a process that never read: the default (grok true, structure_alerts false) - the documented fail-open / fail-closed split stays as it is
 * THE REAL lib/featureFlags.ts RUNS; only the network is a stand-in. */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const net = { mode: 'ok' as 'ok' | 'http500' };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.host !== 'supabase.invalid') throw new Error(`stray request ${url.host}`);
  if (net.mode === 'http500') return json(500, { code: 'XX000', message: 'stand-in: db down', details: '', hint: '' });
  return json(200, [{ value: { grok: false, telegram: true, signups: true, structure_alerts: true } }]);
}) as typeof fetch;
mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
mock.method(console, 'error', () => {});
const { isFeatureEnabled, getFeatureFlags } = await import('../lib/featureFlags.ts');

test('FF2. NEVER READ: a failed read answers the documented defaults (grok ON, structure_alerts OFF)', async () => {
  net.mode = 'http500';
  assert.equal(await isFeatureEnabled('grok'), true); assert.equal(await isFeatureEnabled('structure_alerts'), false);
});

test('FF1. after a good read with grok OFF, a failed read must keep grok OFF (it answers the default ON, so the paid AI route is enabled while the switch is off)', async () => {
  net.mode = 'ok'; mock.timers.tick(15_100);
  const good = await getFeatureFlags(); assert.equal(good.grok, false);
  net.mode = 'http500'; mock.timers.tick(15_100);
  assert.equal(await isFeatureEnabled('grok'), false, 'a failed read turned the grok kill switch back ON (the server enforces it from this read)');
});
