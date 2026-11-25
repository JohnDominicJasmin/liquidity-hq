/* QA: PR #2818 (#1651 owner item 30), the AI is told "no cascade in the last 4h" only when the page watched for 4 hours. The REAL line function runs; the provider's two watch functions are sliced from its source and run against stand-in sockets (our own checked-in source, never input).
 *   N1 not watching, 0 min, 1 min, 3 h 59 min, exactly 4 h, longer, a clock set back
 *   N2 the first open socket starts the watch and a later one keeps the earlier start; a close with the other socket open keeps it; with none open it clears
 *   N3 both sockets report open and close, leaving the page clears it, and the Arena context uses the line only when no cascade is held */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { noCascadeLine, CASCADE_LOOKBACK_MS } from '../lib/liqWatch.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const H = 3_600_000, NOW = Date.UTC(2026, 0, 1, 12);

test('N1. the line says only what was watched', () => {
  assert.equal(CASCADE_LOOKBACK_MS, 4 * H);
  assert.equal(noCascadeLine(null, NOW), 'Not watching liquidations right now - do not assume there were none');
  const seen = (min: number) => `None seen in the ${min} min this page has watched - earlier hours are unknown`;
  assert.equal(noCascadeLine(NOW, NOW), seen(0)); assert.equal(noCascadeLine(NOW - 60_000, NOW), seen(1));
  assert.equal(noCascadeLine(NOW - (4 * H - 1), NOW), seen(239));
  assert.equal(noCascadeLine(NOW - 4 * H, NOW), 'None in last 4h'); assert.equal(noCascadeLine(NOW - 30 * H, NOW), 'None in last 4h');
  assert.equal(noCascadeLine(NOW + H, NOW), seen(0));
});

test('N2. the watch starts with the first open socket and ends with the last', () => {
  const s = read('components/MarketProvider.tsx');
  const a = s.indexOf('const watchStarted = () =>'), z = s.indexOf('function recordLiq(', a); assert.ok(a > 0 && z > a, 'CONTROL: the watch functions were not found');
  const strip = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
  const make = new Function('setStore', 'sockets', 'Date', `let bnWs, bbWs;\n${strip(s.slice(a, z))}\nreturn { watchStarted: () => watchStarted(), ended: () => { bnWs = sockets.bn; bbWs = sockets.bb; watchMayHaveEnded(); } };`) as (set: unknown, sockets: unknown, date: unknown) => { watchStarted: () => void; ended: () => void };
  let store: { liqWatchSince: number | null } = { liqWatchSince: null }; let writes = 0; let now = 1_000;
  const sockets: { bn: { readyState: number } | null; bb: { readyState: number } | null } = { bn: null, bb: null };
  const w = make((u: (p: typeof store) => typeof store) => { const n = u(store); if (n !== store) writes++; store = n; }, sockets, { now: () => now });
  w.watchStarted(); assert.equal(store.liqWatchSince, 1_000);
  now = 5_000; w.watchStarted(); assert.equal(store.liqWatchSince, 1_000, 'a second socket moved the start');
  sockets.bn = { readyState: 3 }; sockets.bb = { readyState: 1 }; w.ended(); assert.equal(store.liqWatchSince, 1_000, 'cleared although a socket is open');
  sockets.bb = { readyState: 3 }; w.ended(); assert.equal(store.liqWatchSince, null);
  const before = writes; w.ended(); assert.equal(writes, before, 'a second close rewrote the store');
  now = 9_000; w.watchStarted(); assert.equal(store.liqWatchSince, 9_000, 'a reconnect starts a new watch');
});

test('N3. both sockets are wired, leaving clears it, and the Arena uses the line', () => {
  const s = read('components/MarketProvider.tsx');
  assert.equal((s.match(/ws\.onopen = \(\) => \{\n\s*watchStarted\(\);/g) ?? []).length, 2, 'both liquidation sockets report open');
  assert.equal((s.match(/ws\.onclose = \(\) => \{\n\s*watchMayHaveEnded\(\);/g) ?? []).length, 2, 'both report close');
  assert.match(s, /alive = false;\n\s*setStore\(s => \(s\.liqWatchSince == null \? s : \{ \.\.\.s, liqWatchSince: null \}\)\);/);
  const arena = read('app/(main)/arena/page.tsx');
  assert.match(arena, /ago\)`\n\s*: noCascadeLine\(store\.liqWatchSince, Date\.now\(\)\);/);
  assert.equal(arena.includes("'None in last 4h'"), false, 'the unconditional claim is back');
});
