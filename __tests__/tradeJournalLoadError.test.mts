/* #1342 sweep: a failed/401 trades read must render as an error + retry, not "no trades yet" - the same
 * confident-empty defect #1165 fixed for loadPriceAlerts. Fix is in components/TradeJournal.tsx (a8f1af54).
 *
 * THE CODE WAS FIXED AND THAT PATH WAS NEVER EXERCISED. Two halves, because neither alone carries the claim
 * and there is no DOM test library in this repo (adding one is not QA's call - same limit as
 * __tests__/alertsMuteLoadTimeout.test.mts, which this file's shape follows):
 *
 *   1. BEHAVIOUR - the premise `loadTrades`'s fix depends on: a real supabase-js client's
 *      `.from(...).select(...).order(...).limit(...)` against a 401/error response RESOLVES to
 *      `{ data: null, error: {...} }` - it does not throw, and `data` is not `[]`. If that premise were
 *      false (a throw, or `data` silently defaulting to an empty array on error), `if (error)` would never
 *      run and the old bug would still exist under a different name. Real client, real network boundary
 *      (a fetch stand-in), no rendering.
 *   2. STRUCTURE - the component maps a failed read to `tradesError`, and `tradesError` to a retry state in
 *      BOTH tabs that reads it BEFORE the empty-state check - never the reverse. Read from source, with
 *      mutation controls: the same predicates run against mutated copies of the source and MUST fail, so a
 *      check that cannot fail is caught here.
 *
 * WHAT THIS DOES NOT PROVE: that the retry block is RENDERED, that the retry button re-fetches in a real
 * browser, or that `authLoading`/spinner timing (GrokChat, same fix batch) looks right on screen. Those need
 * a browser - see __tests__/grokChatAuthGate.test.mts for the sibling of this file, and a Playwright spec is
 * the natural follow-up for both, not written here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const source = stripComments(read('components/TradeJournal.tsx'));

/* ══ 1. BEHAVIOUR: the real shape a failed read resolves to ═══════════════════════════════════════════ */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://trade-journal-stand-in.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_stand_in_key';

type Fault = 'error' | 'throw' | null;
const world = { fault: null as Fault };
globalThis.fetch = (async (input: unknown) => {
  const url = new URL(String((input as { url?: string })?.url ?? input));
  if (!url.pathname.endsWith('_trades')) throw new Error(`stand-in got an unexpected request: ${url}`);
  if (world.fault === 'throw') throw new TypeError('fetch failed (stand-in)');
  if (world.fault === 'error') {
    return new Response(JSON.stringify({ code: '42501', message: 'stand-in: permission denied (RLS / expired token)', details: null, hint: null }),
      { status: 401, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify([{ id: 1, result: 'OPEN' }]), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const client = createClient('http://trade-journal-stand-in.invalid', 'anon_stand_in_key');
const readTrades = () => client.from('lhq_dev_trades').select('*').order('created_at', { ascending: false }).limit(200);

test('B1. a 401/RLS-denied read resolves to { data: null, error }, and does not throw', async () => {
  world.fault = 'error';
  const { data, error } = await readTrades();
  assert.equal(data, null, 'data was not null on a failed read - the code\'s `if (error)` branch would run alongside a truthy data, which is not what the fix assumes');
  assert.ok(error, 'no error object came back for a 401 - the fix\'s `if (error)` branch would never fire');
});

test('B2. CONTROL: a successful read resolves to { data: [...], error: null } - the stand-in is not rigged to always fail', async () => {
  world.fault = null;
  const { data, error } = await readTrades();
  assert.equal(error, null);
  assert.ok(Array.isArray(data) && data.length === 1);
});

/* ══ 2. STRUCTURE: the component's mapping ═════════════════════════════════════════════════════════════ */

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

test('S1. loadTrades: on error, tradesError is set and trades is NOT overwritten with the response data', () => {
  // The error branch is one single-line block: matching it EXACTLY already proves setTrades is not called
  // inside it (a call added there would change this literal string, and the anchor would stop matching).
  const at = anchorOnce(source, 'if (error) { setTradesError(true); setLoading(false); return; }', 'the error branch');
  const before = source.slice(Math.max(0, at - 400), at);
  assert.match(before, /setTradesError\(false\)/, 'loadTrades does not clear a stale tradesError before the new read');
});

test('S2. loadTrades: on success, trades is set from the response and tradesError is not left dangling from a previous failure', () => {
  anchorOnce(source, "setTrades((data ?? []) as Trade[]);", 'the success assignment');
  // tradesError(false) happens once, before the fetch - reaching this line (past the early-return on error) means it already ran.
  const clearAt = anchorOnce(source, 'setTradesError(false);', 'the pre-fetch clear');
  const errorAt = source.indexOf('if (error) { setTradesError(true);');
  const successAt = source.indexOf('setTrades((data ?? []) as Trade[]);');
  assert.ok(clearAt < errorAt && errorAt < successAt, 'the clear does not happen before both the error check and the success assignment');
});

test('S3. History tab: the error block is checked BEFORE the empty-state block, and the empty-state block excludes tradesError', () => {
  const errAt = anchorOnce(source, '{!loading && tradesError && (', 'History error block');
  const emptyAt = anchorOnce(source, '{!loading && !tradesError && trades.length === 0 && (', 'History empty block');
  assert.ok(errAt < emptyAt, 'the error block comes after the empty-state block in source order - a reader (and React, top to bottom) sees "no trades yet" first');
});

test('S4. History tab: the retry button in the error block calls loadTrades, and shows the two new labels', () => {
  const at = anchorOnce(source, '{!loading && tradesError && (', 'History error block');
  const block = source.slice(at, at + 900);
  assert.match(block, /t\('TRADE_JOURNAL_HISTORY_LOAD_FAILED'\)/, 'the failure message label is missing');
  assert.match(block, /onClick=\{loadTrades\}/, 'the retry button does not call loadTrades');
  assert.match(block, /t\('TRADE_JOURNAL_HISTORY_LOAD_RETRY'\)/, 'the retry label is missing');
  assert.match(block, /<\/button>/, 'window did not reach the closing button tag - widen it');
});

test('S5. Stats tab: tradesError is the FIRST branch of the ternary, and its very next arm (") : ") is "no stats yet", nothing inserted between them', () => {
  const at = anchorOnce(source, 'tradesError ? (', 'Stats ternary');
  const closeAt = source.indexOf(') : ', at);
  assert.ok(closeAt > at, 'no ") : " found after the tradesError arm - the ternary shape changed');
  assert.match(source.slice(closeAt, closeAt + 40), /^\) : stats\.closed === 0 \? \(/,
    `the arm right after tradesError is not stats.closed === 0 - found: ${JSON.stringify(source.slice(closeAt, closeAt + 40))}`);
});

test('S6. Stats tab: its retry button also calls loadTrades and shows the failure label', () => {
  const at = anchorOnce(source, 'tradesError ? (', 'Stats ternary');
  const block = source.slice(at, source.indexOf(') : stats.closed === 0', at));
  assert.match(block, /t\('TRADE_JOURNAL_HISTORY_LOAD_FAILED'\)/);
  assert.match(block, /onClick=\{loadTrades\}/);
  assert.match(block, /t\('TRADE_JOURNAL_HISTORY_LOAD_RETRY'\)/);
});

/* ══ Labels ═════════════════════════════════════════════════════════════════════════════════════════ */

const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const KEYS = ['TRADE_JOURNAL_HISTORY_LOAD_FAILED', 'TRADE_JOURNAL_HISTORY_LOAD_RETRY'];

test('L1. both new keys are registered in labelKeys.ts and have a non-empty English default', () => {
  const keys = read('lib/labelKeys.ts');
  for (const k of KEYS) {
    assert.ok(keys.includes(`'${k}'`), `${k} is not in lib/labelKeys.ts`);
    assert.ok(typeof defaults[k] === 'string' && defaults[k].trim().length > 0, `${k} has no default text`);
  }
});

test('L2. the migration\'s live and commented-dev rows both equal the shipped default, exactly', () => {
  const sql = read('supabase/migrations/20260927c_labels_trade_journal_load_error.sql');
  const rows = (commented: boolean) => {
    const out: Record<string, string> = {};
    for (const raw of sql.split('\n')) {
      const line = commented ? raw.trim() : raw.trim();
      const isCommentRow = line.startsWith("-- ('");
      const isLiveRow = line.startsWith("('");
      if (commented ? !isCommentRow : !isLiveRow) continue;
      const bare = commented ? line.slice(3) : line;
      const parts = bare.replace(/^\('/, '').replace(/'\)[,;]?\s*$/, '').split("','");
      if (parts.length === 3 && parts[1] === 'en') out[parts[0]] = parts[2].split("''").join("'");
    }
    return out;
  };
  const live = rows(false), dev = rows(true);
  assert.deepEqual(Object.keys(live).sort(), KEYS.slice().sort(), 'the live block seeds a different key set than expected');
  assert.deepEqual(live, dev, 'the commented dev block has drifted from the live block');
  for (const k of KEYS) assert.equal(live[k], defaults[k], `${k}: migration and shipped default differ`);
});
