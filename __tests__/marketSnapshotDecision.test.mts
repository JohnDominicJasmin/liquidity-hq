import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decideSnapshot, mergeCoverage, SNAPSHOT_TOO_OLD_MS, SNAPSHOT_STALE_AFTER_MS,
} from '../lib/marketSnapshot.ts';
import type { MarketFeed } from '../lib/marketFeeds.ts';

/* #1404 part B (PR #1412): the snapshot freshness decision, forced through every state.
 *
 * WHY UNIT AND NOT END-TO-END. These are the cases nobody can summon on demand from a real
 * exchange - a partial fan-out, a symbol that stopped updating, a payload with no usable
 * timestamps. Against staging you can only observe whichever case Bybit happens to produce,
 * which is how a suite ends up green because the interesting path never ran. `decideSnapshot`
 * is pure and takes its clock as an argument, so every branch is forceable here.
 *
 * WHAT THIS PINS, AND WHY EACH ONE EXISTS. The decision was rewritten twice during review
 * and each rewrite closed a way of reading "we cannot tell" as "fine":
 *   - a short run must not silently shrink coverage (a 37-of-49 row overwriting 49);
 *   - a symbol past the limit must be ABSENT, not served with its age, because nothing
 *     consumes the age today and a dead symbol would show its last value indefinitely;
 *   - a payload with nothing judgeable must serve live, NOT fall back to the row's write
 *     age - the merge can stamp a one-second-old write onto data nobody refetched, so
 *     write age stopped being a floor the moment carrying-forward existed.
 * Every one of those is a third state collapsing into the affirmative one, which is the
 * failure this codebase keeps paying for.
 */

const HOUR = 60 * 60_000;
const NOW = 1_790_000_000_000;

/** A feed shaped like the real ones: hourly buckets, millisecond `ts` per symbol. */
const feed: MarketFeed = {
  key: 'test:feed:1h',
  health: 'test:feed',
  samplingMs: HOUR,
  fetchLive: async () => ({ payload: null, source: 'test', ok: 0, total: 0, stopped: false }),
  dataAges: (payload, now) => {
    const data = (payload as { data?: Record<string, { ts?: number }> } | null)?.data ?? {};
    const bySymbol: Record<string, number> = {};
    let oldestMs: number | null = null;
    for (const [sym, item] of Object.entries(data)) {
      const ts = item?.ts;
      if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) continue;
      const age = Math.max(0, now - ts);
      bySymbol[sym] = age;
      if (oldestMs === null || age > oldestMs) oldestMs = age;
    }
    return { oldestMs, bySymbol };
  },
};

/** A payload whose symbols are `ageMinutes` old, plus anything extra to merge in. */
const payload = (ages: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  data: Object.fromEntries(Object.entries(ages).map(([sym, mins]) => [sym, { ts: NOW - mins * 60_000, v: sym }])),
  ...extra,
});

const symbols = (n: number, mins: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`SYM${i}`, mins]));

/* ── 1. a partial run keeps the symbols it did not refresh ─────────────────── */

test('1. a partial run keeps the previously known symbols and names the ones it carried', () => {
  const previous = payload(symbols(49, 5));
  const partial = payload(symbols(37, 1));            // 12 symbols missing this run
  const { payload: merged, kept } = mergeCoverage(previous, partial);

  const data = (merged as { data: Record<string, unknown> }).data;
  assert.equal(Object.keys(data).length, 49, 'coverage shrank - a short run overwrote symbols it never fetched');
  assert.equal(kept.length, 12);
  assert.deepEqual((merged as { staleSymbols: string[] }).staleSymbols.sort(), kept.sort(),
    'carried symbols must be NAMED, or the loss is invisible');
  // The refreshed ones are the new values, not the old.
  assert.equal((data.SYM0 as { ts: number }).ts, NOW - 60_000, 'a refreshed symbol kept its stale value');
});

test('1b. a complete run carries nothing and says so', () => {
  const { payload: merged, kept } = mergeCoverage(payload(symbols(49, 5)), payload(symbols(49, 1)));
  assert.equal(kept.length, 0);
  assert.deepEqual((merged as { staleSymbols: string[] }).staleSymbols, [],
    'staleSymbols must be present and empty, not absent - a reader cannot tell "none" from "not reported"');
});

test('1c. the health row reports a partial run as NOT ok', () => {
  /* Asserted against the route's source: the rule is one expression and its whole value is
     that a degraded write cannot report success. A run covering 37 of 49 while the health
     row says "ok" is worse than no health row, because it stops anyone looking. */
  const src = readFileSync(new URL('../app/api/market/ingest/route.ts', import.meta.url), 'utf8');
  assert.match(src, /ok:\s*sampling\.ok\s*&&\s*!partial/,
    'the ingest route no longer ANDs `!partial` into the health flag - a short run would report healthy');
});

/* ── 2 & 5. a symbol that cannot be served fresh is absent, not stale ───────── */

test('2. a carried symbol past the hard limit is dropped from the payload and named', () => {
  const ages = { ...symbols(3, 5), DEAD: 61 + SNAPSHOT_TOO_OLD_MS / 60_000 };  // past 1h sampling + 30m
  const decided = decideSnapshot(feed, payload(ages, { staleSymbols: ['DEAD'] }), 1_000, NOW);

  assert.ok(decided, 'the whole row was discarded - one dead symbol must not condemn the others');
  const data = (decided.body as { data: Record<string, unknown> }).data;
  assert.ok(!('DEAD' in data), 'a symbol past the limit was SERVED with its age - nothing reads that age today, so it shows a dead value as current');
  assert.deepEqual(decided.droppedSymbols, ['DEAD'], 'the dropped symbol must be named, or the loss is silent');
  assert.equal(Object.keys(data).length, 3, 'the live symbols were lost with it');
});

test('5. a symbol with NO usable timestamp is dropped for the same reason', () => {
  const body = payload(symbols(3, 5)) as { data: Record<string, unknown> };
  body.data.NOSTAMP = { v: 'NOSTAMP' };               // present, but unjudgeable
  const decided = decideSnapshot(feed, body, 1_000, NOW);

  assert.ok(decided);
  const data = (decided.body as { data: Record<string, unknown> }).data;
  assert.ok(!('NOSTAMP' in data), 'a symbol whose age is unknown was served as current - unknown must never read as fresh, at the symbol level as well as the row');
  assert.ok(decided.droppedSymbols.includes('NOSTAMP'));
});

/* ── 3 & 6. the verdict, and the line that governs it ──────────────────────── */

test('3. a row where EVERY symbol is past the limit falls through to the live path', () => {
  const tooOld = 61 + SNAPSHOT_TOO_OLD_MS / 60_000;
  const all = Object.keys(symbols(5, 0));
  const decided = decideSnapshot(feed, payload(symbols(5, tooOld), { staleSymbols: all }), 1_000, NOW);
  assert.equal(decided, null, 'a snapshot of nothing but stale symbols served as usable');
});

test('6. GOVERNING LINE: when every symbol is carried the verdict is the CARRIED ages, never the write time', () => {
  /* `pool = judged.length ? judged : ages`. If a refactor "simplifies" that to `judged`,
     an all-carried row leaves an empty pool, `Math.max()` of nothing is -Infinity, overdue
     clamps to 0 - and a snapshot of nothing but dead symbols reads BRAND NEW. This asserts
     the behaviour that line produces, so the simplification cannot pass. */
  const tooOld = 61 + SNAPSHOT_TOO_OLD_MS / 60_000;
  const all = Object.keys(symbols(4, 0));

  // Row written one millisecond ago, data hours old, every symbol carried.
  assert.equal(
    decideSnapshot(feed, payload(symbols(4, tooOld), { staleSymbols: all }), 1, NOW), null,
    'an all-carried row was judged on its write time, so ancient data read as fresh',
  );
  // And the same shape while still inside the limit must still be SERVED - so the test
  // above is not passing merely because everything returns null.
  const fresh = decideSnapshot(feed, payload(symbols(4, 65), { staleSymbols: all }), 1, NOW);
  assert.ok(fresh, 'an all-carried row inside the limit must still serve - this check can distinguish the two');
  assert.ok(fresh.dataAgeMs !== null && fresh.dataAgeMs > HOUR,
    'the verdict age came from the write time, not from the carried data');
});

/* ── 4. nothing judgeable is not freshness ─────────────────────────────────── */

test('4. a payload with NO usable timestamps serves live - at every row age, including 0', () => {
  /* THE ONE THAT CATCHES THE REGRESSION. The deleted behaviour fell back to the row's write
     age, which PASSES at a large rowAgeMs and only fails at a small one - so a single
     mid-range value would let it straight back in. The merge can write a row a millisecond
     ago holding data nobody refetched, which is exactly the small case. */
  const unjudgeable = { data: { A: { v: 1 }, B: { v: 2 } } };   // present, no `ts` anywhere
  for (const rowAgeMs of [0, 1, 1_000, 60_000, SNAPSHOT_STALE_AFTER_MS, SNAPSHOT_TOO_OLD_MS, 6 * HOUR]) {
    assert.equal(
      decideSnapshot(feed, unjudgeable, rowAgeMs, NOW), null,
      `a payload with nothing judgeable was served as usable at rowAgeMs=${rowAgeMs} - "cannot tell" must not resolve to "fresh"`,
    );
  }
});

test('4b. an empty payload is also not fresh', () => {
  for (const empty of [{ data: {} }, {}, null, undefined]) {
    assert.equal(decideSnapshot(feed, empty, 0, NOW), null, `${JSON.stringify(empty)} was served as usable`);
  }
});

/* ── the control: this decision CAN say yes ────────────────────────────────── */

test('CONTROL: a fresh row is served, and an hourly bucket inside its own cadence is not "stale"', () => {
  /* Every assertion above is "returns null" or "is absent", and a function stuck on null
     satisfies all of them. This is the case that must come back positive. */
  const decided = decideSnapshot(feed, payload(symbols(49, 45)), 30_000, NOW);
  assert.ok(decided, 'a 45-minute-old hourly bucket was refused - that is the threshold bug this model replaced');
  assert.equal(decided.overdueMs, 0, 'a bucket younger than its own sampling interval is not overdue');
  assert.equal(decided.stale, false);
  assert.equal(decided.droppedSymbols.length, 0);
  assert.equal(Object.keys((decided.body as { data: Record<string, unknown> }).data).length, 49);
  assert.ok(decided.dataAgeMs !== null && decided.dataAgeMs >= 45 * 60_000, 'dataAgeMs must report the DATA age, not the row age');
  assert.equal(decided.rowAgeMs, 30_000, 'rowAgeMs must still be reported alongside it');
});

test('CONTROL: overdue is measured past the sampling interval, and drives `stale`', () => {
  // 1h sampling + 12 minutes = 12 minutes overdue, which is past SNAPSHOT_STALE_AFTER_MS (10m).
  const decided = decideSnapshot(feed, payload(symbols(3, 72)), 1_000, NOW);
  assert.ok(decided, 'still inside the 30-minute hard limit, so it must serve');
  assert.equal(Math.round(decided.overdueMs / 60_000), 12);
  assert.equal(decided.stale, true, 'past two cadences should be marked stale for the consumer to label');
});
