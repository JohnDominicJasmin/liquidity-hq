/* #1632 item 1, H1, M9 (#1644): the browser can no longer write telegram_chat_id, and each account's rows are capped and length-limited.
 *
 * WHAT THIS PINS: the migration 20261021e grants INSERT/UPDATE on user_settings to the browser role for EXACTLY the columns /api/settings writes
 * (its ALLOWED list plus user_id, updated_at, field_updated_at), with telegram_chat_id outside, in both the prod block and the dev block (so a new
 * setting cannot ship whose save the database then refuses, and the hole cannot come back); the app's limits (lib/ownRowLimits.ts) equal the
 * database's (trade notes, hypothesis fields, evidence, alert note, 50 active alerts); the database's refusals map to a 400 with a message and
 * nothing else does; clip never refuses; the price-alert route refuses the 51st active alert and an over-long note before the database.
 *
 * WHAT IT CANNOT PROVE: that the migration RUNS (the live refusal check on the dev DB in QA's window, #1632), or prod's live grants. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEXT_LIMITS, ACTIVE_ALERT_CAP, limitRefusal, clip } from '../lib/ownRowLimits.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const MIG = 'supabase/migrations/20261021e_security_own_row_limits.sql';
const sql = read(MIG);
const prodBlock = sql.slice(0, sql.indexOf('-- ════ DEV'));
const devBlock = sql.slice(sql.indexOf('-- ════ DEV')).split('\n').map((l) => l.replace(/^--\s?/, '')).join('\n');
const grantList = (block: string, table: string) => {
  const m = new RegExp(`table_name = '${table}'\\s*and column_name = any \\(array\\[([^\\]]+)\\]\\)`).exec(block);
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort() : null;
};
const allowedFromRoute = () => {
  const src = read('app/api/settings/route.ts');
  const m = /const ALLOWED = \[([\s\S]*?)\];/.exec(src);
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
};

test('G1. the column grant equals /api/settings\' ALLOWED plus user_id, updated_at, field_updated_at, in BOTH blocks, and telegram_chat_id is not in it', () => {
  const want = [...allowedFromRoute(), 'user_id', 'updated_at', 'field_updated_at'].sort();
  assert.ok(want.length > 10, 'could not read ALLOWED from app/api/settings/route.ts');
  for (const [name, block, table] of [['prod', prodBlock, 'lhq_user_settings'], ['dev', devBlock, 'lhq_dev_user_settings']] as const) {
    const got = grantList(block, table);
    assert.ok(got, `${name} block: the column list for ${table} was not found`);
    assert.deepEqual(got, want, `${name} block: the granted columns differ from what /api/settings writes (a save would be refused, or a column is granted for nothing)`);
    assert.ok(!got!.includes('telegram_chat_id'), `${name} block grants telegram_chat_id: the #1632 item 1 hole is back`);
  }
});

test('G2. both blocks revoke table-wide INSERT/UPDATE from anon and authenticated before granting the columns back, and refuse to run with no columns found', () => {
  for (const [name, block, table] of [['prod', prodBlock, 'lhq_user_settings'], ['dev', devBlock, 'lhq_dev_user_settings']] as const) {
    const revoke = block.indexOf(`execute 'revoke insert, update on public.${table} from anon, authenticated';`);
    const grant = block.indexOf(`execute format('grant insert (%s), update (%s) on public.${table} to authenticated', cols, cols);`);
    assert.ok(revoke > 0 && grant > revoke, `${name} block: revoke-then-grant on ${table} not found in that order`);
    assert.ok(block.includes(`if cols is null then raise exception '${table}: no allowlisted column found, refusing to revoke'`), `${name} block: no guard against revoking with nothing to grant back`);
  }
});

test('L1. the app\'s limits equal the database\'s CHECK limits and caps', () => {
  const lim = (block: string, p: string, tbl: string, col: string) => { const m = new RegExp(`\\('${p}${tbl}', '${col}', (\\d+)\\)`).exec(block); return m ? Number(m[1]) : null; };
  for (const [block, p] of [[prodBlock, 'lhq_'], [devBlock, 'lhq_dev_']] as const) {
    assert.equal(lim(block, p, 'trades', 'notes'), TEXT_LIMITS.tradeNotes);
    assert.equal(lim(block, p, 'hypotheses', 'title'), TEXT_LIMITS.hypothesisTitle);
    assert.equal(lim(block, p, 'hypotheses', 'hypothesis'), TEXT_LIMITS.hypothesis);
    assert.equal(lim(block, p, 'hypothesis_evidence', 'content'), TEXT_LIMITS.evidenceContent);
    assert.equal(lim(block, p, 'hypothesis_evidence', 'source'), TEXT_LIMITS.evidenceSource);
    assert.equal(lim(block, p, 'price_alerts', 'label'), TEXT_LIMITS.alertLabel);
    assert.equal(lim(block, p, 'hypotheses', 'grok_reasoning'), TEXT_LIMITS.aiLong);
    assert.ok(new RegExp(`create trigger lhq_active_alert_cap before insert or update of active on public\\.${p}price_alerts for each row execute function public\\.lhq_enforce_active_alert_cap\\('${ACTIVE_ALERT_CAP}'\\);`).test(block), `${p}: the active-alert cap is not ${ACTIVE_ALERT_CAP}`);
  }
});

test('R1. the database\'s refusals become a 400 with a message; any other error is not swallowed', () => {
  assert.deepEqual(limitRefusal({ hint: 'LHQ_ALERT_CAP' }), { status: 400, error: 'ALERT_LIMIT', message: `You can have up to ${ACTIVE_ALERT_CAP} active price alerts. Delete one to add another.` });
  assert.equal(limitRefusal({ hint: 'LHQ_ROW_CAP', code: 'P0001' })?.error, 'ROW_LIMIT');
  assert.equal(limitRefusal({ code: '23514' })?.error, 'TOO_LONG');
  for (const e of [null, undefined, {}, { code: '42501' }, { code: 'P0001' }, { code: '23505', hint: 'other' }]) assert.equal(limitRefusal(e as never), null, JSON.stringify(e));
});

test('R2. clip cuts server-written text to the limit and never refuses it', () => {
  assert.equal(clip('abcdef', 4), 'abcd');
  assert.equal(clip('abc', 4), 'abc');
  assert.equal(clip(null, 4), null);
  assert.equal(clip(undefined, 4), null);
});

test('R3. the price-alert route refuses the 51st active alert and an over-long note before the database, with the same message', () => {
  const src = read('app/api/price-alerts/route.ts');
  assert.ok(/if \(\(activeCount \?\? 0\) >= ACTIVE_ALERT_CAP\) \{\s*return NextResponse\.json\(\{ error: 'ALERT_LIMIT', message: `You can have up to \$\{ACTIVE_ALERT_CAP\} active price alerts\. Delete one to add another\.` \}, \{ status: 400 \}\);/.test(src), 'the 51st active alert is not refused in the route');
  assert.ok(/TEXT_LIMITS\.alertLabel/.test(src), 'the route does not check the note length');
  assert.ok(/const refusal = limitRefusal\(error\);/.test(src), 'a database refusal is not mapped to a 400');
});
