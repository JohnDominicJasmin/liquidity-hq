/* QA: PR #2810 (#1632 owner item 18), /api/health reports the database size. The REAL lib/dbSize.ts runs against a stand-in metrics page; the clock is advanced by hand.
 *   D1 the metrics line is parsed with or without labels; a missing, non-numeric or zero reading is null, never 0
 *   D2 unknown is null: a refused page, a page without the line, a network failure; the next try waits 10 minutes
 *   D3 a good read answers size, 500 MB cap and percent to one decimal, with the service key in the header only, and is cached for an hour
 *   D4 after a failed refresh the last value is still reported, and dropped once it is 24 hours old
 *   D5 the first caller waits about 2.5 s for a page that does not answer, then gets null
 * WHAT IT CANNOT PROVE: that the project's metrics page answers on a deployed server (read /api/health on qa), or the workflow's issue steps. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'qa_fixture_service_role_key_not_real';
const world = { mode: 'ok' as 'ok' | '401' | 'noLine' | 'net' | 'hang', mb: 40.14, reads: 0, auth: '' };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
  const url = new URL(String(input));
  assert.equal(`${url.origin}${url.pathname}`, 'http://supabase.invalid/customer/v1/privileged/metrics');
  assert.equal(url.search, '', 'something was put in the address');
  world.reads++; world.auth = init?.headers?.Authorization ?? '';
  if (world.mode === 'net') throw new TypeError('fetch failed');
  if (world.mode === 'hang') return new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError'))));
  if (world.mode === '401') return new Response('no', { status: 401 });
  return new Response(world.mode === 'noLine' ? '# HELP other\nother_metric 1\n' : `# HELP pg_database_size_mb size\npg_database_size_mb{supabase_project_ref="x",datname="postgres"} ${world.mb}\nother_metric 1\n`);
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });
const realNow = Date.now; let clock = Date.UTC(2026, 0, 1);
Date.now = () => clock; after(() => { Date.now = realNow; });

const { parseDbSizeMb, databaseSize, DB_CAP_MB } = await import('../lib/dbSize.ts');
const MIN = 60_000, HOUR = 60 * MIN;
const at = async (ms: number) => { clock += ms; const v = await databaseSize(clock); await new Promise((r) => setImmediate(r)); return v; };

test('D1. the line is read with or without labels; anything else is null', () => {
  assert.equal(parseDbSizeMb('pg_database_size_mb{a="b"} 40.1'), 40.1);
  assert.equal(parseDbSizeMb('x 1\npg_database_size_mb 512\ny 2'), 512);
  assert.equal(parseDbSizeMb('pg_database_size_mb 4.01e+02'), 401);
  for (const bad of ['', 'other 1', 'pg_database_size_mb NaN', 'pg_database_size_mb 0', 'pg_database_size_mb -3', 'pg_database_size_mb_total 40', '# pg_database_size_mb 40']) assert.equal(parseDbSizeMb(bad), null, JSON.stringify(bad));
});

test('D2. an unreadable page is null, and the next try waits 10 minutes', async () => {
  world.mode = '401'; assert.equal(await at(0), null); assert.equal(world.reads, 1);
  assert.equal(await at(10 * MIN - 1), null); assert.equal(world.reads, 1, 'retried inside the wait');
  world.mode = 'noLine'; assert.equal(await at(1), null); assert.equal(world.reads, 2);
  world.mode = 'net'; assert.equal(await at(10 * MIN), null); assert.equal(world.reads, 3);
});

test('D3. a good read is size, cap and percent, authenticated in the header, cached for an hour', async () => {
  world.mode = 'ok'; const v = await at(10 * MIN);
  assert.deepEqual(v, { size_mb: 40.1, cap_mb: 500, percent: 8 }); assert.equal(DB_CAP_MB, 500); assert.equal(world.reads, 4);
  assert.equal(world.auth, `Basic ${Buffer.from('service_role:qa_fixture_service_role_key_not_real').toString('base64')}`);
  world.mb = 410; assert.deepEqual(await at(HOUR - 1), v); assert.equal(world.reads, 4, 'read again inside the hour');
  await at(1); assert.equal(world.reads, 5); assert.deepEqual(await at(0), { size_mb: 410, cap_mb: 500, percent: 82 });
});

test('D4. a failed refresh keeps the last value until it is 24 hours old', async () => {
  world.mode = '401';
  assert.equal((await at(23 * HOUR))?.size_mb, 410, 'the last value was dropped early');
  assert.equal(await at(HOUR), null, 'a day old value was still reported');
});

test('D5. a page that does not answer holds the first caller about 2.5 s, no longer', async () => {
  world.mode = 'hang'; const from = process.hrtime.bigint();
  assert.equal(await at(10 * MIN), null);
  const waited = Number(process.hrtime.bigint() - from) / 1e6;
  assert.ok(waited >= 2_300 && waited < 6_000, `waited ${waited.toFixed(0)} ms`);
});
