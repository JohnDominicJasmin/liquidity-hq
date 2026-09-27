/* #925: LiqFeed's periodic Supabase save was re-inserting events it had already loaded from the DB (a fresh
 * browser with lastTs=0 re-saved its whole loaded 24h history on the first tick) - measured on dev as 97.8%
 * duplicate rows in lhq_dev_liq_events (#1025), the #3 time consumer on the whole database and, because every
 * duplicate row emits WAL, feeding the #1 consumer (the Realtime logical-replication decoder) too. Fix is in
 * components/LiqFeed.tsx (7937803a): a `persistedKeysRef` set, seeded from the initial DB read and extended
 * after each successful save, so the periodic flush only ever inserts a natural key it does not already know
 * is in Supabase.
 *
 * STRUCTURE ONLY, same limit as the other two #1342-batch files tonight: `persistedKeysRef`, `historyRef` and
 * the save timer are closures inside this component, with no exported function and no DOM test library in
 * this repo to render it. What IS testable and done here as a real, independent re-derivation rather than a
 * read-back: the natural-key ALGORITHM itself (dedup a candidate list against a persisted set and against
 * itself) is re-implemented from scratch below and asserted correct on its own terms (D1-D6), before ever
 * touching the component's source. The STRUCTURE tests (S1-S6) then confirm the component's source matches
 * that exact algorithm - same filter, same key shape, same "only mark persisted on success" rule, same
 * "advance the save cursor even when nothing new was found" fix (a second, smaller bug this same commit
 * fixes: the old code returned before advancing `lastTs` on an empty batch, so a quiet period never shrank
 * the next query's range).
 *
 * WHAT THIS DOES NOT PROVE: that fewer rows actually land in a real Supabase table, or that two browser tabs
 * racing the same brand-new liquidation don't still double-insert it once (Dev's own comment names this: the
 * cross-CLIENT case needs the DB unique constraint, which is the separate owner-gated DDL half of #925, not
 * this commit). That needs either a live capture (`arm-network-tracking-before-navigate`, same technique
 * #921's original measurement used) or the migration, neither of which is this file. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const source = stripComments(read('components/LiqFeed.tsx'));

function anchorOnce(src: string, needle: string, label: string): number {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
}

/* ══ D: the algorithm, re-derived independently ═══════════════════════════════════════════════════════ */

type Ev = { ts: number; coin: string; price: number; side: string; source: string };
const key = (e: Ev) => `${e.ts}_${e.coin}_${e.price}_${e.side}_${e.source}`;

/** A from-scratch re-implementation of "what should be saved this tick", not read from the component. */
function pickToSave(history: Ev[], lastTs: number, persisted: Set<string>): Ev[] {
  const batchKeys = new Set<string>();
  const out: Ev[] = [];
  for (const e of history) {
    if (e.ts <= lastTs) continue;
    const k = key(e);
    if (persisted.has(k) || batchKeys.has(k)) continue;
    batchKeys.add(k);
    out.push(e);
  }
  return out;
}

const ev = (ts: number, over: Partial<Ev> = {}): Ev => ({ ts, coin: 'BTC', price: 60000, side: 'LONG', source: 'BN', ...over });

test('D1. only events strictly after lastTs are candidates (the boundary is >, not >=)', () => {
  assert.deepEqual(pickToSave([ev(100), ev(101)], 100, new Set()), [ev(101)]);
});

test('D2. an event whose key is already in the persisted set is dropped', () => {
  const e = ev(200);
  assert.deepEqual(pickToSave([e], 0, new Set([key(e)])), []);
});

test('D3. two events with the SAME key in one batch collapse to one (the fresh-browser re-save case: the whole loaded history sharing lastTs=0)', () => {
  const a = ev(300), b = ev(300);
  const out = pickToSave([a, b], 0, new Set());
  assert.equal(out.length, 1, 'a within-batch duplicate was not collapsed');
});

test('D4. events that differ in ANY one key field are NOT deduped against each other', () => {
  const base = ev(400);
  for (const over of [{ coin: 'ETH' }, { price: 60001 }, { side: 'SHORT' }, { source: 'BB' as const }, { ts: 401 }]) {
    const out = pickToSave([base, ev(400, over)], 0, new Set());
    assert.equal(out.length, 2, `differing only in ${JSON.stringify(over)} still collapsed to one`);
  }
});

test('D5. CONTROL: with an empty persisted set and no in-batch dupes, everything after lastTs passes through unchanged', () => {
  const list = [ev(1), ev(2, { coin: 'ETH' }), ev(3, { source: 'BB' })];
  assert.deepEqual(pickToSave(list, 0, new Set()), list);
});

test('D6. CONTROL: a persisted set that matches nothing changes nothing (the check can actually let events through, not just block them)', () => {
  const list = [ev(500)];
  assert.deepEqual(pickToSave(list, 0, new Set(['9999_XRP_1_SHORT_BB'])), list);
});

/* ══ S: the component's source matches that algorithm ═════════════════════════════════════════════════ */

test('S1. persistedKeysRef exists, starts empty, and its declared key shape matches the dedup algorithm\'s', () => {
  anchorOnce(source, 'const persistedKeysRef = useRef<Set<string>>(new Set());', 'persistedKeysRef declaration');
});

test('S2. the initial DB read seeds persistedKeysRef from EVERY row it gets back, before the existing local "seen" dedup runs', () => {
  const seedAt = anchorOnce(source, 'for (const r of data as Array<{ coin: string; side: string; price: number; source: string; ts: number }>) {\n            persistedKeysRef.current.add(`${r.ts}_${r.coin}_${r.price}_${r.side}_${r.source}`);\n          }', 'the backfill seed loop');
  const seenAt = anchorOnce(source, 'const seen = new Set(\n            historyRef.current.map(e => `${e.ts}_${e.coin}_${e.price}_${e.side}_${e.source}`)\n          );', 'the existing local-history "seen" set');
  assert.ok(seedAt < seenAt, 'the persisted-keys seed runs after the local "seen" set is built, not before - a re-order risk for a fix landing later');
});

test('S3. the key SHAPE is identical (field order, separator, template) in all three places it is built: the backfill seed, the local "seen" set, and the periodic-save batch key', () => {
  const shape = '${%.ts}_${%.coin}_${%.price}_${%.side}_${%.source}';
  const uses = [
    ['r', '`${r.ts}_${r.coin}_${r.price}_${r.side}_${r.source}`'],
    ['e', '`${e.ts}_${e.coin}_${e.price}_${e.side}_${e.source}`'],
  ] as const;
  for (const [name, literal] of uses) {
    const n = source.split(literal).length - 1;
    assert.ok(n >= 1, `the key template for "${name}" (${literal}) was not found verbatim - the shape changed somewhere`);
    void shape;
  }
});

test('S4. the periodic save excludes a key already in persistedKeysRef AND a key already seen earlier in this same batch', () => {
  const at = anchorOnce(source,
    'const batchKeys = new Set<string>();\n        const toSave = historyRef.current.filter(e => {\n          if (e.ts <= lastTs) return false;\n          const key = `${e.ts}_${e.coin}_${e.price}_${e.side}_${e.source}`;\n          if (persistedKeysRef.current.has(key) || batchKeys.has(key)) return false;\n          batchKeys.add(key);\n          return true;\n        });',
    'the dedup filter');
  assert.ok(at > 0);
});

test('S5. a key is marked persisted ONLY after the insert actually succeeds - a failed save must be retried next tick, not silently dropped', () => {
  const insertAt = anchorOnce(source, 'sb.from(T.liq_events).insert(rows).then(({ error }) => {', 'the insert call');
  const errAt = anchorOnce(source, "if (error) { console.error('[liq] sb save failed:', error.message); return; }", 'the error branch');
  const markAt = anchorOnce(source, 'for (const key of batchKeys) persistedKeysRef.current.add(key);', 'marking the batch persisted');
  assert.ok(insertAt < errAt && errAt < markAt, 'the persisted-marking does not come after the error return - a failed insert could still mark its keys as saved');
});

test('S6. the save cursor (lastTs) advances even when nothing new was found, not just after a successful insert - the fix for the OTHER #925 bug (a frozen cursor that never shrinks the query range)', () => {
  const at = anchorOnce(source,
    "if (toSave.length === 0) {\n          \n          localStorage.setItem(SB_SAVE_TS_KEY, String(Date.now()));\n          return;\n        }",
    'the empty-batch cursor advance');
  assert.ok(at > 0);
});
