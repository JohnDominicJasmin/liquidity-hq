/* The alert crons read EVERY row, not the first 1000 (#1397, PR #1514; bound corrected in #1523).
 *
 * THE BUG. PostgREST answers at most db-max-rows (1000 here) per request and drops the rest WITHOUT an error. The
 * alert crons walked whole user-wide tables with one plain read each, so past 1000 rows price alerts would never
 * fire, Pro users would be left out as recipients, mutes and personal thresholds would be ignored and trial
 * reminders skipped. lib/selectAllRows.ts now pages in 1000-row `.range()` pages ordered by columns that are
 * unique together, stops at the first short page, and bounds one read at MAX_ROWS (10,000).
 *
 * #1523 CHANGED THE BOUND. The first version warned at exactly 10,000 rows. The read now asks for one row PAST
 * the bound: a table of exactly 10,000 ends on an empty page, is returned whole and is NOT truncated; only more
 * than 10,000 sets `truncated` and logs. This file pins the current behaviour, with 10,000 as the edge.
 *
 * WHAT RUNS: the REAL helper against a stand-in table that behaves like PostgREST where it matters here: it
 * sorts by the columns it was told to order by, slices by the range it was asked for, and clamps every answer
 * at 1000 rows. The seed is stored in SCRAMBLED order, so a read that forgets `.order()` comes back out of order
 * and the unique-key check catches skips and repeats. Expectations come from the seed (ids 0..n-1), never from
 * the helper. The callers are SOURCE PINS: which column each read orders by.
 *
 * MUTATIONS (each must turn the named tests red; recorded in the commit):
 *   M1 drop the `.order()` loop                         -> "every page orders by...", "no row is skipped or repeated", "more than 10,000"
 *   M2 stop paging after the first page                 -> "1001", "2500", "10,000" row-count tests
 *   M3 `<` becomes `<=` on the short-page break         -> same set as M2 (a full page ends the read)
 *   M4 swallow a page error (treat it as empty)         -> "an error on page 2 is not swallowed"
 *   M5 `rows.length <= maxRows` becomes `< maxRows`     -> "exactly 10,000 is whole and not truncated"
 *   M6 drop the `truncated: true` return value          -> "more than 10,000"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectAllRows, PAGE_ROWS, MAX_ROWS } from '../lib/selectAllRows.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, '').split(/\r?\n/).join('\n');

const SERVER_CAP = 1000;

type Row = { id: number; k: number };
type Err = { message: string };

/** A table of `n` rows, ids 0..n-1, stored in a scrambled order (stride coprime with n). */
function scrambled(n: number): Row[] {
  const rows: Row[] = [];
  let stride = 7919;
  while (n > 1 && gcd(stride, n) !== 1) stride += 2;
  for (let i = 0; i < n; i++) { const id = (i * stride) % Math.max(n, 1); rows.push({ id, k: id % 3 }); }
  return rows;
}
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

interface Log { ranges: Array<[number, number]>; orders: string[][]; builders: number }

/** A stand-in for one supabase-js query, built fresh by the factory for every page. */
function table(rows: Row[], opts: { failOnRequest?: number; log?: Log } = {}) {
  const log: Log = opts.log ?? { ranges: [], orders: [], builders: 0 };
  const factory = () => {
    log.builders++;
    const cols: string[] = [];
    const b = {
      order(column: string, options?: { ascending?: boolean }) {
        assert.equal(options?.ascending, true, 'pages must be read ascending');
        cols.push(column);
        return b;
      },
      range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: Err | null }> {
        log.ranges.push([from, to]);
        log.orders.push([...cols]);
        if (opts.failOnRequest && log.ranges.length === opts.failOnRequest) {
          return Promise.resolve({ data: null, error: { message: 'boom on page ' + log.ranges.length } });
        }
        const sorted = [...rows];
        // Only a read that asked for an order gets one; otherwise storage order, which is scrambled.
        for (const c of [...cols].reverse()) sorted.sort((x, y) => (x as unknown as Record<string, number>)[c] - (y as unknown as Record<string, number>)[c]);
        const want = to - from + 1;
        return Promise.resolve({ data: sorted.slice(from, from + Math.min(want, SERVER_CAP)), error: null });
      },
    };
    return b;
  };
  return { factory, log };
}

const quietWarn = <T,>(fn: () => Promise<T>) => {
  const seen: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => { seen.push(a.join(' ')); };
  return fn().finally(() => { console.warn = orig; }).then((r) => ({ r, seen }));
};

test('CONTROL. the stand-in clamps at 1000 like PostgREST and the bounds are the ones these tests assume', async () => {
  assert.equal(PAGE_ROWS, 1000, 'PAGE_ROWS moved - the row counts below were chosen around 1000');
  assert.equal(MAX_ROWS, 10_000, 'MAX_ROWS moved - the 10,000 edge below was chosen around it');
  const { factory } = table(scrambled(2500));
  const plain = await factory().range(0, 2499);
  assert.equal(plain.data?.length, 1000, 'CONTROL: a single plain read of 2500 rows must come back clamped to 1000, or the stand-in does not reproduce the bug');
  assert.notDeepEqual(scrambled(5).map((r) => r.id), [0, 1, 2, 3, 4], 'CONTROL: the seed must be stored out of order');
});

for (const [n, requests] of [[0, 1], [999, 1], [1000, 2], [1001, 2], [2500, 3]] as const) {
  test(`reads all ${n} rows in ${requests} request(s), never fewer than the table holds`, async () => {
    const { factory, log } = table(scrambled(n));
    const res = await selectAllRows<Row, Err>('t', 'id', factory);
    assert.equal(res.error, null);
    assert.equal(res.truncated, false);
    assert.equal(res.data?.length, n, `a ${n}-row table came back with ${res.data?.length} rows - the rows past one page were dropped`);
    assert.equal(log.ranges.length, requests, `${n} rows should take ${requests} request(s), took ${log.ranges.length}: ${JSON.stringify(log.ranges)}`);
  });
}

test('no row is skipped or repeated where two pages meet - ids come back exactly 0..n-1 in order', async () => {
  const n = 2500;
  const { factory } = table(scrambled(n));
  const res = await selectAllRows<Row, Err>('t', 'id', factory);
  assert.deepEqual(res.data?.map((r) => r.id), Array.from({ length: n }, (_, i) => i));
});

test('every page orders by the unique column(s) it was given, in the order given, and asks for the next range', async () => {
  const { factory, log } = table(scrambled(2500));
  await selectAllRows<Row, Err>('t', ['k', 'id'], factory);
  assert.deepEqual(log.orders, [['k', 'id'], ['k', 'id'], ['k', 'id']], 'each page must carry the full ordering, or Postgres may order two requests differently');
  assert.deepEqual(log.ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(log.builders, 3, 'a supabase-js builder can be awaited once: every page needs a fresh one from the factory');
});

test('stops on a short page, and on an empty one, without asking again', async () => {
  const short = table(scrambled(1500));
  await selectAllRows<Row, Err>('t', 'id', short.factory);
  assert.equal(short.log.ranges.length, 2, 'a 500-row second page is short; a third request is wasted');
  const empty = table(scrambled(1000));
  const res = await selectAllRows<Row, Err>('t', 'id', empty.factory);
  assert.equal(empty.log.ranges.length, 2, 'exactly one full page needs one more request to learn there is nothing left');
  assert.equal(res.data?.length, 1000);
  assert.equal(empty.log.ranges.at(-1)?.[0], 1000);
});

test('an error on page 2 is not swallowed: data is null and the error is that page\'s, never a partial list', async () => {
  const { factory } = table(scrambled(2500), { failOnRequest: 2 });
  const res = await selectAllRows<Row, Err>('t', 'id', factory);
  assert.equal(res.data, null, 'a partial list would let a cron fire for some users and silently skip the rest');
  assert.deepEqual(res.error, { message: 'boom on page 2' });
  assert.equal(res.truncated, false);
});

test('an error on the first page is returned the same way', async () => {
  const { factory } = table(scrambled(10), { failOnRequest: 1 });
  const res = await selectAllRows<Row, Err>('t', 'id', factory);
  assert.equal(res.data, null);
  assert.deepEqual(res.error, { message: 'boom on page 1' });
});

test('exactly 10,000 rows is whole and NOT truncated, with no warning (#1523)', async () => {
  const { factory, log } = table(scrambled(10_000));
  const { r, seen } = await quietWarn(() => selectAllRows<Row, Err>('t', 'id', factory));
  assert.equal(r.data?.length, 10_000);
  assert.equal(r.truncated, false, 'a table of exactly MAX_ROWS has every row read; calling it truncated is the pre-#1523 behaviour');
  assert.deepEqual(seen, [], 'no warning for a table that fits exactly');
  assert.equal(log.ranges.length, 11, 'ten full pages, then one request for the single row past the bound which finds nothing');
});

test('more than 10,000 rows returns exactly 10,000, sets truncated and warns once under the label', async () => {
  const { factory } = table(scrambled(10_001));
  const { r, seen } = await quietWarn(() => selectAllRows<Row, Err>('alert:price_alerts', 'id', factory));
  assert.equal(r.data?.length, 10_000, 'at most MAX_ROWS rows are returned');
  assert.equal(r.truncated, true);
  assert.deepEqual(r.data?.map((x) => x.id).slice(0, 3), [0, 1, 2]);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^\[alert:price_alerts\] read stopped at the 10000-row bound/);
});

/* ── the callers: what each alert read orders by (SOURCE PINS) ─────────────────────────────────────────── */

function callOrders(file: string): Map<string, string> {
  const src = read(file);
  const out = new Map<string, string>();
  const re = /selectAllRows\(\s*'([^']+)',\s*(\[[^\]]*\]|'[^']*')/g;
  for (const m of src.matchAll(re)) out.set(m[1], m[2].replace(/\s+/g, ''));
  return out;
}

test('the alert route reads each user-wide table through the helper, ordered by a column that is unique', () => {
  const got = callOrders('app/api/telegram/alert/route.ts');
  const want: Record<string, string> = {
    'alert:thresholds': "'user_id'",
    'alert:price_alerts': "'id'",
    'alert:price_alert_chat_ids': "'user_id'",
    'alert:daily_summary_alerts': "'id'",
    'alert:push_subscriptions': "'endpoint'",
    'alert:muted_alerts': "['user_id','key']",
    'alert:user_subscriptions': "'user_id'",
    'alert:recipients': "'user_id'",
  };
  for (const [label, order] of Object.entries(want)) {
    assert.ok(got.has(label), `CONTROL: ${label} is no longer read through selectAllRows in the alert route - past 1000 rows it would be clamped silently again`);
    assert.equal(got.get(label), order, `${label} orders by ${got.get(label)}; it must be a unique key or a page boundary can skip or repeat a row`);
  }
});

test('the other crons that walk whole tables use the helper too', () => {
  for (const f of ['app/api/macro-alert/route.ts', 'app/api/trial-reminder/route.ts']) {
    assert.ok(callOrders(f).size > 0, `${f} no longer reads through selectAllRows - its table read is clamped at 1000 rows without an error`);
  }
});
