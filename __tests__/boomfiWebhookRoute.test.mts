/* #861 Phase 1b: the BoomFi webhook SHELL (bd165777) and its migration (44f82ab6).
 *
 * The route proves a request is BoomFi's, proves it is for our organisation,
 * writes it down, and does nothing else. THE PROPERTY THAT MATTERS MOST IS THE
 * LAST ONE: it must not grant or revoke Pro. Nobody has seen a real BoomFi
 * payload, and the last time this project acted on an inferred one a successful
 * payment revoked Pro (#1422).
 *
 * THE REAL ROUTE RUNS HERE. `POST` is imported from app/api/boomfi/webhook/
 * route.ts and called with real NextRequests signed by a key generated in this
 * file. Only the network is a stand-in: `globalThis.fetch` is replaced by an
 * in-memory PostgREST that knows one table and its primary key. So the real
 * verifier, the real org check and the real supabase-js client all run, and
 * every request the route makes is seen - including one it should never make.
 *
 * NO REAL CREDENTIALS AND NO REAL DATABASE. The Supabase URL is a `.invalid`
 * host and the key is a placeholder; any request that is not for that host
 * fails the test instead of leaving the machine.
 *
 * WHAT THE STAND-IN CANNOT PROVE, and the migration tests at the bottom only
 * partly cover: that the table exists with these columns (the migration is NOT
 * APPLIED), that a real duplicate comes back as 23505 through PostgREST, and
 * that row level security really keeps anon out. Those need the database.
 *
 * COST: under a second, measured. The route's one slow import is Sentry, and it
 * is stood in for below (an earlier probe that loaded the real one took 18 s). */
import test, { after } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { configuredFlags } from '../lib/configured.ts';
import { T } from '../lib/tables.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* Sentry, stood in for. Under plain Node `import * as Sentry from '@sentry/nextjs'` has no
 * captureException (the package's Node entry is built for Next's bundler), so lib/apiError.ts
 * throws here where it reports in the app - measured: every reporting path (then a 403, and the 500s) failed with
 * "Sentry.captureException is not a function" before this was added. The stand-in records
 * the calls, which also lets R8 assert a wrong-organisation delivery IS reported. */
const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));
const sentryCalls = () => ((globalThis as unknown as { __qaSentry?: unknown[][] }).__qaSentry ??= []);

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_PEM = rsa.publicKey.export({ type: 'spki', format: 'pem' }) as string;
const ORG = 'org_qa_fixture';
const SUPABASE = 'http://supabase.invalid';

/* ── the stand-in database ─────────────────────────────────────────────── */

type Seen = { table: string; method: string; row: Record<string, unknown> | null };
const db = {
  rows: new Map<string, Record<string, unknown>>(),   // keyed by payload_hash, the migration's primary key
  seen: [] as Seen[],
  stray: [] as string[],
  failWith: null as null | { status: number; body: Record<string, unknown> },
  reset() { this.rows.clear(); this.seen = []; this.stray = []; this.failWith = null; },
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.origin !== SUPABASE || !url.pathname.startsWith('/rest/v1/')) {
    db.stray.push(`${req.method} ${req.url}`);
    throw new Error(`the route made a request outside the stand-in database: ${req.method} ${req.url}`);
  }
  const table = url.pathname.slice('/rest/v1/'.length);
  const row = req.method === 'GET' || req.method === 'HEAD' ? null : JSON.parse(await req.text()) as Record<string, unknown>;
  db.seen.push({ table, method: req.method, row });
  if (db.failWith) return json(db.failWith.status, db.failWith.body);
  if (table !== T.boomfi_webhook_events || req.method !== 'POST' || !row) return json(404, { code: 'PGRST205', message: `stand-in knows only ${T.boomfi_webhook_events}` });
  const key = String(row.payload_hash);
  if (db.rows.has(key)) return json(409, { code: '23505', message: 'duplicate key value violates unique constraint', details: `Key (payload_hash)=(${key}) already exists.`, hint: null });
  db.rows.set(key, row);
  return json(201, { payload_hash: key });
}) as typeof fetch;

/* ── loading the route: its two settings are read at module scope ───────── */

const ENV_KEYS = ['BOOMFI_WEBHOOK_PUBLIC_KEY', 'BOOMFI_ORG_ID', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const savedEnv = ENV_KEYS.map((k) => [k, process.env[k]] as const);
after(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of savedEnv) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

type Post = (req: NextRequest) => Promise<Response>;
type EnvOver = Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let seq = 0;
function applyEnv(over: EnvOver = {}) {
  const env: Record<string, string | undefined> = {
    BOOMFI_WEBHOOK_PUBLIC_KEY: PUBLIC_PEM, BOOMFI_ORG_ID: ORG,
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE, SUPABASE_SERVICE_ROLE_KEY: 'qa-placeholder-not-a-key', ...over,
  };
  for (const k of ENV_KEYS) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
}
/** Every test starts here: empty stand-in, baseline settings. The key and org id are captured by
 *  the route at import, but the Supabase settings are read at CALL time - a test that unset one
 *  and did not put it back broke the tests after it on the first run of this file. */
function fresh() { db.reset(); sentryCalls().length = 0; applyEnv(); }
async function loadRoute(over: EnvOver = {}): Promise<{ POST: Post; exports: string[] }> {
  applyEnv(over);
  const mod = await import(`../app/api/boomfi/webhook/route.ts?qa=${Date.now()}-${seq++}`);
  return { POST: mod.POST as Post, exports: Object.keys(mod) };
}

const nowS = () => Math.floor(Date.now() / 1000);
const sign = (ts: string, body: string, key: crypto.KeyObject = rsa.privateKey) =>
  crypto.sign('RSA-SHA256', Buffer.from(`${ts}.${body}`, 'utf8'), { key, padding: crypto.constants.RSA_PKCS1_PADDING }).toString('base64');

function request(body: string, opts: { ts?: string; sig?: string | null; omitTs?: boolean } = {}): NextRequest {
  const ts = opts.ts ?? String(nowS());
  const headers: Record<string, string> = {};
  if (!opts.omitTs) headers['x-boomfi-timestamp'] = ts;
  const sig = opts.sig === undefined ? sign(ts, body) : opts.sig;
  if (sig !== null) headers['x-boomfi-signature'] = sig;
  return new NextRequest('http://localhost/api/boomfi/webhook', { method: 'POST', body, headers });
}
const event = (over: Record<string, unknown> = {}) => JSON.stringify({ event: 'Payment.Updated', id: 'pay_fixture_1', status: 'Succeeded', org_id: ORG, customer: { email: 'payer@example.test' }, ...over });
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const route = await loadRoute();

/* ══ The happy path, and what it does NOT do ══ */

test('R1. a verified delivery for our organisation is written down whole - and the answer says out loud that nothing was unlocked', async () => {
  fresh();
  // Leading and trailing whitespace on purpose: the RAW bytes then differ from any re-serialised
  // copy, so a hash or a signature check computed over the parsed body cannot pass by coincidence.
  const body = `  ${event()}\n`;
  assert.notEqual(body, JSON.stringify(JSON.parse(body)));
  const res = await route.POST(request(body));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true, recorded: true, ignored: 'entitlement_not_implemented' });

  assert.equal(db.seen.length, 1, `expected exactly one database request, saw ${db.seen.length}`);
  const [{ table, method, row }] = db.seen;
  assert.equal(method, 'POST');
  assert.equal(table, T.boomfi_webhook_events);
  assert.deepEqual(Object.keys(row!).sort(), ['body', 'event', 'payload_hash', 'resource_id', 'resource_status']);
  assert.equal(row!.payload_hash, sha256(body), 'the replay key is not the SHA-256 of the raw body');
  assert.equal(row!.event, 'Payment.Updated');
  assert.equal(row!.resource_id, 'pay_fixture_1');
  assert.equal(row!.resource_status, 'Succeeded');
  assert.deepEqual(row!.body, JSON.parse(body), 'the stored body is not the delivery, whole');
});

test('R2. the same delivery sent again - re-signed with a NEW timestamp, as BoomFi does - is answered 200 "replay" and stored once', async () => {
  fresh();
  const body = event({ id: 'pay_fixture_2' });
  const first = await route.POST(request(body, { ts: String(nowS() - 5) }));
  assert.equal((await first.json()).recorded, true);
  const again = await route.POST(request(body, { ts: String(nowS()) }));
  assert.equal(again.status, 200, 'a repeat must be 2xx or BoomFi marks a delivery we already hold as failed');
  assert.deepEqual(await again.json(), { received: true, ignored: 'replay' });
  assert.equal(db.rows.size, 1);
});

test('R3. a body that differs by one byte is a different delivery, not a replay', async () => {
  fresh();
  await route.POST(request(event({ id: 'pay_a' })));
  const other = await route.POST(request(event({ id: 'pay_b' })));
  assert.equal((await other.json()).recorded, true);
  assert.equal(db.rows.size, 2);
});

test('R4. fields that are not strings are stored as null, never coerced - the whole body beside them still has the truth', async () => {
  fresh();
  const body = event({ event: 42, id: { nested: true }, status: null });
  const res = await route.POST(request(body));
  assert.equal(res.status, 200);
  const row = db.seen[0].row!;
  assert.equal(row.event, null);
  assert.equal(row.resource_id, null);
  assert.equal(row.resource_status, null);
  assert.deepEqual(row.body, JSON.parse(body));
});

/* ══ Refusals: nothing is stored, and nothing is said about why ══ */

test('R5. every verification failure is a 401 with ONE body, and nothing reaches the database', async () => {
  fresh();
  const body = event({ id: 'pay_refused' });
  const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const stale = String(nowS() - 1000);
  const cases: Array<[string, NextRequest]> = [
    ['signature from another key', request(body, { sig: sign(String(nowS()), body, otherKey) })],
    ['garbage signature', request(body, { sig: 'AAAA' })],
    ['no signature header', request(body, { sig: null })],
    ['no timestamp header', request(body, { omitTs: true })],
    ['stale timestamp, validly signed', request(body, { ts: stale })],
    ['timestamp that is not digits', request(body, { ts: '1e9', sig: sign('1e9', body) })],
    ['body changed after signing', request(body.replace('pay_refused', 'pay_forged'), { sig: sign(String(nowS()), body) })],
    ['unsigned, empty body', request('', { sig: null })],
  ];
  const answers: string[] = [];
  for (const [what, req] of cases) {
    const res = await route.POST(req);
    assert.equal(res.status, 401, `${what}: expected 401, got ${res.status}`);
    answers.push(JSON.stringify(await res.json()));
  }
  assert.deepEqual([...new Set(answers)], ['{"error":"Invalid signature"}'], 'the 401 body differs by failure - it tells a caller which check they got past');
  assert.equal(db.seen.length, 0, `a refused request reached the database: ${JSON.stringify(db.seen)}`);
});

test('R6. with no public key configured every delivery is refused - even a correctly signed one', async () => {
  fresh();
  for (const key of [undefined, '', '   ']) {
    const r = await loadRoute({ BOOMFI_WEBHOOK_PUBLIC_KEY: key });
    const res = await r.POST(request(event()));
    assert.equal(res.status, 401, `BOOMFI_WEBHOOK_PUBLIC_KEY=${JSON.stringify(key)}`);
  }
  assert.equal(db.seen.length, 0);
});

test('R7. verified but not a JSON object is a 400 and is not stored', async () => {
  fresh();
  for (const body of ['not json', '', '[]', '"a string"', 'null', '42', 'true', '[{"org_id":"' + ORG + '"}]']) {
    const res = await route.POST(request(body));
    assert.equal(res.status, 400, `body ${JSON.stringify(body)}: expected 400, got ${res.status}`);
  }
  assert.equal(db.seen.length, 0);
});

/* THE ORGANISATION CHECK RUNS AFTER THE WRITE (9feedebf), and that is deliberate: nobody
   has seen what BoomFi puts in org_id, and refusing before recording would discard the one
   body that shows the right value. So a verified event for the wrong organisation is
   stored, REPORTED, and answered with its own reason - never the reason a matching event
   gets. When the entitlement half is written, "org_mismatch" is the branch that must grant
   nothing; R8 and R9 are the tests that have to keep passing that day. */

test('R8. verified, but for another organisation or none: recorded, REPORTED, and answered "org_mismatch" - never the answer a matching event gets', async (t) => {
  fresh();
  const logged = t.mock.method(console, 'error', () => {});
  const bodies = [
    event({ id: 'org_a', org_id: 'org_someone_else' }),
    JSON.stringify({ event: 'Payment.Updated', id: 'org_b' }),
    event({ id: 'org_c', org_id: ORG + '_suffix' }),
    event({ id: 'org_d', org_id: 'org_someone_else', org: { id: ORG } }),
  ];
  for (const body of bodies) {
    const res = await route.POST(request(body));
    assert.equal(res.status, 200, `body ${body}`);
    assert.deepEqual(await res.json(), { received: true, recorded: true, ignored: 'org_mismatch' });
  }
  assert.equal(db.rows.size, 4, 'a mismatched event was not written down - the body that shows the real org id would be lost');
  assert.equal(sentryCalls().length, 4, 'each wrong-organisation delivery must be reported to error tracking');
  assert.equal(logged.mock.callCount(), 4);
  const message = String(logged.mock.calls[0].arguments[0]);
  assert.ok(message.includes('org_id=org_someone_else'), `the report does not quote the org id that arrived, which is the whole reason it is recorded: ${message}`);
  assert.ok(message.includes('BOOMFI_ORG_ID=set'), message);
  assert.equal(message.includes('payer@example.test'), false, 'the report carries the payer\'s email');
});

test('R8b. CONTROL: a matching organisation is not reported and does not answer "org_mismatch"', async (t) => {
  fresh();
  const logged = t.mock.method(console, 'error', () => {});
  for (const body of [event({ id: 'org_ok_1' }), JSON.stringify({ event: 'Payment.Updated', id: 'org_ok_2', org: { id: ORG } })]) {
    assert.equal((await (await route.POST(request(body))).json()).ignored, 'entitlement_not_implemented');
  }
  assert.equal(sentryCalls().length, 0);
  assert.equal(logged.mock.callCount(), 0);
});

test('R9. BOOMFI_ORG_ID unset: nothing matches - a missing setting must not mean "every organisation is ours" - and the report says the setting is UNSET', async (t) => {
  fresh();
  const logged = t.mock.method(console, 'error', () => {});
  let n = 0;
  for (const org of [undefined, '', '  ']) {
    const r = await loadRoute({ BOOMFI_ORG_ID: org });
    for (const body of [event({ id: `unset_${n++}` }), event({ id: `unset_${n++}`, org_id: '' }), JSON.stringify({ event: 'x', id: `unset_${n++}` })]) {
      const res = await r.POST(request(body));
      assert.deepEqual(await res.json(), { received: true, recorded: true, ignored: 'org_mismatch' }, `BOOMFI_ORG_ID=${JSON.stringify(org)} body=${body}`);
    }
  }
  assert.equal(sentryCalls().length, 9);
  // The first six reports are the undefined and '' cases. The whitespace case is R9c.
  assert.ok(logged.mock.calls.slice(0, 6).every((c) => String(c.arguments[0]).includes('BOOMFI_ORG_ID=UNSET')), 'the report does not say the organisation id is unset');
});

test('R9c. a whitespace-only BOOMFI_ORG_ID is reported as UNSET, the way /api/version and the match itself already treat it', async (t) => {
  /* Was a todo: the report said "set" for a value of spaces, because the route
     tested the raw string while the match and /api/version trim it. Fixed in
     b52210c4; a real assertion since. */
  fresh();
  const logged = t.mock.method(console, 'error', () => {});
  const r = await loadRoute({ BOOMFI_ORG_ID: '  ' });
  await r.POST(request(event({ id: 'unset_ws' })));
  assert.ok(String(logged.mock.calls[0].arguments[0]).includes('BOOMFI_ORG_ID=UNSET'));
});

test('R9b. a repeat of a mismatched delivery is a plain "replay" - stored once, reported once', async (t) => {
  fresh();
  t.mock.method(console, 'error', () => {});
  const body = event({ id: 'org_repeat', org_id: 'org_someone_else' });
  await route.POST(request(body));
  const again = await route.POST(request(body));
  assert.deepEqual(await again.json(), { received: true, ignored: 'replay' });
  assert.equal(db.rows.size, 1);
  assert.equal(sentryCalls().length, 1);
});

/* ══ When it cannot be written down ══ */

test('R10. a database failure is a 500 - never a 2xx - so BoomFi marks the delivery failed and it can be replayed; the database message is not echoed', async (t) => {
  fresh();
  t.mock.method(console, 'error', () => {});
  db.failWith = { status: 500, body: { code: '57014', message: 'canceling statement due to statement timeout SECRET_DETAIL', details: null, hint: null } };
  const res = await route.POST(request(event({ id: 'pay_db_down' })));
  assert.equal(res.status, 500);
  const text = JSON.stringify(await res.json());
  assert.equal(text.includes('SECRET_DETAIL') || text.includes('statement timeout'), false, 'the database error text reached the caller');
  assert.equal(text.includes('received'), false, 'a failed write was acknowledged');
});

test('R11. a missing table (the migration is not applied yet) is also a 500, not a silent 200', async (t) => {
  fresh();
  t.mock.method(console, 'error', () => {});
  db.failWith = { status: 404, body: { code: 'PGRST205', message: "Could not find the table 'public.lhq_boomfi_webhook_events' in the schema cache", details: null, hint: null } };
  const res = await route.POST(request(event({ id: 'pay_no_table' })));
  assert.equal(res.status, 500, 'before the migration is applied every verified delivery must fail loudly, so none is lost believing it was stored');
});

test('R12. with the Supabase settings missing, a verified delivery is a 500 and is REPORTED - not acknowledged, and not an unreported throw', async (t) => {
  /* Was pinned loosely ("throws or 5xx"): getSupabaseAdmin threw out of the
     handler, which Next turned into a 500 that nothing reported. b52210c4
     catches it and sends it through apiError, so this is now exact. */
  fresh();
  const logged = t.mock.method(console, 'error', () => {});
  for (const over of [{ SUPABASE_SERVICE_ROLE_KEY: undefined }, { NEXT_PUBLIC_SUPABASE_URL: undefined }]) {
    const r = await loadRoute(over);
    const res = await r.POST(request(event({ id: `pay_no_admin_${Object.keys(over)[0]}` })));
    assert.equal(res.status, 500, `${Object.keys(over)[0]} missing`);
    assert.equal(JSON.stringify(await res.json()).includes('received'), false, 'a delivery that could not be stored was acknowledged');
  }
  assert.equal(sentryCalls().length, 2, 'a missing database client was not reported');
  assert.equal(logged.mock.callCount(), 2);
  assert.equal(db.seen.length, 0);
});

/* ══ THE property: it changes nobody's plan ══ */

test('R13. across every delivery above - accepted, repeated, refused, failed - the route touched ONE table and only ever inserted', async () => {
  fresh();
  await route.POST(request(event({ id: 'pay_sweep_1', event: 'Subscription.Created', status: 'Active' })));
  await route.POST(request(event({ id: 'pay_sweep_2', event: 'Invoice.Paid', status: 'Paid' })));
  await route.POST(request(event({ id: 'pay_sweep_3', event: 'Subscription.Cancelled', status: 'Cancelled' })));
  assert.equal(db.stray.length, 0);
  assert.deepEqual([...new Set(db.seen.map((s) => `${s.method} ${s.table}`))], [`POST ${T.boomfi_webhook_events}`],
    'the webhook made a request other than recording the event - if it now grants or revokes, that decision needs its own tests against a REAL recorded payload');
});

test('R14. source: the route names no subscription table, no update/upsert/delete/rpc, and nothing from the Lemon Squeezy module', () => {
  const src = stripTsComments(read('app/api/boomfi/webhook/route.ts'));
  assert.equal(/user_subscriptions/.test(src), false, 'the BoomFi webhook references the subscriptions table');
  for (const call of ['.upsert(', '.delete(', '.rpc(']) assert.equal(src.includes(call), false, `the route calls ${call}`);
  // '.update(' appears once, legitimately: feeding the raw body to the SHA-256 hash. Any other is a database update.
  assert.deepEqual(src.match(/\S*\.update\(/g), ["crypto.createHash('sha256').update("], 'the route has an .update( that is not the payload hash');
  assert.equal(/lemonsqueezy/i.test(src), false, 'the route imports or names Lemon Squeezy code - the two schemes share nothing');
  assert.equal((src.match(/\.from\(/g) ?? []).length, 1, 'the route reads or writes more than one table');
  assert.match(src, /\.from\(T\.boomfi_webhook_events\)/);
  assert.match(src, /const rawBody = await req\.text\(\);/, 'the body is no longer read raw, once');
  assert.equal((src.match(/req\.(text|json|arrayBuffer|formData)\(/g) ?? []).length, 1, 'the body is read more than once, or parsed by the framework before verification');
});

test('R15. only POST is exported - no GET that could be probed or cached', () => {
  assert.deepEqual(route.exports.filter((e) => ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(e)), []);
  assert.ok(route.exports.includes('POST'));
});

/* ══ /api/version and the table name ══ */

test('V1. configured.boomfiWebhook is true only when BOTH settings are present; whitespace is unset', () => {
  const flag = (key?: string, org?: string) => (configuredFlags({ BOOMFI_WEBHOOK_PUBLIC_KEY: key, BOOMFI_ORG_ID: org }) as Record<string, unknown>).boomfiWebhook;
  assert.equal(flag(PUBLIC_PEM, ORG), true);
  assert.equal(flag(PUBLIC_PEM, undefined), false);
  assert.equal(flag(undefined, ORG), false);
  assert.equal(flag(PUBLIC_PEM, '   '), false);
  assert.equal(flag('  ', ORG), false);
  assert.equal(flag('', ''), false);
  assert.equal(JSON.stringify(configuredFlags({ BOOMFI_WEBHOOK_PUBLIC_KEY: PUBLIC_PEM, BOOMFI_ORG_ID: ORG })).includes('BEGIN PUBLIC KEY'), false, 'the key value reached /api/version');
});

/* ══ The migration: not applied, so it is read ══ */

const SQL = read('supabase/migrations/20260930a_boomfi_billing.sql');
const liveSql = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).map((l) => l.replace(/--.*$/, '')).join('\n');
const devSql = SQL.split('\n').filter((l) => l.startsWith('-- ') || l.trim() === '--').map((l) => l.replace(/^-- ?/, '').replace(/--.*$/, ''))
  .join('\n').slice(SQL.split('\n').filter((l) => l.startsWith('--')).join('\n').length * 0);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

test('G1. the live block creates the events table the route writes to, with every column the route inserts', () => {
  assert.equal(T.boomfi_webhook_events, 'lhq_boomfi_webhook_events', 'the table name in this environment is not the production name - re-derive G1 before trusting it');
  const create = liveSql.match(/create table if not exists lhq_boomfi_webhook_events \(([\s\S]*?)\);/);
  assert.ok(create, 'the live block does not create lhq_boomfi_webhook_events');
  const columns = create[1].split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
  for (const inserted of ['payload_hash', 'event', 'resource_id', 'resource_status', 'body']) {
    assert.ok(columns.includes(inserted), `the route inserts "${inserted}" and the migration has no such column - the first real delivery would fail`);
  }
  assert.match(squash(create[1]), /payload_hash text primary key/, 'payload_hash is not the primary key - a repeat would be stored twice and "replay" would never be answered');
  assert.match(squash(create[1]), /body jsonb not null/);
  assert.match(squash(create[1]), /received_at timestamptz not null default now\(\)/);
});

test('G2. the events table is service-role only: row level security on, no policy, grants revoked from anon and authenticated', () => {
  /* It holds what BoomFi sent: the payer's name, email and wallet address. */
  assert.match(liveSql, /alter table lhq_boomfi_webhook_events enable row level security;/);
  assert.match(liveSql, /revoke all on lhq_boomfi_webhook_events from anon, authenticated;/);
  assert.equal(/create policy/i.test(liveSql), false, 'a policy was added to the events table - say on #861 who may read payer details and why');
  assert.equal(/grant /i.test(liveSql), false);
});

test('G3. additive only: no drop, no rename, no type change, no NOT NULL or default on the existing table', () => {
  assert.equal(/\bdrop\b|\brename\b|\btruncate\b|\bdelete\b|alter column|\btype\b/i.test(liveSql), false, 'the migration is no longer additive - production has no backups');
  const alter = liveSql.match(/alter table lhq_user_subscriptions([\s\S]*?);/);
  assert.ok(alter, 'the subscriptions columns are gone from the live block');
  const adds = alter[1].split(',').map(squash);
  assert.deepEqual(adds, [
    'add column if not exists billing_provider text',
    'add column if not exists boomfi_subscription_id text',
    'add column if not exists boomfi_customer_id text',
  ], 'a new column on the live subscriptions table carries a NOT NULL or a default, or the set changed - existing rows must be unaffected');
});

test('G4. running this file against production creates NO dev object: every lhq_dev_ statement is commented out', () => {
  assert.equal(/lhq_dev_/.test(liveSql), false, 'a dev-prefixed object is in the live block');
  assert.ok(devSql.includes('lhq_dev_boomfi_webhook_events'), 'the commented dev block is missing - dev would get no table');
});

test('G5. the dev block is the live block with the prefix changed, statement for statement', () => {
  const statements = (s: string) => squash(s).split(';').map((x) => x.trim()).filter((x) => /^(create|alter|revoke)/.test(x));
  const live = statements(liveSql);
  const dev = statements(devSql.slice(devSql.indexOf('create table if not exists lhq_dev_boomfi_webhook_events')));
  assert.equal(live.length, 5, `expected 5 live statements, found ${live.length}`);
  assert.deepEqual(dev.map((s) => s.split('lhq_dev_').join('lhq_')), live, 'the dev block has drifted from the live block');
});
