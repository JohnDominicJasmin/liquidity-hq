/* AI dollar caps per account (#1399 part 2, PR #1437).
 *
 * The owner's limits, chosen 2026-09-26: Pro $1.00 a day AND $10.00 a month; free and trial $0.15 a day; a whole-site
 * fuse at $10.00 a day. The cap is checked BEFORE an AI call, at the single choke point (`incrementUsageColumn`) all 14
 * routes go through, and it reads the ledger's measured `cost_usd`.
 *
 * PART 1 (first half of the file): what does not depend on how the ledger is summed. The constants as recorded DECISIONS,
 * the UTC window boundaries, the owner's four messages and their mapping to the four block reasons.
 *
 * PART 2 (second half): the decisions. The first version summed the ledger in JS after a plain select, and this project's
 * PostgREST caps every read at 1000 rows, so a heavy account or a busy site was summed over a TRUNCATED set and the
 * monthly cap and the fuse could under-count and never trip (finding on #1437). The sums now live in two SQL functions
 * (supabase/migrations/20260927b_ai_spend_sums.sql) and the tests below run the real spendCapBlock and
 * incrementUsageColumn against a stand-in for the database.
 *
 * Expectations are written from the owner's numbers and the approved copy, as literals. Nothing is computed from the code
 * under test. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  PRO_DAILY_CAP_USD, PRO_MONTHLY_CAP_USD, FREE_DAILY_CAP_USD, SITE_FUSE_DAILY_USD,
  dayStartIsoUtc, monthStartIsoUtc, spendCapLabelKey, spendCapBlock, spendSumToUsd,
  NULL_COST_SEARCH_ESTIMATE_USD, NULL_COST_OTHER_ESTIMATE_USD, type SpendReason,
} from '../lib/aiSpendCap.ts';
import { PLAIN_CALL_COST_USD } from '../lib/aiCost.ts';
import type { UsageTier } from '../lib/limits.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

/* ══ The owner's numbers, pinned as decisions ═══════════════════════════════════════════════ */

test('C1. the owner\'s four limits (2026-09-26): Pro $1.00/day and $10.00/month, free and trial $0.15/day, site fuse $10.00/day', () => {
  assert.equal(PRO_DAILY_CAP_USD, 1.00);
  assert.equal(PRO_MONTHLY_CAP_USD, 10.00);
  assert.equal(FREE_DAILY_CAP_USD, 0.15);
  assert.equal(SITE_FUSE_DAILY_USD, 10.00);
});

test('C2. the caps are ordered the way the product needs them: a Pro day fits inside a Pro month, and a free day is cheaper than a Pro day', () => {
  assert.ok(PRO_DAILY_CAP_USD < PRO_MONTHLY_CAP_USD, 'a single day may spend more than the whole month allows, so the daily cap can never be the binding one');
  assert.ok(FREE_DAILY_CAP_USD < PRO_DAILY_CAP_USD, 'free would be allowed to spend more than Pro');
});

/* ══ UTC windows ═══════════════════════════════════════════════════════════════════════════ */

const ms = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, milli = 0) => Date.UTC(y, mo - 1, d, h, mi, s, milli);

const DAY_CASES: [string, number, string][] = [
  ['mid-afternoon', ms(2026, 9, 27, 15, 42, 7, 123), '2026-09-27T00:00:00.000Z'],
  ['one millisecond before midnight', ms(2026, 9, 27, 23, 59, 59, 999), '2026-09-27T00:00:00.000Z'],
  ['exactly midnight starts the NEW day', ms(2026, 9, 28, 0, 0, 0, 0), '2026-09-28T00:00:00.000Z'],
  ['one millisecond after midnight', ms(2026, 9, 28, 0, 0, 0, 1), '2026-09-28T00:00:00.000Z'],
  ['the last day of a month', ms(2026, 9, 30, 12), '2026-09-30T00:00:00.000Z'],
  ['a leap day', ms(2028, 2, 29, 6), '2028-02-29T00:00:00.000Z'],
  ['New Year\'s Day', ms(2027, 1, 1, 0, 0, 0, 0), '2027-01-01T00:00:00.000Z'],
];
for (const [name, now, want] of DAY_CASES) {
  test(`W1. dayStartIsoUtc: ${name}`, () => assert.equal(dayStartIsoUtc(now), want));
}

const MONTH_CASES: [string, number, string][] = [
  ['mid-month', ms(2026, 9, 27, 15), '2026-09-01T00:00:00.000Z'],
  ['the 30th', ms(2026, 9, 30, 23, 59, 59, 999), '2026-09-01T00:00:00.000Z'],
  ['the 1st at exactly midnight starts the NEW month', ms(2026, 10, 1, 0, 0, 0, 0), '2026-10-01T00:00:00.000Z'],
  ['one millisecond before the new month is still the old one', ms(2026, 9, 30, 23, 59, 59, 999), '2026-09-01T00:00:00.000Z'],
  ['a single-digit month keeps its leading zero', ms(2026, 3, 15), '2026-03-01T00:00:00.000Z'],
  ['December', ms(2026, 12, 31, 23, 59), '2026-12-01T00:00:00.000Z'],
  ['January of the next year', ms(2027, 1, 1), '2027-01-01T00:00:00.000Z'],
  ['a leap-day February', ms(2028, 2, 29, 12), '2028-02-01T00:00:00.000Z'],
];
for (const [name, now, want] of MONTH_CASES) {
  test(`W2. monthStartIsoUtc: ${name}`, () => assert.equal(monthStartIsoUtc(now), want));
}

test('W3. the day start is never after the month start plus the month, and never before the month start', () => {
  for (let day = 1; day <= 28; day++) {
    const now = ms(2026, 9, day, 13, 30);
    assert.ok(monthStartIsoUtc(now) <= dayStartIsoUtc(now), `day ${day}: the month starts after the day does`);
    assert.equal(monthStartIsoUtc(now), '2026-09-01T00:00:00.000Z');
  }
});

test('W4. the windows are UTC, not the machine\'s time zone: an instant late on the 27th in Manila is still the 27th UTC-side', () => {
  // 2026-09-28T02:00 in Manila (UTC+8) is 2026-09-27T18:00Z: the UTC day is the 27th.
  assert.equal(dayStartIsoUtc(Date.parse('2026-09-28T02:00:00+08:00')), '2026-09-27T00:00:00.000Z');
  // 2026-10-01T05:00 in Manila is 2026-09-30T21:00Z: the UTC month is still September.
  assert.equal(monthStartIsoUtc(Date.parse('2026-10-01T05:00:00+08:00')), '2026-09-01T00:00:00.000Z');
});

/* ══ The four reasons and the owner's four messages ═════════════════════════════════════════ */

const REASONS: SpendReason[] = ['pro_daily', 'pro_monthly', 'free_daily', 'fuse'];

test('L1. each reason maps to its own owner-approved label key', () => {
  assert.deepEqual(REASONS.map(spendCapLabelKey), ['AI_CAP_PRO_DAILY', 'AI_CAP_PRO_MONTHLY', 'AI_CAP_FREE_DAILY', 'AI_CAP_FUSE']);
});

test('L2. the four keys are distinct, so two reasons can never be told the same thing', () => {
  assert.equal(new Set(REASONS.map(spendCapLabelKey)).size, 4);
});

test('L3. each key has a non-empty English default, and the four messages are distinct', () => {
  const texts = REASONS.map((r) => defaults[spendCapLabelKey(r)]);
  for (const [i, t] of texts.entries()) assert.ok(typeof t === 'string' && t.trim().length > 20, `${REASONS[i]} has no real default message`);
  assert.equal(new Set(texts).size, 4, 'two reasons show the same words');
});

test('L4. each message says the thing its reason means (a swapped key would tell a Pro user they are a free user)', () => {
  const t = (r: SpendReason) => defaults[spendCapLabelKey(r)];
  assert.match(t('pro_daily'), /today/i);
  assert.match(t('pro_daily'), /midnight UTC/);
  assert.doesNotMatch(t('pro_daily'), /free|upgrade/i, 'a Pro user is told to upgrade');
  assert.match(t('pro_monthly'), /month/i);
  assert.match(t('pro_monthly'), /1st/);
  assert.doesNotMatch(t('pro_monthly'), /free|upgrade/i, 'a Pro user is told to upgrade');
  assert.match(t('free_daily'), /free/i);
  assert.match(t('free_daily'), /upgrade/i);
  assert.match(t('fuse'), /paused/i);
  assert.match(t('fuse'), /free accounts/i);
});

test('L5. no message shows a dollar amount or a cost: the owner chose not to tell users what a call costs', () => {
  for (const r of REASONS) assert.doesNotMatch(defaults[spendCapLabelKey(r)], /\$|USD|cents?|dollars?/i, `${r} prints money`);
});

test('L6. the label keys are registered where the label system looks for them', () => {
  const keys = read('lib/labelKeys.ts');
  for (const r of REASONS) assert.ok(keys.includes(`'${spendCapLabelKey(r)}'`), `${spendCapLabelKey(r)} is not in lib/labelKeys.ts`);
});

/* The migration's English rows must equal the defaults shipped in the build (the migration's own header says so, and the
   server answers the 429 from the DEFAULTS, so a difference means the client and the server tell users different things). */
function migrationEnglish(): Record<string, string> {
  const sql = read('supabase/migrations/20260927a_labels_ai_spend_caps.sql');
  const out: Record<string, string> = {};
  for (const line of sql.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("('")) continue;
    const parts = t.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','");
    if (parts.length === 3 && parts[1] === 'en') out[parts[0]] = parts[2].split("''").join("'");
  }
  return out;
}

test('L7. the migration\'s English rows equal the shipped defaults, exactly', () => {
  const mig = migrationEnglish();
  assert.deepEqual(Object.keys(mig).sort(), REASONS.map(spendCapLabelKey).sort(), 'the migration seeds a different set of keys than the code uses');
  for (const r of REASONS) assert.equal(mig[spendCapLabelKey(r)], defaults[spendCapLabelKey(r)], `${spendCapLabelKey(r)}: migration and default differ`);
});

/* ══ Part 2: the decisions, against the SQL aggregates ═════════════════════════════════════
 *
 * The sums live in the database now (supabase/migrations/20260927b_ai_spend_sums.sql), and TypeScript only combines and
 * compares. What is faked here is the NETWORK BOUNDARY, not the code: `globalThis.fetch` is replaced by a stand-in that
 * behaves like PostgREST in front of an in-memory ledger, so the real `spendCapBlock`, the real `incrementUsageColumn`
 * and the real supabase-js client all run.
 *
 * Two things make the stand-in honest rather than convenient:
 *   1. Its RPC answers are computed by a JS mirror of the migration's SELECT (filter by user, `created_at >= p_since`,
 *      exact sum of known costs, NULL-cost rows counted by type). The function names, PARAMETER names and RESULT
 *      COLUMN names are read out of the migration text, and a call whose argument names differ from the SQL signature
 *      is answered the way PostgREST answers one: 404 PGRST202. So a rename on one side only turns tests red instead
 *      of failing open in silence (Pro's read-fail state is OPEN, so a broken call would otherwise look like "not over").
 *   2. It also serves the OLD read path (a plain select on the ledger table) and truncates it at 1000 rows, exactly as
 *      this project's PostgREST does (app/api/labels/route.ts documents `db-max-rows` = 1000). The truncation tests (TR)
 *      are the finding on #1437: they are red on the JS-sum implementation and green on the RPC one.
 *
 * What this file CANNOT prove: that the SQL itself sums correctly. The mirror is my reading of it. That gets checked
 * read-only with `execute_sql` after the owner applies the migration on the dev project. */

process.env.NEXT_PUBLIC_APP_ENV = 'dev';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://stand-in.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_stand_in_key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_stand_in_key';
delete process.env.AI_GLOBAL_DAILY_MAX;

/* ── the migration, read as text ────────────────────────────────────────────────────────── */

const MIGRATION = 'supabase/migrations/20260927b_ai_spend_sums.sql';
const migrationText = read(MIGRATION).split(/\r?\n/).join('\n');
/** The SQL that runs when the file is applied: every line that is not a `--` comment. */
const activeSql = migrationText.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
/** The commented-out DEV block, un-commented. Everything after the line that introduces it. */
const devSql = (() => {
  const lines = migrationText.split('\n');
  const start = lines.findIndex((l) => /^--\s+create or replace function/.test(l));
  return lines.slice(start).filter((l) => l.startsWith('--')).map((l) => l.replace(/^--\s?/, '')).join('\n');
})();

type FnSpec = { params: string[]; columns: string[] };
function parseFunctions(sql: string): Record<string, FnSpec> {
  const out: Record<string, FnSpec> = {};
  const names = (list: string) => list.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
  for (const m of sql.matchAll(/create or replace function\s+(\w+)\s*\(([^)]*)\)\s*returns table\s*\(([^)]*)\)/gi)) {
    out[m[1]] = { params: names(m[2]), columns: names(m[3]) };
  }
  return out;
}
const SQL_FUNCTIONS = parseFunctions(activeSql);
const USER_FN = 'lhq_ai_spend_user_since';
const ALL_FN = 'lhq_ai_spend_all_since';

/* ── the stand-in world ─────────────────────────────────────────────────────────────────── */

type LedgerRow = { user_id: string | null; call_type: string; cost_usd: number | null; created_at: string };
type Call = { method: string; path: string; body?: Record<string, unknown> };
const calls: Call[] = [];
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const pgError = (status: number, code: string, message: string) => respond({ code, message, details: null, hint: null }, status);

/** What this project's PostgREST returns for one plain read, whatever the table holds (app/api/labels/route.ts). */
const DB_MAX_ROWS = 1000;

type Fault = 'error' | 'throw' | null;
const world = {
  ledger: [] as LedgerRow[],
  migrationApplied: true,
  fault: ((_fn: string, _args: Record<string, unknown>) => null) as (fn: string, args: Record<string, unknown>) => Fault,
  flags: { grok: true } as Record<string, boolean>,
  reserve: 1 as number | null,
};
function reset() {
  calls.length = 0;
  world.ledger = [];
  world.migrationApplied = true;
  world.fault = () => null;
  world.flags = { grok: true };
  world.reserve = 1;
}

/** A JS mirror of the migration's SELECT. Column NAMES come from the migration; the order is its select list. */
function runAggregate(fn: string, args: Record<string, unknown>) {
  const since = Date.parse(String(args.p_since));
  const rows = world.ledger.filter((r) => Date.parse(r.created_at) >= since && (fn === ALL_FN || r.user_id === args.p_user));
  const known = rows.filter((r) => r.cost_usd !== null);
  const unknown = rows.filter((r) => r.cost_usd === null);
  const [cCost, cSearch, cOther] = SQL_FUNCTIONS[fn].columns;
  return [{
    [cCost]: known.reduce((sum, r) => sum + (r.cost_usd as number), 0),
    [cSearch]: unknown.filter((r) => r.call_type === 'chat_search').length,
    [cOther]: unknown.filter((r) => r.call_type !== 'chat_search').length,
  }];
}

/** The OLD read path: a plain select on the ledger, capped at DB_MAX_ROWS. Only the truncation tests exercise it. */
function plainRead(url: URL) {
  const uid = url.searchParams.get('user_id')?.replace(/^eq\./, '');
  const gte = url.searchParams.get('created_at')?.replace(/^gte\./, '');
  let rows = world.ledger;
  if (uid) rows = rows.filter((r) => r.user_id === uid);
  if (gte) rows = rows.filter((r) => Date.parse(r.created_at) >= Date.parse(gte));
  const cols = (url.searchParams.get('select') ?? '*').split(',').map((c) => c.trim());
  return rows.slice(0, DB_MAX_ROWS).map((r) => (cols[0] === '*' ? r : Object.fromEntries(cols.map((c) => [c, r[c as keyof LedgerRow]]))));
}

globalThis.fetch = (async (input: unknown, init: { method?: string; body?: unknown } = {}) => {
  const url = new URL(String((input as { url?: string })?.url ?? input));
  const method = (init.method ?? 'GET').toUpperCase();
  let body: Record<string, unknown> | undefined;
  if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = undefined; } }
  calls.push({ method, path: url.pathname, body });
  const p = url.pathname;

  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.slice('/rest/v1/rpc/'.length);
    if (fn === 'increment_ai_usage') return respond(world.reserve);
    const args = body ?? {};
    const spec = world.migrationApplied ? SQL_FUNCTIONS[fn] : undefined;
    const sent = Object.keys(args).sort().join(',');
    if (!spec || sent !== [...spec.params].sort().join(',')) {
      return pgError(404, 'PGRST202', `Could not find the function public.${fn}(${sent}) in the schema cache`);
    }
    const fault = world.fault(fn, args);
    if (fault === 'throw') throw new TypeError('fetch failed (stand-in)');
    if (fault === 'error') return pgError(500, 'XX000', 'stand-in: the read failed');
    return respond(runAggregate(fn, args));
  }
  if (p.endsWith('_app_config')) return respond([{ value: world.flags }]);
  if (method === 'GET' && p.endsWith('_ai_call_log')) return respond(plainRead(url));
  throw new Error(`stand-in got an unexpected request: ${method} ${url}`);
}) as typeof fetch;

const spendCalls = () => calls.filter((c) => c.path.startsWith('/rest/v1/rpc/lhq_ai_spend_'));
const reserveCalls = () => calls.filter((c) => c.path === '/rest/v1/rpc/increment_ai_usage');
const ledgerReads = () => calls.filter((c) => c.method === 'GET' && c.path.endsWith('_ai_call_log'));

/* ── ledger builders: real column names, synthetic ids, amounts that are exact in binary ──── */

const PRO = '00000000-0000-4000-8000-0000000000a1';
const FREE = '00000000-0000-4000-8000-0000000000b2';
const TRIAL = '00000000-0000-4000-8000-0000000000c3';
const OTHER = '00000000-0000-4000-8000-0000000000d4';

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);                  // 2026-09-27T12:00:00Z
const DAY_START = '2026-09-27T00:00:00.000Z';
const MONTH_START = '2026-09-01T00:00:00.000Z';
const TODAY = '2026-09-27T09:30:00.000Z';
const EARLIER = '2026-09-12T09:30:00.000Z';                   // this month, not today
const MIDNIGHT = '2026-09-27T00:00:00.000Z';
const YESTERDAY_LATE = '2026-09-26T23:59:59.999Z';
const LAST_MONTH_LATE = '2026-08-31T23:59:59.999Z';
const Q = 0.25;

const rows = (n: number, uid: string | null, usd: number | null, at: string, call_type = 'briefing'): LedgerRow[] =>
  Array.from({ length: n }, () => ({ user_id: uid, call_type, cost_usd: usd, created_at: at }));

async function decide(tier: UsageTier, uid: string, ledger: LedgerRow[]) {
  reset();
  world.ledger = ledger;
  return spendCapBlock(tier, uid, NOW);
}
const verdict = (reason: SpendReason | null) => (reason ? { blocked: true, reason } : { blocked: false });

/* ══ S: spendSumToUsd, the pure combiner ═══════════════════════════════════════════════════ */

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('S1. measured cost only: the exact sum passes through untouched', () => {
  assert.equal(spendSumToUsd({ cost: 1.25, null_search: 0, null_other: 0 }), 1.25);
});

test('S2. each unmeasured search row is charged $0.0372, and nothing else is', () => {
  near(spendSumToUsd({ cost: 0, null_search: 10, null_other: 0 }), 0.372);
});

test('S3. each unmeasured non-search row is charged the plain-call estimate from lib/aiCost.ts', () => {
  near(spendSumToUsd({ cost: 0, null_search: 0, null_other: 10 }), 10 * PLAIN_CALL_COST_USD);
});

test('S4. measured cost and both kinds of unmeasured rows add up', () => {
  near(spendSumToUsd({ cost: 0.5, null_search: 2, null_other: 3 }), 0.5 + 2 * 0.0372 + 3 * PLAIN_CALL_COST_USD);
});

test('S5. string fields (what numeric or bigint would produce) give the same answer as numbers', () => {
  near(
    spendSumToUsd({ cost: '0.5', null_search: '2', null_other: '3' }),
    spendSumToUsd({ cost: 0.5, null_search: 2, null_other: 3 }),
  );
  near(spendSumToUsd({ cost: '1.25', null_search: '0', null_other: '0' }), 1.25);
});

test('S6. no row, or a row of nulls, is $0 (an empty window sums to nothing)', () => {
  assert.equal(spendSumToUsd(null), 0);
  assert.equal(spendSumToUsd(undefined), 0);
  assert.equal(spendSumToUsd({ cost: null, null_search: null, null_other: null }), 0);
});

test('S7. the two unmeasured-row estimates are recorded decisions (PM, 2026-09-27)', () => {
  assert.equal(NULL_COST_SEARCH_ESTIMATE_USD, 0.0372, 'chat_search estimate: the one measured search call');
  assert.equal(NULL_COST_OTHER_ESTIMATE_USD, PLAIN_CALL_COST_USD, 'every other type uses the plain-call estimate already in lib/aiCost.ts');
  assert.ok(PLAIN_CALL_COST_USD > 0 && PLAIN_CALL_COST_USD < NULL_COST_SEARCH_ESTIMATE_USD, 'a plain call must be cheaper than a search call and never free');
});

/* ══ D: the decisions ═════════════════════════════════════════════════════════════════════ */

// How many unmeasured non-search rows it takes to reach a dollar cap, from the plain-call estimate.
const nullOtherRowsFor = (usd: number) => Math.ceil(usd / PLAIN_CALL_COST_USD);

type Case = [id: string, name: string, tier: UsageTier, uid: string, ledger: LedgerRow[], want: SpendReason | null];
const PRO_CASES: Case[] = [
  ['P1', 'no spend at all', 'pro', PRO, [], null],
  ['P2', 'today $0.75 is under the $1.00 day cap', 'pro', PRO, rows(3, PRO, Q, TODAY), null],
  ['P3', 'today exactly $1.00 is AT the cap and blocks (the cap is "reached", not "exceeded")', 'pro', PRO, rows(4, PRO, Q, TODAY), 'pro_daily'],
  ['P4', 'today $1.25 blocks with the daily reason', 'pro', PRO, rows(5, PRO, Q, TODAY), 'pro_daily'],
  ['P5', 'this month $9.75 (earlier days) is under the $10.00 month cap', 'pro', PRO, rows(39, PRO, Q, EARLIER), null],
  ['P6', 'this month exactly $10.00 blocks with the monthly reason', 'pro', PRO, rows(40, PRO, Q, EARLIER), 'pro_monthly'],
  ['P7', 'this month $12.50, nothing today: monthly, not daily', 'pro', PRO, rows(50, PRO, Q, EARLIER), 'pro_monthly'],
  ['P8', 'over both the day and the month: the MONTH reason wins', 'pro', PRO, [...rows(40, PRO, Q, EARLIER), ...rows(8, PRO, Q, TODAY)], 'pro_monthly'],
  ['P9', 'yesterday\'s $5.00 counts to the month but not the day', 'pro', PRO, rows(20, PRO, Q, YESTERDAY_LATE), null],
  ['P10', 'yesterday\'s $10.00 blocks as MONTHLY, never as daily', 'pro', PRO, rows(40, PRO, Q, YESTERDAY_LATE), 'pro_monthly'],
  ['P11', 'last month\'s $50 does not count toward this month', 'pro', PRO, rows(200, PRO, Q, LAST_MONTH_LATE), null],
  ['P12', 'a row stamped exactly midnight belongs to TODAY', 'pro', PRO, rows(4, PRO, Q, MIDNIGHT), 'pro_daily'],
  ['P13', 'a row one millisecond before midnight belongs to YESTERDAY (so the day is clear)', 'pro', PRO, rows(4, PRO, Q, YESTERDAY_LATE), null],
  ['P14', 'another account\'s $50 today is not this account\'s spend', 'pro', PRO, rows(200, OTHER, Q, TODAY), null],
  ['P15', '27 unmeasured search calls today = $1.0044: blocks', 'pro', PRO, rows(27, PRO, null, TODAY, 'chat_search'), 'pro_daily'],
  ['P16', '26 unmeasured search calls today = $0.9672: does not', 'pro', PRO, rows(26, PRO, null, TODAY, 'chat_search'), null],
  ['P17', 'measured $0.50 plus 14 unmeasured searches ($0.5208) = $1.0208: blocks', 'pro', PRO, [...rows(2, PRO, Q, TODAY), ...rows(14, PRO, null, TODAY, 'chat_search')], 'pro_daily'],
  ['P18', 'measured $0.50 plus 13 unmeasured searches ($0.4836) = $0.9836: does not', 'pro', PRO, [...rows(2, PRO, Q, TODAY), ...rows(13, PRO, null, TODAY, 'chat_search')], null],
  ['P19', 'enough unmeasured NON-search calls to reach $1.00 today: blocks', 'pro', PRO, rows(nullOtherRowsFor(1.00), PRO, null, TODAY), 'pro_daily'],
  ['P20', 'one fewer unmeasured non-search call: does not', 'pro', PRO, rows(nullOtherRowsFor(1.00) - 1, PRO, null, TODAY), null],
];
const FREE_CASES = (tier: 'free' | 'trial', uid: string): Case[] => {
  const s = tier === 'trial' ? 't' : '';
  return [
    [`F1${s}`, 'no spend at all', tier, uid, [], null],
    [`F2${s}`, 'own $0.125 today is under the $0.15 cap', tier, uid, rows(1, uid, 0.125, TODAY), null],
    [`F3${s}`, 'own spend of exactly $0.15 is AT the cap and blocks', tier, uid, rows(1, uid, 0.15, TODAY), 'free_daily'],
    [`F4${s}`, 'own $0.20 blocks with the free-daily reason', tier, uid, rows(1, uid, 0.20, TODAY), 'free_daily'],
    [`F5${s}`, 'yesterday\'s own $5.00 does not count today (free has no monthly cap)', tier, uid, rows(20, uid, Q, YESTERDAY_LATE), null],
    [`F6${s}`, 'a row stamped exactly midnight belongs to today', tier, uid, rows(1, uid, 0.15, MIDNIGHT), 'free_daily'],
    [`F7${s}`, 'a row one millisecond before midnight does not', tier, uid, rows(1, uid, 0.15, YESTERDAY_LATE), null],
    [`F8${s}`, 'five unmeasured searches ($0.186) block', tier, uid, rows(5, uid, null, TODAY, 'chat_search'), 'free_daily'],
    [`F9${s}`, 'four unmeasured searches ($0.1488) do not', tier, uid, rows(4, uid, null, TODAY, 'chat_search'), null],
    [`F10${s}`, 'everyone else\'s $9.875 plus own $0.125 = $10.00 exactly: the fuse trips', tier, uid,
      [...rows(39, OTHER, Q, TODAY), ...rows(1, OTHER, 0.125, TODAY), ...rows(1, uid, 0.125, TODAY)], 'fuse'],
    [`F11${s}`, 'site total $9.875 is one step under the fuse: does not trip', tier, uid,
      [...rows(39, OTHER, Q, TODAY), ...rows(1, uid, 0.125, TODAY)], null],
    [`F12${s}`, 'site spend far over the fuse trips it', tier, uid, rows(200, OTHER, Q, TODAY), 'fuse'],
    [`F13${s}`, 'yesterday\'s site spend does not count toward today\'s fuse', tier, uid, rows(200, OTHER, Q, YESTERDAY_LATE), null],
    [`F14${s}`, 'PRO accounts\' spend counts toward the fuse (it is the whole site)', tier, uid, rows(40, PRO, Q, TODAY), 'fuse'],
    [`F15${s}`, 'rows with no user_id (system calls) count toward the fuse too', tier, uid, rows(40, null, Q, TODAY), 'fuse'],
    [`F16${s}`, '269 unmeasured searches site-wide ($10.0068) trip the fuse', tier, uid, rows(269, OTHER, null, TODAY, 'chat_search'), 'fuse'],
    [`F17${s}`, '268 unmeasured searches site-wide ($9.9696) do not', tier, uid, rows(268, OTHER, null, TODAY, 'chat_search'), null],
    [`F18${s}`, 'own AND site both over: the account\'s own reason comes first', tier, uid, [...rows(1, uid, 0.20, TODAY), ...rows(200, OTHER, Q, TODAY)], 'free_daily'],
  ];
};
for (const [id, name, tier, uid, ledger, want] of [...PRO_CASES, ...FREE_CASES('free', FREE), ...FREE_CASES('trial', TRIAL)]) {
  test(`${id}. ${tier}: ${name}`, async () => {
    assert.deepEqual(await decide(tier, uid, ledger), verdict(want));
  });
}

/* ══ Q: what is asked of the database ═════════════════════════════════════════════════════ */

test('Q1. a Pro decision asks for exactly two per-user sums: this month and today, for the caller and nobody else', async () => {
  await decide('pro', PRO, rows(3, PRO, Q, TODAY));
  const sent = spendCalls();
  assert.equal(sent.length, 2, 'Pro needs the month and the day, and nothing else');
  for (const c of sent) {
    assert.equal(c.path, `/rest/v1/rpc/${USER_FN}`);
    assert.equal(c.body?.p_user, PRO, 'a sum was asked for a different account');
  }
  assert.deepEqual(sent.map((c) => c.body?.p_since).sort(), [DAY_START, MONTH_START].sort());
});

test('Q2. a free decision asks for its own day first, then the whole site\'s day; the fuse call names no user', async () => {
  await decide('free', FREE, rows(1, FREE, 0.125, TODAY));
  const sent = spendCalls();
  assert.deepEqual(sent.map((c) => c.path), [`/rest/v1/rpc/${USER_FN}`, `/rest/v1/rpc/${ALL_FN}`]);
  assert.deepEqual(sent[0].body, { p_user: FREE, p_since: DAY_START });
  assert.deepEqual(sent[1].body, { p_since: DAY_START });
});

test('Q3. an account already over its own daily cap is stopped without reading the fuse', async () => {
  await decide('free', FREE, rows(1, FREE, 0.20, TODAY));
  assert.deepEqual(spendCalls().map((c) => c.path), [`/rest/v1/rpc/${USER_FN}`]);
});

test('Q4. Pro never reads the site-wide sum: Pro keeps its own two caps and the fuse is a free-tier stop', async () => {
  await decide('pro', PRO, rows(200, OTHER, Q, TODAY));
  assert.ok(spendCalls().every((c) => !c.path.endsWith(ALL_FN)), 'a Pro decision asked for the whole-site sum');
});

test('Q5. no decision reads the ledger row by row: a plain select is capped at 1000 rows, which is the bug', async () => {
  for (const [tier, uid] of [['pro', PRO], ['free', FREE], ['trial', TRIAL]] as const) {
    await decide(tier, uid, rows(60, uid, 0.001, TODAY));
    assert.equal(ledgerReads().length, 0, `${tier}: the ledger table was read directly`);
  }
});

test('Q6. the function names, parameters and result columns TypeScript relies on are exactly the ones the migration creates', () => {
  assert.deepEqual(Object.keys(SQL_FUNCTIONS).sort(), [ALL_FN, USER_FN].sort());
  assert.deepEqual(SQL_FUNCTIONS[USER_FN], { params: ['p_user', 'p_since'], columns: ['cost', 'null_search', 'null_other'] });
  assert.deepEqual(SQL_FUNCTIONS[ALL_FN], { params: ['p_since'], columns: ['cost', 'null_search', 'null_other'] });
});

test('Q7. the stand-in refuses a call whose argument names differ from the SQL (control: it is not answering everything)', async () => {
  reset();
  const res = await fetch('http://stand-in.invalid/rest/v1/rpc/' + USER_FN, { method: 'POST', body: JSON.stringify({ p_user: PRO, p_from: DAY_START }) });
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { code: string }).code, 'PGRST202');
});

/* ══ TR: the finding on #1437, the 1000-row truncation ════════════════════════════════════ */

/* Amounts: the owner's break-even is about $0.0085 per call, so a Pro account making 1500 calls in a month has spent
   about $12.75 and is over the $10.00 cap. Read 1000 of those 1500 rows and the sum is $8.50: under the cap, so the
   monthly cap never trips for exactly the heavy accounts it exists for. */

const CALL_USD = 0.008;

test('TR0. CONTROL: the stand-in\'s plain read is cut at 1000 rows, and the RPC is not', async () => {
  reset();
  world.ledger = rows(1500, PRO, CALL_USD, EARLIER);
  const url = 'http://stand-in.invalid/rest/v1/lhq_dev_ai_call_log?select=cost_usd,call_type,created_at&user_id=eq.' + PRO;
  assert.equal(((await (await fetch(url)).json()) as unknown[]).length, 1000, 'the truncation is not modeled, so the tests below prove nothing');
  const res = await fetch('http://stand-in.invalid/rest/v1/rpc/' + USER_FN, { method: 'POST', body: JSON.stringify({ p_user: PRO, p_since: MONTH_START }) });
  const [row] = (await res.json()) as { cost: number }[];
  near(row.cost, 1500 * CALL_USD);
});

test('TR1. a Pro account at 1500 calls this month ($12.00) is stopped by the monthly cap, though only 1000 rows would have been read', async () => {
  assert.deepEqual(await decide('pro', PRO, rows(1500, PRO, CALL_USD, EARLIER)), verdict('pro_monthly'));
});

test('TR2. the whole site at 1300 calls today ($10.40) trips the fuse for a free account, though only 1000 rows would have been read', async () => {
  const users = [OTHER, PRO, TRIAL];
  const ledger = Array.from({ length: 1300 }, (_, i) => ({ user_id: users[i % 3], call_type: 'briefing', cost_usd: CALL_USD, created_at: TODAY }));
  assert.deepEqual(await decide('free', FREE, ledger), verdict('fuse'));
});

test('TR3. CONTROL: 100 calls at $0.11 ($11.00) blocks a Pro account on either implementation, so the stand-in is not rigged to always say yes', async () => {
  assert.deepEqual(await decide('pro', PRO, rows(100, PRO, 0.11, EARLIER)), verdict('pro_monthly'));
  assert.deepEqual(await decide('pro', PRO, rows(100, PRO, 0.0011, EARLIER)), verdict(null), 'and under the cap it does not block');
});

/* ══ R: when the database cannot answer ════════════════════════════════════════════════════ */

/* "Unknown is not no" (PM, 2026-09-27): Pro fails OPEN, free and trial fail CLOSED (reported as free_daily). Every
   call is tested on its own, because a Pro decision now has two and a free one has two. */

const failing = (...which: string[]) => (fn: string, args: Record<string, unknown>): Fault =>
  which.includes(fn === USER_FN ? `user@${args.p_since}` : `all@${args.p_since}`) ? 'error' : null;

test('R1. Pro: both reads fail, so the call is let through', async () => {
  reset();
  world.fault = () => 'error';
  assert.deepEqual(await spendCapBlock('pro', PRO, NOW), { blocked: false });
});

test('R2. Pro: only the MONTH read fails (the day is under the cap), so the call is let through', async () => {
  reset();
  world.ledger = rows(1, PRO, 0.5, TODAY);
  world.fault = failing(`user@${MONTH_START}`);
  assert.deepEqual(await spendCapBlock('pro', PRO, NOW), { blocked: false });
});

test('R3. Pro: only the DAY read fails (the month is under the cap), so the call is let through', async () => {
  reset();
  world.ledger = rows(1, PRO, 0.5, EARLIER);
  world.fault = failing(`user@${DAY_START}`);
  assert.deepEqual(await spendCapBlock('pro', PRO, NOW), { blocked: false });
});

test('R4. Pro: the functions are missing (migration not applied yet, PGRST202), so the call is let through', async () => {
  reset();
  world.migrationApplied = false;
  world.ledger = rows(100, PRO, 1, TODAY);
  assert.deepEqual(await spendCapBlock('pro', PRO, NOW), { blocked: false });
});

test('R5. Pro: the network itself fails, so the call is let through', async () => {
  reset();
  world.fault = () => 'throw';
  assert.deepEqual(await spendCapBlock('pro', PRO, NOW), { blocked: false });
});

for (const [tier, uid] of [['free', FREE], ['trial', TRIAL]] as const) {
  const s = tier === 'trial' ? 't' : '';
  test(`R6${s}. ${tier}: the read of the account's own spend fails, so the call is refused as free_daily`, async () => {
    reset();
    world.fault = failing(`user@${DAY_START}`);
    assert.deepEqual(await spendCapBlock(tier, uid, NOW), { blocked: true, reason: 'free_daily' });
  });

  test(`R7${s}. ${tier}: the account is under its cap but the FUSE read fails, so the call is refused as free_daily`, async () => {
    reset();
    world.ledger = rows(1, uid, 0.125, TODAY);
    world.fault = failing(`all@${DAY_START}`);
    assert.deepEqual(await spendCapBlock(tier, uid, NOW), { blocked: true, reason: 'free_daily' });
  });

  test(`R8${s}. ${tier}: the functions are missing (migration not applied yet), so the call is refused as free_daily`, async () => {
    reset();
    world.migrationApplied = false;
    assert.deepEqual(await spendCapBlock(tier, uid, NOW), { blocked: true, reason: 'free_daily' });
  });

  test(`R9${s}. ${tier}: the network itself fails, so the call is refused as free_daily`, async () => {
    reset();
    world.fault = () => 'throw';
    assert.deepEqual(await spendCapBlock(tier, uid, NOW), { blocked: true, reason: 'free_daily' });
  });
}

/* Found while writing R2/R3, for PM and Dev to decide (not asserted as a defect): a Pro read failure discards a
   sum that DID come back over its cap. The month read says $12.00, the day read errors, and the call is let through,
   although the month cap is known to be exceeded. "A read error must not lock out a paying customer" is about the
   unknown part; the known part is a real overage. Rare (both reads hit the same function), so recorded, not urgent. */
test('R10. Pro: the month read says OVER the cap and the day read fails: the known overage should still block', { todo: 'design decision for PM/Dev (see comment)' }, async () => {
  reset();
  world.ledger = rows(50, PRO, Q, EARLIER);
  world.fault = failing(`user@${DAY_START}`);
  assert.deepEqual(await spendCapBlock('pro', PRO, NOW), { blocked: true, reason: 'pro_monthly' });
});

test('R11. Pro: the day read says OVER the cap and the month read fails: the known overage should still block', { todo: 'design decision for PM/Dev (see R10)' }, async () => {
  reset();
  world.ledger = rows(8, PRO, Q, TODAY);
  world.fault = failing(`user@${MONTH_START}`);
  assert.deepEqual(await spendCapBlock('pro', PRO, NOW), { blocked: true, reason: 'pro_daily' });
});

/* ══ A: the choke point, incrementUsageColumn ═════════════════════════════════════════════ */

const { incrementUsageColumn, rateLimitMessage } = await import('../lib/aiUsage.ts');

const clock = (t: TestContext) => t.mock.timers.enable({ apis: ['Date'], now: NOW });
async function increment(tier: UsageTier, uid: string, ledger: LedgerRow[], over: { reserve?: number | null; pool?: number | null } = {}) {
  reset();
  world.ledger = ledger;
  if ('reserve' in over) world.reserve = over.reserve ?? null;
  return incrementUsageColumn(uid, tier, 'grok_count', 10, over.pool ?? null);
}

const BLOCKS: [SpendReason, UsageTier, string, LedgerRow[]][] = [
  ['pro_daily', 'pro', PRO, rows(4, PRO, Q, TODAY)],
  ['pro_monthly', 'pro', PRO, rows(40, PRO, Q, EARLIER)],
  ['free_daily', 'free', FREE, rows(1, FREE, 0.15, TODAY)],
  ['free_daily', 'trial', TRIAL, rows(1, TRIAL, 0.15, TODAY)],
  ['fuse', 'free', FREE, rows(40, OTHER, Q, TODAY)],
];
for (const [reason, tier, uid, ledger] of BLOCKS) {
  test(`A1. ${tier} over a dollar cap is refused with ${reason}, and no per-feature count is reserved`, async (t) => {
    clock(t);
    const got = await increment(tier, uid, ledger);
    assert.equal(got.blocked, true);
    assert.equal((got as { reason: string }).reason, reason);
    assert.equal(reserveCalls().length, 0, 'a count was burned for a call that was never allowed');
  });
}

test('A2. under every cap, the call goes on to the count reserve, with the arguments it always had', async (t) => {
  clock(t);
  const got = await increment('pro', PRO, rows(1, PRO, 0.5, TODAY), { reserve: 3 });
  assert.deepEqual(got, { blocked: false, count: 3 });
  assert.equal(reserveCalls().length, 1);
  assert.deepEqual(reserveCalls()[0].body, {
    p_user_id: PRO, p_date: '2026-09-27', p_column: 'grok_count', p_limit: 10, p_global_limit: null, p_pool_limit: null,
  });
});

test('A3. the dollar check runs BEFORE the count reserve, so a refused call costs the user none of their daily count', async (t) => {
  clock(t);
  await increment('pro', PRO, rows(1, PRO, 0.5, TODAY));
  const order = calls.filter((c) => c.path.startsWith('/rest/v1/rpc/')).map((c) => c.path.split('/').pop());
  assert.equal(order.at(-1), 'increment_ai_usage');
  assert.ok(order.slice(0, -1).length >= 2 && order.slice(0, -1).every((n) => n?.startsWith('lhq_ai_spend_')), `unexpected order: ${order.join(', ')}`);
});

test('A4. the count caps still answer as before when no dollar cap is hit: own limit, app-wide breaker, shared pool', async (t) => {
  clock(t);
  assert.deepEqual(await increment('pro', PRO, [], { reserve: null }), { blocked: true, reason: 'user', limit: 10 });
  assert.deepEqual(await increment('pro', PRO, [], { reserve: -1 }), { blocked: true, reason: 'global', limit: 10 });
  assert.deepEqual(await increment('pro', PRO, [], { reserve: -2, pool: 7 }), { blocked: true, reason: 'pool', limit: 7 });
});

test('A5. the admin kill switch still wins, and it wins before any ledger read', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  reset();
  world.flags = { grok: false };
  t.mock.timers.tick(20_000);                                   // the flag cache lives 15 s
  const got = await incrementUsageColumn(PRO, 'pro', 'grok_count', 10, null);
  assert.deepEqual(got, { blocked: true, reason: 'disabled', limit: 10 });
  assert.equal(spendCalls().length, 0, 'the ledger was read although AI is switched off');
  assert.equal(reserveCalls().length, 0);
  world.flags = { grok: true };
  t.mock.timers.tick(20_000);                                   // leave the cache open for whatever runs next
  assert.equal((await incrementUsageColumn(PRO, 'pro', 'grok_count', 10, null)).blocked, false);
});

/* ── what the user is told ─────────────────────────────────────────────────────────────── */

test('A6. every dollar-cap reason is shown as its own owner-approved message', () => {
  for (const reason of REASONS) {
    assert.equal(rateLimitMessage(reason, 0, 'anything'), defaults[spendCapLabelKey(reason)], `${reason}: wrong message`);
  }
  assert.equal(new Set(REASONS.map((r) => rateLimitMessage(r, 0, 'x'))).size, 4, 'two reasons show the same words');
});

test('A7. the older reasons keep their wording (this PR must not change them)', () => {
  assert.equal(rateLimitMessage('user', 5, 'Grok analyses'), 'Daily limit of 5 Grok analyses reached.');
  assert.equal(rateLimitMessage('global', 5, 'x'), 'AI Arena is at capacity right now across all users - try again shortly.');
  assert.equal(rateLimitMessage('pool', 5, 'x'), 'Daily limit of 5 AI tool runs reached. All the AI analysis tools share one daily budget.');
  assert.equal(rateLimitMessage('disabled', 5, 'x'), 'AI features are temporarily disabled.');
});

/* ── every AI route is behind it ───────────────────────────────────────────────────────── */

function filesUnder(dir: string): string[] {
  return execFileSync('git', ['-C', fileURLToPath(new URL('..', import.meta.url)), 'ls-files', dir], { encoding: 'utf8' }).split(/\r?\n/).filter((f) => /\.tsx?$/.test(f));
}

test('A8. the routes that RECORD an AI cost are exactly the routes behind the cap, and each tells the user why it refused', () => {
  const app = filesUnder('app');
  const recorders = app.filter((f) => /\brecordAiCall\b/.test(read(f)));
  const gated = app.filter((f) => /\b(incrementUsageColumn|incrementToolUsage)\(/.test(read(f)));
  assert.equal(gated.length, 14, 'the cap is said to cover all 14 AI routes');
  assert.deepEqual([...recorders].sort(), [...gated].sort(), 'a route spends AI money without the cap, or is capped without being logged');
  for (const f of gated) {
    const src = read(f);
    assert.ok(/usageResult\.reason/.test(src), `${f} does not pass the block reason on`);
    assert.ok(/rateLimitMessage\(/.test(src), `${f} does not word the refusal through rateLimitMessage`);
  }
});

/* ══ M: the migration text ════════════════════════════════════════════════════════════════ */

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

test('M1. the migration is additive: it creates or replaces two functions and changes nothing else', () => {
  const sql = norm(activeSql);
  assert.equal([...sql.matchAll(/create or replace function/g)].length, 2);
  for (const bad of [/\bdrop\b/, /\balter\b/, /\bdelete\b/, /\btruncate\b/, /\binsert\b/, /\bupdate\b/, /create table/, /create index/]) {
    assert.doesNotMatch(sql, bad, `the migration is no longer additive (${bad})`);
  }
});

test('M2. both functions are read-only, definer-rights, pinned to public, and return plain numbers', () => {
  for (const fn of [USER_FN, ALL_FN]) {
    const at = norm(activeSql).indexOf(`function ${fn}(`);
    const body = norm(activeSql).slice(at, norm(activeSql).indexOf('$$;', at) + 3);
    assert.match(body, /language sql/);
    assert.match(body, /\bstable\b/, `${fn} is not marked stable (read-only)`);
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = public/, `${fn} does not pin its search_path`);
    assert.match(body, /coalesce\(sum\(cost_usd\), 0\)::float8/, `${fn}: the sum is not a float8 that is 0 for an empty window`);
    assert.equal([...body.matchAll(/\)::int/g)].length, 2, `${fn}: the two counts are not plain ints`);
  }
});

test('M3. only service_role may run them: revoked from public, anon and authenticated, granted to service_role', () => {
  const sql = norm(activeSql);
  for (const sig of [`${USER_FN}(uuid, timestamptz)`, `${ALL_FN}(timestamptz)`]) {
    assert.ok(sql.includes(`revoke execute on function ${sig} from public, anon, authenticated;`), `${sig}: not revoked from public, anon and authenticated`);
    assert.ok(sql.includes(`grant execute on function ${sig} to service_role;`), `${sig}: not granted to service_role`);
  }
  for (const who of ['public', 'anon', 'authenticated']) {
    assert.doesNotMatch(sql, new RegExp(`grant [^;]* to [^;]*\\b${who}\\b`), `something is GRANTED to ${who}: any signed-in user could read the whole site's spend`);
  }
});

test('M4. the whole-site sum sees every user, the per-user sum sees one; both start AT p_since, not after it', () => {
  const sql = norm(activeSql);
  const of = (fn: string) => sql.slice(sql.indexOf(`function ${fn}(`), sql.indexOf('$$;', sql.indexOf(`function ${fn}(`)));
  assert.match(of(USER_FN), /where user_id = p_user and created_at >= p_since;/);
  assert.match(of(ALL_FN), /where created_at >= p_since;/);
  assert.doesNotMatch(of(ALL_FN), /user_id/, 'the fuse is filtered by user, so it is not a whole-site sum');
});

test('M5. unmeasured rows are COUNTED by type, and a NULL call_type is not dropped', () => {
  for (const fn of [USER_FN, ALL_FN]) {
    const sql = norm(activeSql);
    const body = sql.slice(sql.indexOf(`function ${fn}(`), sql.indexOf('$$;', sql.indexOf(`function ${fn}(`)));
    assert.ok(body.includes("count(*) filter (where cost_usd is null and call_type = 'chat_search')::int"), `${fn}: search rows not counted`);
    assert.ok(body.includes("count(*) filter (where cost_usd is null and call_type is distinct from 'chat_search')::int"), `${fn}: other rows not counted (or NULL types dropped)`);
  }
});

test('M6. no cost figure lives in the SQL: the unmeasured-row estimates exist only in lib/aiSpendCap.ts', () => {
  const sql = activeSql;
  assert.doesNotMatch(sql, /0\.0372/, 'the search estimate is copied into SQL');
  assert.doesNotMatch(sql, /\d+\.\d+/, 'a decimal number appears in the active SQL: an estimate has been copied into it');
  assert.doesNotMatch(sql, new RegExp(String(PLAIN_CALL_COST_USD).replace('.', '\\.')), 'the plain-call estimate is copied into SQL');
});

test('M7. the active block touches only the PROD ledger table, and never a dev one (the #1310 class)', () => {
  assert.match(activeSql, /from lhq_ai_call_log\b/);
  assert.doesNotMatch(activeSql, /lhq_dev_/, 'the block that runs against prod names a dev object');
});

test('M8. the commented DEV block is the same functions, with only the table name changed', () => {
  assert.ok(devSql.length > 300, 'the dev block could not be read (marker changed?)');
  assert.doesNotMatch(devSql, /from lhq_ai_call_log\b/, 'the dev block reads the prod table');
  assert.match(devSql, /from lhq_dev_ai_call_log\b/);
  assert.equal(norm(devSql), norm(activeSql).split('lhq_ai_call_log').join('lhq_dev_ai_call_log'),
    'the dev block has drifted from the prod block: one project would run different functions');
});

test('M9. the table and columns the SQL reads are the ones the ledger migration creates', () => {
  const ledger = read('supabase/migrations/20260923_ai_call_log.sql');
  const create = ledger.slice(ledger.indexOf('create table if not exists lhq_ai_call_log'), ledger.indexOf(');', ledger.indexOf('create table if not exists lhq_ai_call_log')));
  for (const col of ['user_id', 'call_type', 'cost_usd', 'created_at']) assert.match(create, new RegExp(`\\b${col}\\b`), `the ledger has no ${col} column`);
  assert.match(create, /cost_usd\s+numeric,/, 'cost_usd is no longer nullable numeric, so the NULL counting means something else');
  assert.match(create, /call_type\s+text\s+not null/, 'call_type may now be NULL; the "distinct from" branch becomes load-bearing');
});
